import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ROOT_PAGE_ID = process.env.NOTION_TOOLKIT_ROOT_PAGE_ID;

if (!NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN in .env");
if (!ROOT_PAGE_ID) throw new Error("Missing NOTION_TOOLKIT_ROOT_PAGE_ID in .env");

const notion = new Client({ auth: NOTION_TOKEN });

const OUT_DIR = path.join(process.cwd(), "src", "content", "toolkit");
const COVERS_DIR = path.join(process.cwd(), "public", "toolkit-covers");
const FILES_DIR = path.join(process.cwd(), "public", "toolkit-files");

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });
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
        Authorization: `Bearer ${NOTION_TOKEN}`,
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

// Recursively walk blocks to find the first image block
async function findFirstImageUrlInBlocks(blockId, depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return "";

  const blocks = await listAllChildren(blockId);
  for (const b of blocks) {
    if (b.type === "image") {
      const img = b.image;
      if (img?.type === "external") return img.external?.url || "";
      if (img?.type === "file") return img.file?.url || "";
    }

    if (b.has_children) {
      const found = await findFirstImageUrlInBlocks(b.id, depth + 1, maxDepth);
      if (found) return found;
    }
  }
  return "";
}

async function findFirstImageUrlInPage(pageId) {
  return await findFirstImageUrlInBlocks(pageId, 0, 6);
}

async function downloadToFile(url, filepath) {
  if (!url) return false;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download (${res.status}): ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buf);
  return true;
}

function guessExtFromUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p.endsWith(".png")) return ".png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return ".jpg";
    if (p.endsWith(".webp")) return ".webp";
    if (p.endsWith(".pdf")) return ".pdf";
    if (p.endsWith(".docx")) return ".docx";
    if (p.endsWith(".pptx")) return ".pptx";
    if (p.endsWith(".xlsx")) return ".xlsx";
    if (p.endsWith(".zip")) return ".zip";
  } catch {}
  return "";
}

function extFromName(name = "") {
  const m = String(name).toLowerCase().match(/\.[a-z0-9]{2,6}$/);
  return m ? m[0] : "";
}

