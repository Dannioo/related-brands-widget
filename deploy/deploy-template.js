// deploy/deploy-template.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const { STORE_HASH, ACCESS_TOKEN } = process.env;
if (!STORE_HASH || !ACCESS_TOKEN) {
  console.error("Missing STORE_HASH or ACCESS_TOKEN in .env");
  process.exit(1);
}

(async () => {
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "widget", "schema.json"), "utf8"));
    const template = fs.readFileSync(path.join(__dirname, "..", "widget", "template.html"), "utf8");

    const res = await axios.post(
      `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/content/widget-templates`,
      {
        name: "Related Brands (Auto)",
        template,              // raw HTML is fine; API accepts string
        schema,                // your UI schema JSON
        widget_configuration: {}
      },
      {
        headers: {
          "X-Auth-Token": ACCESS_TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    const tmpl = res.data?.data;
    console.log("✅ Created/Updated Widget Template");
    console.log("Name:", tmpl?.name);
    console.log("UUID:", tmpl?.uuid);

    // Optionally create a default widget instance right away:
    // (Place in the brand page region for all brands)
    const widgetRes = await axios.post(
      `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/content/widgets`,
      {
        widget_template_uuid: tmpl.uuid,
        name: "Related Brands – Default",
        widget_configuration: {
          heading: "Related brands",
          maxBrands: 12,
          dataUrl: "/content/related-brands.json"
        },
        placements: [
          {
            entity_id: 0,                 // 0 = all brands
            entity_type: "brand",
            template_file: "pages/brand", // region lives in pages/brand.html
            region: "brand_below_header"  // must exist in your theme
          }
        ]
      },
      {
        headers: {
          "X-Auth-Token": ACCESS_TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    console.log("✅ Created Widget Instance");
    console.log("Widget ID:", widgetRes.data?.data?.uuid || widgetRes.data?.data?.id);
  } catch (e) {
    console.error("❌ Error:", e.response?.data || e.message);
    process.exit(1);
  }
})();
