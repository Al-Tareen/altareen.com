import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TOOLKIT_ROOT_PAGE_ID = process.env.NOTION_TOOLKIT_ROOT_PAGE_ID;
const PROJECTS_ROOT_PAGE_ID = process.env.NOTION_PROJECTS_ROOT_PAGE_ID;

if (!NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN in .env");
if (!TOOLKIT_ROOT_PAGE_ID) {
  throw new Error("Missing NOTION_TOOLKIT_ROOT_PAGE_ID in .env");
}
if (!PROJECTS_ROOT_PAGE_ID) {
  throw new Error("Missing NOTION_PROJECTS_ROOT_PAGE_ID in .env");
}

const args = new Set(process.argv.slice(2));
const syncProjectsOnly = args.has("--projects-only");
const syncToolkitOnly = args.has("--toolkit-only");

if (syncProjectsOnly && syncToolkitOnly) {
  throw new Error("Use only one flag: --projects-only or --toolkit-only");
}

const notion = new Client({ auth: NOTION_TOKEN });

const OUT_TOOLKIT_DIR = path.join(process.cwd(), "src", "content", "toolkit");
const OUT_PROJECTS_DIR = path.join(process.cwd(), "src", "content", "projects");

const TOOLKIT_COVERS_DIR = path.join(process.cwd(), "public", "toolkit-covers");
const TOOLKIT_FILES_DIR = path.join(process.cwd(), "public", "toolkit-files");

const PROJECT_LOGOS_DIR = path.join(process.cwd(), "public", "project-logos");
const PROJECT_FILES_DIR = path.join(process.cwd(), "public", "project-files");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureAllDirs() {
  [
    OUT_TOOLKIT_DIR,
    OUT_PROJECTS_DIR,
    TOOLKIT_COVERS_DIR,
    TOOLKIT_FILES_DIR,
    PROJECT_LOGOS_DIR,
    PROJECT_FILES_DIR,
  ].forEach(ensureDir);
}

function cleanGeneratedMarkdown(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".md")) fs.unlinkSync(path.join(dir, f));
  }
}

function writeFileSafe(filepath, content) {
  fs.writeFileSync(filepath, content, "utf8");
}

function slugify(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function richTextToPlain(rt = []) {
  return rt.map((x) => x.plain_text).join("");
}

function mdEscape(s) {
  return String(s ?? "").replace(/\r\n/g, "\n").trim();
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

function extFromName(name = "") {
  const m = String(name).toLowerCase().match(/\.[a-z0-9]{2,8}$/);
  return m ? m[0] : "";
}

function guessExtFromUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p.endsWith(".png")) return ".png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return ".jpg";
    if (p.endsWith(".webp")) return ".webp";
    if (p.endsWith(".gif")) return ".gif";
    if (p.endsWith(".svg")) return ".svg";
    if (p.endsWith(".avif")) return ".avif";
    if (p.endsWith(".pdf")) return ".pdf";
    if (p.endsWith(".docx")) return ".docx";
    if (p.endsWith(".pptx")) return ".pptx";
    if (p.endsWith(".xlsx")) return ".xlsx";
    if (p.endsWith(".zip")) return ".zip";
  } catch {}
  return "";
}

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

function getProp(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;

  if (p.type === "title") return richTextToPlain(p.title);
  if (p.type === "rich_text") return richTextToPlain(p.rich_text);
  if (p.type === "select") return p.select?.name ?? null;
  if (p.type === "multi_select") return (p.multi_select ?? []).map((x) => x.name);
  if (p.type === "relation") return (p.relation ?? []).map((x) => x.id);
  if (p.type === "url") return p.url ?? null;
  if (p.type === "checkbox") return !!p.checkbox;
  if (p.type === "number") return p.number ?? null;
  if (p.type === "files") {
    return (p.files ?? []).map((f) => ({
      name: f.name,
      url: f.type === "external" ? f.external?.url : f.file?.url,
    }));
  }

  return null;
}

