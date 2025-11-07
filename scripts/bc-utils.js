const axios = require("axios");
require("dotenv").config();

const { STORE_HASH, ACCESS_TOKEN } = process.env;
if (!STORE_HASH || !ACCESS_TOKEN) {
  throw new Error("Missing STORE_HASH or ACCESS_TOKEN in .env");
}
const API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;
const headers = {
  "X-Auth-Token": ACCESS_TOKEN,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function getAllPaged(url, params = {}, includeFields = "") {
  const results = [];
  let page = 1;
  while (true) {
    const res = await axios.get(url, {
      headers,
      params: { limit: 250, page, ...(includeFields ? { include_fields: includeFields } : {}), ...params },
    });
    const data = res.data?.data || [];
    results.push(...data);
    const meta = res.data?.meta?.pagination;
    if (!meta || page >= meta.total_pages) break;
    page++;
  }
  return results;
}

module.exports = { API_BASE, headers, getAllPaged };
