import type { APIRoute } from "astro";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const prerender = false;

type FeedbackValue = "like" | "dislike";
type StoreRow = { likes: number; dislikes: number };
type StoreRecord = Record<string, StoreRow>;

const STORE_PATH = path.join(process.cwd(), ".feedback-store.json");

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function normalizeSlug(slug: string) {
  return String(slug || "").trim().toLowerCase();
}

function cookieNameForSlug(slug: string) {
  // Hash the slug so cookie names are always short + safe
  const hash = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 16);
  return `fw_vote_${hash}`;
}

async function readStore(): Promise<StoreRecord> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    // Basic shape guard
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as StoreRecord;
  } catch {
    return {};
  }
}

async function writeStoreAtomic(data: StoreRecord) {
  const tmpPath = `${STORE_PATH}.tmp`;
  const payload = JSON.stringify(data, null, 2);

  await fs.writeFile(tmpPath, payload, "utf-8");
  await fs.rename(tmpPath, STORE_PATH);
}

function getUserVoteFromCookie(raw?: string): FeedbackValue | null {
  return raw === "like" || raw === "dislike" ? raw : null;
}

function safeRow(row?: Partial<StoreRow>): StoreRow {
  return {
    likes: Math.max(0, Number(row?.likes || 0)),
    dislikes: Math.max(0, Number(row?.dislikes || 0)),
  };
}

// GET /api/framework-feedback?slug=...
export const GET: APIRoute = async ({ url, cookies }) => {
  const slug = normalizeSlug(url.searchParams.get("slug") || "");
  if (!slug) return json({ error: "Missing slug" }, 400);

  const store = await readStore();
  const row = safeRow(store[slug]);
  const total = row.likes + row.dislikes;

  const cookieName = cookieNameForSlug(slug);
  const userVote = getUserVoteFromCookie(cookies.get(cookieName)?.value);

  return json({
    slug,
    likes: row.likes,
    dislikes: row.dislikes,
    total,
    userVote,
  });
};

// POST /api/framework-feedback
// body: { slug: string, value: "like" | "dislike" | null }
export const POST: APIRoute = async ({ request, cookies, url }) => {
  try {
    const body = await request.json();
    const slug = normalizeSlug(body?.slug);
    const incoming = body?.value;

    const nextVote: FeedbackValue | null =
      incoming === "like" || incoming === "dislike" ? incoming : incoming === null ? null : null;

    if (!slug) return json({ error: "Invalid payload" }, 400);

    const cookieName = cookieNameForSlug(slug);
    const prevVote = getUserVoteFromCookie(cookies.get(cookieName)?.value);

    // Load store + ensure row
    const store = await readStore();
    const row = safeRow(store[slug]);
    store[slug] = row;

    // If vote changes, adjust counts
    if (prevVote !== nextVote) {
      // remove previous vote
      if (prevVote === "like") row.likes = Math.max(0, row.likes - 1);
      if (prevVote === "dislike") row.dislikes = Math.max(0, row.dislikes - 1);

      // add new vote
      if (nextVote === "like") row.likes += 1;
      if (nextVote === "dislike") row.dislikes += 1;

      await writeStoreAtomic(store);
    }

    // Cookie: set or delete
    // Use secure=true automatically when served over https
    const isHttps = url.protocol === "https:";

    if (nextVote) {
      cookies.set(cookieName, nextVote, {
        path: "/",
        sameSite: "lax",
        httpOnly: true, // frontend doesn't need to read it
        secure: isHttps,
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    } else {
      cookies.delete(cookieName, { path: "/" });
    }

    const total = row.likes + row.dislikes;

    return json({
      slug,
      likes: row.likes,
      dislikes: row.dislikes,
      total,
      userVote: nextVote, // server truth
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
};