function getPageCoverUrl(page) {
  const c = page?.cover;
  if (!c) return "";
  if (c.type === "external") return c.external?.url || "";
  if (c.type === "file") return c.file?.url || "";
  return "";
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
      body: JSON.stringify(
        start_cursor ? { start_cursor, page_size: 100 } : { page_size: 100 }
      ),
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

function normalizeDbTitle(s = "") {
  return String(s).trim().toLowerCase();
}

async function discoverDatabases(rootId, label) {
  const found = [];
  await collectChildDatabasesRecursively(rootId, found);

  const seen = new Set();
  const uniq = found.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  console.log(`Found ${uniq.length} embedded database(s) under ${label}:`);
  uniq.forEach((d) => console.log("-", d.title, d.id));

  return uniq;
}

function getIsSensitive(row) {
  return (
    getProp(row, "IsSensitive") ??
    getProp(row, "Is Sensitive") ??
    getProp(row, "Sensitive") ??
    false
  );
}

function getTags(row) {
  const tagsRaw = getProp(row, "Tags") || getProp(row, "Tag") || [];
  return Array.isArray(tagsRaw)
    ? tagsRaw.map(String).map((t) => t.trim()).filter(Boolean)
    : tagsRaw
      ? [String(tagsRaw).trim()].filter(Boolean)
      : [];
}

function getComingSoon(row) {
  return (
    getProp(row, "ComingSoon") ??
    getProp(row, "Coming Soon") ??
    getProp(row, "Coming_Soon") ??
    false
  );
}

function getPosition(row) {
  const raw =
    getProp(row, "Position") ??
    getProp(row, "Order") ??
    getProp(row, "Sort") ??
    null;

  if (raw === null || raw === undefined || raw === "") return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function normalizeCategories(row) {
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

  return { primaryCategory, categories };
}

async function downloadPageImageFallback(pageId, slugBase, outDir, publicBase, fallbackExt = ".png") {
  try {
    const fullPage = await notion.pages.retrieve({ page_id: pageId });

    let imgUrl = getPageCoverUrl(fullPage);
    if (!imgUrl) {
      imgUrl = await findFirstImageUrlInPage(pageId);
    }

    if (!imgUrl) return "";

    const ext = guessExtFromUrl(imgUrl) || fallbackExt;
    const filename = `${slugBase}${ext}`;
    const outPath = path.join(outDir, filename);

    await downloadToFile(imgUrl, outPath);
    return `${publicBase}/${filename}`;
  } catch (e) {
    console.warn(`Image fallback fetch failed (${pageId}):`, e?.message || e);
    return "";
  }
}

async function downloadNamedAsset(fileObj, slugBase, outDir, publicBase, fallbackExt = ".png") {
  if (!fileObj?.url) return "";

  const safeName = slugify(fileObj.name || "asset") || "asset";
  const ext = extFromName(fileObj.name) || guessExtFromUrl(fileObj.url) || fallbackExt;
  const filename = `${slugBase}--${safeName}${ext}`;
  const outPath = path.join(outDir, filename);

  await downloadToFile(fileObj.url, outPath);
  return `${publicBase}/${filename}`;
}

async function downloadFilesToLocal(fileList, slugBase, outDir, publicBase) {
  const local = [];
  if (!Array.isArray(fileList) || !fileList.length) return local;

  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    if (!f?.url) continue;

    const safeName = slugify(f.name || `attachment-${i + 1}`) || `attachment-${i + 1}`;
    const ext = extFromName(f.name) || guessExtFromUrl(f.url) || "";
    const filename = `${slugBase}--${i + 1}--${safeName}${ext}`;
    const outPath = path.join(outDir, filename);

    try {
      await downloadToFile(f.url, outPath);
      local.push({
        name: f.name || `Attachment ${i + 1}`,
        url: `${publicBase}/${filename}`,
      });
    } catch (e) {
      console.warn(
        `File download failed -> ${f.name || `Attachment ${i + 1}`}:`,
        e?.message || e
      );
    }
  }

  return local;
}

async function syncToolkitDatabase(db) {
  const rows = await queryDatabaseAll(db.id);
  let total = 0;
  let skippedSensitive = 0;

  for (const row of rows) {
    const name = getProp(row, "Name") || getProp(row, "Title") || "Untitled";

    if (getIsSensitive(row) === true) {
      skippedSensitive++;
      console.log(`Skipping sensitive toolkit item: "${name}" (${row.id})`);
      continue;
    }

    const { primaryCategory, categories } = await normalizeCategories(row);

    const whenToUseFull = getProp(row, "When to Use This") || "";
    const inputsRequired = getProp(row, "Inputs Required") || "";
    const outputArtifact = getProp(row, "Output Artifact") || "";
    const commonMistakes = getProp(row, "Common Mistakes") || "";
    const link = getProp(row, "Link") || getProp(row, "URL") || "";
    const tags = getTags(row);
    const notionFiles = getProp(row, "File") || getProp(row, "Files") || [];

    const slug = slugify(`${primaryCategory}-${name}`) || `item-${row.id.slice(0, 8)}`;
    const whenToUse = firstLineExcerpt(whenToUseFull, 220);

    const cover = await downloadPageImageFallback(
      row.id,
      slug,
      TOOLKIT_COVERS_DIR,
      "/toolkit-covers",
      ".png"
    );

    const filesLocal = await downloadFilesToLocal(
      notionFiles,
      slug,
      TOOLKIT_FILES_DIR,
      "/toolkit-files"
    );

    const fm = [
      "---",
      `title: "${toFrontmatterString(mdEscape(name))}"`,
      `primaryCategory: "${toFrontmatterString(mdEscape(primaryCategory))}"`,
      `categories: ${JSON.stringify(categories)}`,
      `whenToUse: "${toFrontmatterString(whenToUse)}"`,
      `whenToUseFull: "${toFrontmatterString(mdEscape(whenToUseFull))}"`,
      `inputsRequired: "${toFrontmatterString(mdEscape(inputsRequired))}"`,
      `outputArtifact: "${toFrontmatterString(mdEscape(outputArtifact))}"`,
      `commonMistakes: "${toFrontmatterString(mdEscape(commonMistakes))}"`,
      `dbTitle: "${toFrontmatterString(mdEscape(db.title))}"`,
      `notionId: "${row.id}"`,
      `link: "${toFrontmatterString(link)}"`,
      `cover: "${toFrontmatterString(cover)}"`,
      yamlListOfObjects("files", filesLocal),
      `tags: ${JSON.stringify(tags)}`,
      "---",
      "",
    ].join("\n");

    const body = [
      tags.length ? `## Tags\n${tags.map((t) => `- ${mdEscape(t)}`).join("\n")}\n` : "",
      whenToUseFull ? `## When to use\n${mdEscape(whenToUseFull)}\n` : "",
      inputsRequired ? `## Inputs required\n${mdEscape(inputsRequired)}\n` : "",
      outputArtifact ? `## Output artifact\n${mdEscape(outputArtifact)}\n` : "",
      commonMistakes ? `## Common mistakes\n${mdEscape(commonMistakes)}\n` : "",
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSafe(path.join(OUT_TOOLKIT_DIR, `${slug}.md`), fm + (body || "Coming soon.\n"));
    total++;
  }

  return { total, skippedSensitive };
}

async function syncProjectsDatabase(db) {
  const rows = await queryDatabaseAll(db.id);
  let total = 0;
  let skippedSensitive = 0;

  for (const row of rows) {
    const name =
      getProp(row, "Project") ||
      getProp(row, "Name") ||
      getProp(row, "Title") ||
      "Untitled Project";

    if (getIsSensitive(row) === true) {
      skippedSensitive++;
      console.log(`Skipping sensitive project: "${name}" (${row.id})`);
      continue;
    }

    const { primaryCategory, categories } = await normalizeCategories(row);

    const descriptionRaw =
      getProp(row, "Description") ||
      getProp(row, "Summary") ||
      getProp(row, "Overview") ||
      "";

    const description = mdEscape(descriptionRaw).replace(/\n+/g, " ").trim();
    const summary = firstLineExcerpt(description, 220);
    const url = getProp(row, "URL") || getProp(row, "Link") || "";
    const tags = getTags(row).slice(0, 3);
    const comingSoon = getComingSoon(row);
    const position = getPosition(row);

    const notionFiles = getProp(row, "File") || getProp(row, "Files") || [];
    const logoFiles = getProp(row, "Logo") || getProp(row, "Logos") || [];

    const slug = slugify(`${primaryCategory}-${name}`) || `project-${row.id.slice(0, 8)}`;

    let logo = "";
    if (Array.isArray(logoFiles) && logoFiles.length > 0) {
      try {
        logo = await downloadNamedAsset(
          logoFiles[0],
          `${slug}--logo`,
          PROJECT_LOGOS_DIR,
          "/project-logos",
          ".png"
        );
      } catch (e) {
        console.warn(`Logo download failed for "${name}" (${row.id}):`, e?.message || e);
      }
    }

    if (!logo) {
      logo = await downloadPageImageFallback(
        row.id,
        `${slug}--logo`,
        PROJECT_LOGOS_DIR,
        "/project-logos",
        ".png"
      );
    }

    const filesLocal = await downloadFilesToLocal(
      notionFiles,
      slug,
      PROJECT_FILES_DIR,
      "/project-files"
    );

    const fm = [
      "---",
      `title: "${toFrontmatterString(mdEscape(name))}"`,
      `project: "${toFrontmatterString(mdEscape(name))}"`,
      `primaryCategory: "${toFrontmatterString(mdEscape(primaryCategory))}"`,
      `categories: ${JSON.stringify(categories)}`,
      `description: "${toFrontmatterString(description)}"`,
      `summary: "${toFrontmatterString(summary)}"`,
      `dbTitle: "${toFrontmatterString(mdEscape(db.title))}"`,
      `notionId: "${row.id}"`,
      `link: "${toFrontmatterString(url)}"`,
      `url: "${toFrontmatterString(url)}"`,
      `logo: "${toFrontmatterString(logo)}"`,
      `cover: "${toFrontmatterString(logo)}"`,
      yamlListOfObjects("files", filesLocal),
      `tags: ${JSON.stringify(tags)}`,
      `comingSoon: ${comingSoon ? "true" : "false"}`,
      `position: ${position ?? 0}`,
      "---",
      "",
    ].join("\n");

    const body = description ? `${description}\n` : "Coming soon.\n";

    writeFileSafe(path.join(OUT_PROJECTS_DIR, `${slug}.md`), fm + body);
    total++;
  }

  return { total, skippedSensitive };
}

async function main() {
  ensureAllDirs();

  if (!syncProjectsOnly) {
    cleanGeneratedMarkdown(OUT_TOOLKIT_DIR);
  }
  if (!syncToolkitOnly) {
    cleanGeneratedMarkdown(OUT_PROJECTS_DIR);
  }

  let toolkitTotal = 0;
  let toolkitSkipped = 0;
  let projectsTotal = 0;
  let projectsSkipped = 0;

  if (!syncProjectsOnly) {
    const toolkitDbs = await discoverDatabases(
      TOOLKIT_ROOT_PAGE_ID,
      "Framework Repository"
    );

    const toolkitContentDbs = toolkitDbs.filter(
      (db) => normalizeDbTitle(db.title) === "frameworks"
    );

    if (!toolkitContentDbs.length) {
      console.warn("No Frameworks database found under NOTION_TOOLKIT_ROOT_PAGE_ID.");
    }

    for (const db of toolkitContentDbs) {
      const res = await syncToolkitDatabase(db);
      toolkitTotal += res.total;
      toolkitSkipped += res.skippedSensitive;
    }
  }

  if (!syncToolkitOnly) {
    const projectDbs = await discoverDatabases(
      PROJECTS_ROOT_PAGE_ID,
      "Projects"
    );

    const projectContentDbs = projectDbs.filter((db) => {
      const t = normalizeDbTitle(db.title);
      return t === "projects" || t === "project";
    });

    if (!projectContentDbs.length) {
      console.warn("No Projects database found under NOTION_PROJECTS_ROOT_PAGE_ID.");
    }

    for (const db of projectContentDbs) {
      const res = await syncProjectsDatabase(db);
      projectsTotal += res.total;
      projectsSkipped += res.skippedSensitive;
    }
  }

  if (!syncProjectsOnly) {
    console.log(`Synced ${toolkitTotal} toolkit item(s) → ${OUT_TOOLKIT_DIR}`);
    if (toolkitSkipped > 0) {
      console.log(`Skipped sensitive toolkit item(s): ${toolkitSkipped}`);
    }
  }

  if (!syncToolkitOnly) {
    console.log(`Synced ${projectsTotal} project item(s) → ${OUT_PROJECTS_DIR}`);
    if (projectsSkipped > 0) {
      console.log(`Skipped sensitive project item(s): ${projectsSkipped}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});