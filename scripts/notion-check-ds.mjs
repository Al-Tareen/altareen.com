import "dotenv/config";
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const id = process.env.NOTION_CHECK_ID;

if (!id) throw new Error("Set NOTION_CHECK_ID env var");

async function run() {
  try {
    const ds = await notion.dataSources.retrieve({ data_source_id: id });
    console.log("DATA_SOURCE OK");
    console.log("id:", ds.id);
    console.log("title:", (ds.title || []).map(t => t.plain_text).join("") || "(no title)");
  } catch (e) {
    console.log("dataSources.retrieve failed:", e.code || e.name, e.message);
  }

  try {
    const db = await notion.databases.retrieve({ database_id: id });
    console.log("DATABASE OK");
    console.log("id:", db.id);
    console.log("title:", (db.title || []).map(t => t.plain_text).join("") || "(no title)");
  } catch (e) {
    console.log("databases.retrieve failed:", e.code || e.name, e.message);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
