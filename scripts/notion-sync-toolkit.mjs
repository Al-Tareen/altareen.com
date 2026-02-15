import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ROOT_PAGE_ID = process.env.NOTION_TOOLKIT_ROOT_PAGE_ID; // Framework Repository page ID

if (!NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN in .env");
if (!ROOT_PAGE_ID) throw new Error("Missing NOTION_TOOLKIT_ROOT_PAGE_ID in .env");

const notion = new Client({ auth: NOTION_TOKEN });

const OUT_DIR = path.join(process.cwd(), "src", "content", "toolkit");

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function writeFileSafe(filepath, content) {
  fs.writeFileSync(filepath, content, "utf8");
}

function slugify(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function richTextToPlain(rt = []) {
  return rt.map((x) => x.plain_text).join("");
}

function getProp(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;

  if (p.type === "title") return richTextToPlain(p.title);
  if (p.type === "rich_text") return richTextToPlain(p.rich_text);
  if (p.type === "select") return p.select?.name ?? null;
  if (p.type === "multi_select") return (p.multi_select ?? []).map((x) => x.name);
  if (p.type === "relation") return (p.relation ?? []).map((x) => x.id);
  if (p.type === "url") return p.url ?? null;
  if (p.type === "files")
    return (p.files ?? []).map((f) => ({
      name: f.name,
      url: f.type === "external" ? f.external?.url : f.file?.url,
    }));
  return null;
}

async function listAllChildren(blockId) {
  let cursor = undefined;
  const results = [];
  while (true) {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

async function collectChildDatabasesRecursively(blockId, out) {
  const kids = await listAllChildren(blockId);

  for (const b of kids) {
    if (b.type === "child_database") {
      out.push({ id: b.id, title: b.child_database?.title || "Untitled DB" });
      continue;
    }
    if (b.has_children) {
      await collectChildDatabasesRecursively(b.id, out);
    }
  }
}

async function queryDatabaseAll(databaseId) {
  const results = [];
  let start_cursor = undefined;

  while (true) {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(start_cursor ? { start_cursor, page_size: 100 } : { page_size: 100 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion query failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    results.push(...(data.results ?? []));

    if (!data.has_more) break;
    start_cursor = data.next_cursor;
  }

  return results;
}

function mdEscape(s) {
  return String(s ?? "").replace(/\r\n/g, "\n").trim();
}

const pageTitleCache = new Map();

async function getPageTitleById(pageId) {
  if (!pageId) return null;
  if (pageTitleCache.has(pageId)) return pageTitleCache.get(pageId);

  const page = await notion.pages.retrieve({ page_id: pageId });

  // Find the title property dynamically
  const props = page.properties || {};
  const titleProp = Object.values(props).find((p) => p.type === "title");
  const title = titleProp ? richTextToPlain(titleProp.title) : null;

  pageTitleCache.set(pageId, title);
  return title;
}

async function resolveRelationTitles(ids = []) {
  const titles = [];
  for (const id of ids) {
    const t = await getPageTitleById(id);
    if (t) titles.push(t);
  }
  return titles;
}

async function main() {
  ensureOutDir();

  // Clean old generated files
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".md")) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  // 1) Find embedded databases under the root page
  const dbs = [];
  await collectChildDatabasesRecursively(ROOT_PAGE_ID, dbs);

  // de-dupe dbs
  const seenDb = new Set();
  const uniqDbs = dbs.filter((d) => (seenDb.has(d.id) ? false : (seenDb.add(d.id), true)));

  console.log(`Found ${uniqDbs.length} embedded database(s) under Framework Repository:`);
  uniqDbs.forEach((d) => console.log("-", d.title, d.id));

  let total = 0;

  // 2) Query each database and generate markdown for each row
  for (const db of uniqDbs) {
    const rows = await queryDatabaseAll(db.id);

    for (const row of rows) {
      // Adjust property names if yours differ
      const name = getProp(row, "Name") || getProp(row, "Title") || "Untitled";
      
      // --- Category normalization (supports select + multi_select + common property names) ---
      const primaryCategoryRaw =
      getProp(row, "PrimaryCategory") ||
      getProp(row, "Primary Category") ||
      getProp(row, "Primary") ||
      null;
    

      const categoriesRaw =
        getProp(row, "Categories") || // if Categories is multi_select, this will return an array
        getProp(row, "Category") ||    // if Category is multi_select in your DB
        getProp(row, "Framework Category") ||
        getProp(row, "Frameworks Category") ||
        getProp(row, "Group") ||
        null;

      // categories[] should always be an array of strings
      let categories = Array.isArray(categoriesRaw)
        ? categoriesRaw.map(String).filter(Boolean)
        : categoriesRaw
        ? [String(categoriesRaw)]
        : [];

// If these look like Notion page IDs (relation), resolve them to titles
if (categories.length && categories[0].includes("-")) {
  categories = await resolveRelationTitles(categories);
}

      // primaryCategory should be a single string
      let primaryCategory = primaryCategoryRaw ? String(primaryCategoryRaw) : "";

      // If primaryCategory is empty but categories has values, use first category
      if (!primaryCategory && categories.length) primaryCategory = categories[0];

      // If categories is empty but primaryCategory exists, include it
      if (primaryCategory && categories.length === 0) categories = [primaryCategory];

      // Final fallback
      if (!primaryCategory) primaryCategory = "Uncategorized";
      if (categories.length === 0) categories = ["Uncategorized"];
      // --- end category normalization ---
      
    

      const whenToUse = getProp(row, "When to Use This") || "";
      const inputs = getProp(row, "Inputs Required") || "";
      const output = getProp(row, "Output Artifact") || "";
      const mistakes = getProp(row, "Common Mistakes") || "";
      const link = getProp(row, "Link") || "";
      const files = getProp(row, "File") || [];

      const slug = slugify(`${primaryCategory}-${name}`) || `item-${row.id.slice(0, 8)}`;

      const fm = [
        "---",
        `title: "${mdEscape(name).replace(/"/g, '\\"')}"`,
        `primaryCategory: "${mdEscape(primaryCategory).replace(/"/g, '\\"')}"`,
        `categories: ${JSON.stringify(categories)}`,
        `dbTitle: "${mdEscape(db.title).replace(/"/g, '\\"')}"`,
        `notionId: "${row.id}"`,
        link ? `link: "${String(link).replace(/"/g, '\\"')}"` : `link: ""`,
        "---",
        "",
      ].join("\n");

      const fileLines =
        Array.isArray(files) && files.length
          ? files
              .filter((f) => f?.url)
              .map((f) => `- ${f.name}: ${f.url}`)
              .join("\n")
          : "";

      const body = [
        whenToUse ? `## When to use\n${mdEscape(whenToUse)}\n` : "",
        inputs ? `## Inputs required\n${mdEscape(inputs)}\n` : "",
        output ? `## Output artifact\n${mdEscape(output)}\n` : "",
        mistakes ? `## Common mistakes\n${mdEscape(mistakes)}\n` : "",
        link ? `## Link\n${link}\n` : "",
        fileLines ? `## Files\n${fileLines}\n` : "",
      ]
        .filter(Boolean)
        .join("\n");

      writeFileSafe(path.join(OUT_DIR, `${slug}.md`), fm + (body || "Coming soon.\n"));
      total++;
    }
  }

  console.log(`Synced ${total} toolkit item(s) from Notion → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
