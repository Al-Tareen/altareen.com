# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev                   # Astro dev server
npm run build                 # Pulls GA4 analytics then builds (production)
npm run preview               # Preview production build locally

# Content sync (requires .env)
npm run sync:toolkit          # Notion → markdown sync (toolkit, projects, finance models)
npm run toolkit:analytics     # GA4 → src/data/toolkit-analytics.json
```

There are no lint or test commands — this is a content/analytics platform, not a test-heavy application.

## Architecture

### Content Pipeline (Notion → Pages)

Content lives in Notion, not in Git. The sync flow is:

```
Notion Databases
  ↓  npm run sync:toolkit
src/content/toolkit/*.md      (100+ PM frameworks)
src/content/projects/*.md     (portfolio entries)
  ↓  Astro Content Collections (src/content/config.ts — Zod schema)
/toolkit/[...slug]  /projects/[slug]  (prerendered static pages)
```

When modifying content structure, update both the Notion sync script (`scripts/notion-sync-toolkit.mjs`) and the Zod schema in `src/content/config.ts` together — they must agree on frontmatter shape.

### Analytics Pipeline (GA4 → Build-time JSON)

```
GA4 API
  ↓  npm run toolkit:analytics  (also runs as part of npm run build)
src/data/toolkit-analytics.json
  ↓  imported directly into pages
"Most Popular / Downloaded / Liked" rankings on toolkit index
```

This file is generated at build time and committed to the repo via CI. Do not hand-edit it.

### Feedback API (SSR, file-backed)

`src/pages/api/framework-feedback.ts` is the only SSR route. It persists likes/dislikes to `.feedback-store.json` (on the VPS, not in Git) using atomic writes. Votes are deduplicated via an httpOnly SHA1-hashed cookie. This file must stay `prerender = false`; all other content pages use `prerender = true`.

### Hybrid Rendering

`astro.config.mjs` sets `output: "server"` globally, but content and portfolio pages individually export `export const prerender = true`. The only runtime SSR surface is the feedback API. Keep this distinction in mind when adding new pages — default to prerendering unless dynamic server behavior is needed.

### Deployment

Two GitHub Actions workflows deploy via rsync to an InterServer VPS (AlmaLinux 9) behind Apache:
- **Production** (`altareen-prod` systemd service): scheduled hourly + manual trigger
- **Dev** (`altareen-dev` systemd service): auto on push to `main`

The build step runs `npm run toolkit:analytics` before `astro build`, so GA4 credentials must be available as a GitHub secret (`GA4_CREDENTIALS_JSON`).

## Behavioral Guidelines

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that **your** changes made unused.
- Don't remove pre-existing dead code unless asked.

Every changed line should trace directly to the user's request.

### Goal-Driven Execution

Define success criteria before starting. Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Identify what triggers it, then confirm it's gone"
- "Refactor X" → "Ensure behavior is identical before and after"

For multi-step tasks, state a brief plan and verify each step before moving on.

## Key Conventions

- **Styling:** Vanilla CSS only — no Tailwind, no CSS-in-JS. Styles are colocated inside `.astro` component `<style>` blocks.
- **SEO/metadata:** All pages go through `src/layouts/BaseLayout.astro`, which injects JSON-LD, OG tags, and breadcrumbs. Pass metadata as props to this layout, not directly in `<head>`.
- **No JavaScript framework:** Interactivity is handled with inline `<script>` tags or vanilla JS — no React, Vue, or Svelte components.
- **Content frontmatter:** Fields like `dbTitle`, `notionId`, `cover`, and `files` are managed by the sync script. Don't add or remove these manually without updating `notion-sync-toolkit.mjs` and `src/content/config.ts`.
