/**
 * Builds /public/content/related-brands.json:
 * {
 *   byBrandId: {
 *     "12": [{ id, name, image_url, path }, ...],
 *     ...
 *   }
 * }
 */
const fs = require("fs-extra");
const axios = require("axios");
require("dotenv").config();
const { API_BASE, headers, getAllPaged } = require("./bc-utils");

const {
  OUTPUT_DIR = "public/content",
  TOP_CATEGORY_COUNT = 5,
  MAX_BRANDS = 12,
  RANKING_MODE = "KOFN",
  MIN_CATEGORY_MATCHES = 2,
} = process.env;

const EXCLUDE_CATEGORY_IDS = (process.env.EXCLUDE_CATEGORY_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean).map(Number);

async function getBrands() {
  return getAllPaged(`${API_BASE}/catalog/brands`, {}, "id,name,custom_url,image_url");
}
async function getProductsByBrand(id) {
  return getAllPaged(`${API_BASE}/catalog/products`, { brand_id: id }, "id,categories,brand_id");
}
function topCategories(products, topN) {
  const bad = new Set(EXCLUDE_CATEGORY_IDS);
  const counts = new Map();
  for (const p of products) {
    (p.categories || []).filter(cid => !bad.has(cid))
      .forEach(cid => counts.set(cid, (counts.get(cid) || 0) + 1));
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, Number(topN)).map(([categoryId,count])=>({categoryId,count}));
}
async function getBrandsByIds(ids) {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const chunks = [];
  for (let i=0; i<unique.length; i+=50) chunks.push(unique.slice(i,i+50));
  const results=[];
  for (const ch of chunks) {
    const res = await axios.get(`${API_BASE}/catalog/brands`, {
      headers,
      params: { "id:in": ch.join(","), limit: ch.length, include_fields: "id,name,custom_url,image_url" }
    });
    results.push(...(res.data?.data||[]));
  }
  return results;
}
function brandHref(brand) {
  return brand?.custom_url?.url || `/brands.php?brand_id=${brand.id}`;
}

// RANKING MODES (same as your script, shortened)
async function rankRaw(categoryIds, excludeBrandId) {
  if (!categoryIds.length) return [];
  const products = await getAllPaged(`${API_BASE}/catalog/products`,
    { "categories:in": categoryIds.join(",") }, "id,brand_id");
  const counts = new Map();
  for (const p of products) {
    const b = p.brand_id;
    if (!b || b === Number(excludeBrandId)) continue;
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([brandId,count])=>({ brandId, score: count }));
}

async function getCategoryTotals(categoryIds) {
  const out = new Map();
  for (const cid of categoryIds) {
    const res = await axios.get(`${API_BASE}/catalog/products`, {
      headers, params: { "categories:in": cid, limit: 1, page: 1 }
    });
    const total = res.data?.meta?.pagination?.total || 1;
    out.set(cid, total);
  }
  return out;
}
async function rankWeighted(categoryIds, excludeBrandId) {
  if (!categoryIds.length) return [];
  const totals = await getCategoryTotals(categoryIds);
  const products = await getAllPaged(`${API_BASE}/catalog/products`,
    { "categories:in": categoryIds.join(",") }, "id,brand_id,categories");
  const scores = new Map();
  const setIds = new Set(categoryIds);
  for (const p of products) {
    const b = p.brand_id;
    if (!b || b === Number(excludeBrandId)) continue;
    let add = 0;
    for (const cid of (p.categories || [])) {
      if (!setIds.has(cid)) continue;
      const total = totals.get(cid) || 1;
      add += 1 / Math.log(1 + total);
    }
    scores.set(b, (scores.get(b) || 0) + add);
  }
  return [...scores.entries()].sort((a,b)=>b[1]-a[1]).map(([brandId,score])=>({ brandId, score }));
}

async function rankKofN(categoryIds, excludeBrandId, k) {
  if (!categoryIds.length) return [];
  const seen = new Map();
  for (const cid of categoryIds) {
    const ps = await getAllPaged(`${API_BASE}/catalog/products`, { "categories:in": cid }, "id,brand_id");
    for (const p of ps) {
      const b = p.brand_id;
      if (!b || b === Number(excludeBrandId)) continue;
      if (!seen.has(b)) seen.set(b, new Set());
      seen.get(b).add(cid);
    }
  }
  const arr = [];
  for (const [brandId, set] of seen.entries()) {
    if (set.size >= Number(k)) arr.push({ brandId, score: set.size });
  }
  arr.sort((a,b)=>b.score - a.score);
  return arr;
}

(async ()=>{
  try {
    await fs.ensureDir(OUTPUT_DIR);
    const brands = await getBrands();
    const byBrandId = {};
    for (const brand of brands) {
      const products = await getProductsByBrand(brand.id);
      if (!products.length) continue;
      const topCats = topCategories(products, Number(TOP_CATEGORY_COUNT));
      if (!topCats.length) continue;

      const categoryIds = topCats.map(t => t.categoryId);
      let ranked;
      const mode = String(RANKING_MODE || "KOFN").toUpperCase();
      if (mode === "RAW") ranked = await rankRaw(categoryIds, brand.id);
      else if (mode === "WEIGHTED") ranked = await rankWeighted(categoryIds, brand.id);
      else ranked = await rankKofN(categoryIds, brand.id, Number(MIN_CATEGORY_MATCHES || 2));

      if (!ranked.length) continue;
      const topOtherIds = ranked.slice(0, Number(MAX_BRANDS)).map(r => r.brandId);
      const otherBrands = await getBrandsByIds(topOtherIds);
      const byId = new Map(otherBrands.map(b => [b.id, b]));
      const rankedRecords = ranked
        .filter(r => byId.has(r.brandId))
        .slice(0, Number(MAX_BRANDS))
        .map(r => {
          const b = byId.get(r.brandId);
          return { id: b.id, name: b.name, image_url: b.image_url, path: brandHref(b) };
        });

      if (rankedRecords.length) byBrandId[String(brand.id)] = rankedRecords;

      // small delay to be gentle on rate limits
      await new Promise(r => setTimeout(r, 450));
    }

    const outPath = `${OUTPUT_DIR.replace(/\/$/, '')}/related-brands.json`;
    await fs.writeJson(outPath, { byBrandId }, { spaces: 2 });
    console.log(`✅ Wrote ${outPath}`);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message || err);
    process.exit(1);
  }
})();