function toFrontmatterString(v) {
  return String(v ?? "").replace(/"/g, '\\"');
}

function firstLineExcerpt(text, maxLen = 220) {
  const first = mdEscape(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0];
  return (first || "").slice(0, maxLen);
}

// YAML frontmatter list for: [{name, url}]
function yamlListOfObjects(key, arr) {
  const safe = Array.isArray(arr) ? arr.filter((x) => x?.url) : [];
  if (!safe.length) return `${key}: []`;

  const lines = [`${key}:`];
  for (const f of safe) {
    const name = toFrontmatterString(f.name || "Attachment");
    const url = toFrontmatterString(f.url || "");
    lines.push(`  - name: "${name}"`);
    lines.push(`    url: "${url}"`);
  }
  return lines.join("\n");
}

async function main() {
  ensureOutDir();

  // Clean old generated markdown
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".md")) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const dbs = [];
  await collectChildDatabasesRecursively(ROOT_PAGE_ID, dbs);

  const seenDb = new Set();
  const uniqDbs = dbs.filter((d) => (seenDb.has(d.id) ? false : (seenDb.add(d.id), true)));

  console.log(`Found ${uniqDbs.length} embedded database(s) under Framework Repository:`);
  uniqDbs.forEach((d) => console.log("-", d.title, d.id));

  let total = 0;

  for (const db of uniqDbs) {
    const rows = await queryDatabaseAll(db.id);

    for (const row of rows) {
      const name = getProp(row, "Name") || getProp(row, "Title") || "Untitled";

      // --- Category normalization ---
      const primaryCategoryRaw =
        getProp(row, "PrimaryCategory") ||
        getProp(row, "Primary Category") ||
        getProp(row, "Primary") ||
        null;

      const categoriesRaw =
        getProp(row, "Categories") ||
        getProp(row, "Category") ||
        getProp(row, "Framework Category") ||
        getProp(row, "Frameworks Category") ||
        getProp(row, "Group") ||
        null;

      let categories = Array.isArray(categoriesRaw)
        ? categoriesRaw.map(String).filter(Boolean)
        : categoriesRaw
          ? [String(categoriesRaw)]
          : [];

      if (categories.length && categories[0].includes("-")) {
        categories = await resolveRelationTitles(categories);
      }

      let primaryCategory = primaryCategoryRaw ? String(primaryCategoryRaw) : "";
      if (!primaryCategory && categories.length) primaryCategory = categories[0];
      if (primaryCategory && categories.length === 0) categories = [primaryCategory];

      if (!primaryCategory) primaryCategory = "Uncategorized";
      if (categories.length === 0) categories = ["Uncategorized"];
      // --- end category normalization ---

      const whenToUseFull = getProp(row, "When to Use This") || "";
      const inputsRequired = getProp(row, "Inputs Required") || "";
      const outputArtifact = getProp(row, "Output Artifact") || "";
      const commonMistakes = getProp(row, "Common Mistakes") || "";
      const link = getProp(row, "Link") || "";

      // Notion attachments from DB property (signed URLs)
      const notionFiles = getProp(row, "File") || [];

      // ✅ compute slug BEFORE downloads
      const slug = slugify(`${primaryCategory}-${name}`) || `item-${row.id.slice(0, 8)}`;

      // ✅ excerpt for cards
      const whenToUse = firstLineExcerpt(whenToUseFull, 220);

      // ✅ cover image download (from first image block in page)
      let cover = "";
      try {
        const imgUrl = await findFirstImageUrlInPage(row.id);
        if (imgUrl) {
          const ext = guessExtFromUrl(imgUrl) || ".png";
          const filename = `${slug}${ext}`;
          const outPath = path.join(COVERS_DIR, filename);

          if (!fs.existsSync(outPath)) {
            await downloadToFile(imgUrl, outPath);
          }
          cover = `/toolkit-covers/${filename}`;
        }
      } catch (e) {
        console.warn(`Cover fetch failed for "${name}" (${row.id}):`, e?.message || e);
      }

      // ✅ download attachments locally, then write those local URLs into frontmatter
      const filesLocal = [];
      if (Array.isArray(notionFiles) && notionFiles.length) {
        for (let i = 0; i < notionFiles.length; i++) {
          const f = notionFiles[i];
          if (!f?.url) continue;

          const safeName = slugify(f.name || `attachment-${i + 1}`) || `attachment-${i + 1}`;
          const ext = extFromName(f.name) || guessExtFromUrl(f.url) || "";
          const filename = `${slug}--${i + 1}--${safeName}${ext}`;
          const outPath = path.join(FILES_DIR, filename);

          try {
            if (!fs.existsSync(outPath)) {
              await downloadToFile(f.url, outPath);
            }
            filesLocal.push({
              name: f.name || `Attachment ${i + 1}`,
              url: `/toolkit-files/${filename}`,
            });
          } catch (e) {
            console.warn(
              `File download failed for "${name}" (${row.id}) -> ${f.name}:`,
              e?.message || e
            );
          }
        }
      }

      const fm = [
        "---",
        `title: "${toFrontmatterString(mdEscape(name))}"`,
        `primaryCategory: "${toFrontmatterString(mdEscape(primaryCategory))}"`,
        `categories: ${JSON.stringify(categories)}`,
        `whenToUse: "${toFrontmatterString(whenToUse)}"`,
        `inputsRequired: "${toFrontmatterString(mdEscape(inputsRequired))}"`,
        `outputArtifact: "${toFrontmatterString(mdEscape(outputArtifact))}"`,
        `commonMistakes: "${toFrontmatterString(mdEscape(commonMistakes))}"`,
        `dbTitle: "${toFrontmatterString(mdEscape(db.title))}"`,
        `notionId: "${row.id}"`,
        `link: "${toFrontmatterString(link)}"`,
        `cover: "${toFrontmatterString(cover)}"`,
        yamlListOfObjects("files", filesLocal),
        "---",
        "",
      ].join("\n");

      const body = [
        whenToUseFull ? `## When to use\n${mdEscape(whenToUseFull)}\n` : "",
        inputsRequired ? `## Inputs required\n${mdEscape(inputsRequired)}\n` : "",
        outputArtifact ? `## Output artifact\n${mdEscape(outputArtifact)}\n` : "",
        commonMistakes ? `## Common mistakes\n${mdEscape(commonMistakes)}\n` : "",
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
