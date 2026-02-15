import "dotenv/config";
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const q = process.env.NOTION_DEBUG_QUERY || "Frameworks";

async function run() {
  // Search data_sources (new Notion model)
  const dsRes = await notion.search({
    query: q,
    filter: { property: "object", value: "data_source" },
    page_size: 20,
  });

  console.log(`Found ${dsRes.results.length} data_sources for query "${q}":`);
  for (const ds of dsRes.results) {
    const title = (ds.title || []).map(t => t.plain_text).join("") || "(no title)";
    console.log("-", title);
    console.log("  id:", ds.id);
  }

  // Also search pages (helps if it's actually a page)
  const pageRes = await notion.search({
    query: q,
    filter: { property: "object", value: "page" },
    page_size: 10,
  });

  console.log(`\nFound ${pageRes.results.length} pages for query "${q}":`);
  for (const p of pageRes.results) {
    const titleProp = p.properties?.title?.title || p.properties?.Name?.title || [];
    const title = (titleProp || []).map(t => t.plain_text).join("") || "(no title)";
    console.log("-", title);
    console.log("  id:", p.id);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
