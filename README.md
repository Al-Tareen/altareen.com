# ALTAREEN.COM

A high-performance AI Product Management platform built to operationalize frameworks, analytics, and systems thinking into real-world execution.

Built with Astro, deployed via GitHub Actions, and powered by a hybrid SSR + static architecture.

---

## Overview

altareen.com is a high-performance, design-driven product surface built to showcase:

- AI Product Management expertise
- Strategic frameworks and toolkits
- Real-world projects and implementations
- Executive-level thinking and systems

The site is intentionally designed to feel:

- Premium (Apple-level design standard)
- Editorial (not template-based)
- Fast and minimal
- Technically precise

---
## Core Surfaces

- Homepage (curated product surface)
- Projects (portfolio + previews)
- PM Toolkit (114+ frameworks, dynamic)
- Finance Toolkit (financial models)
- Concepts (editorial insights)
- About (profile + contact system)
- Executive Dashboard (private analytics layer)

---

## Tech Stack

### Frontend
- Astro (Node SSR + static hybrid)
- Vanilla CSS (custom design system)
- Component-driven architecture

### Backend / Runtime
- Node SSR (Astro adapter)
- systemd service (VPS runtime)
- Lightweight file-based persistence (`.feedback-store.json`)

### Infrastructure
- VPS: InterServer (AlmaLinux 9)
- Web Server: Apache (reverse proxy + static routing)
- Control Panel: DirectAdmin

### Deployment
- GitHub Actions (CI/CD)
- rsync-based deployment
- Separate environments:
  - Production: `altareen.com`
  - Dev: `dev.altareen.com`

## License
This project is proprietary and not open source.

All rights reserved.  
See the LICENSE file for details.
---

## Key Features

### 1. PM Toolkit System
- 100+ frameworks synced from Notion
- Dynamic rendering via Astro collections
- Analytics-driven ranking:
  - Most Popular
  - Most Downloaded
  - Most Liked
- Clean, premium UI with expandable sections

### 2. Analytics Pipeline
- GA4 (event tracking)
- Microsoft Clarity (behavioral insights)
- Custom analytics script:
  - Pulls GA4 data
  - Generates `/src/data/toolkit-analytics.json`
  - Injected at build time

### 3. Automated Analytics Refresh
- GitHub Actions runs analytics script
- Rebuilds site with fresh metrics
- Designed for scheduled execution (hourly/daily)

### 4. Projects System
- Premium card-based UI
- Image + PDF preview modals
- Horizontal rail interaction (Apple-style)

### 5. Feedback System
- Like / Dislike API (`/api/framework-feedback`)
- File-based persistence (no database)
- SSR-enabled

---

## Why This Exists

Most product management content is static, fragmented, and theoretical.

altareen.com is built to turn:
- frameworks → actionable systems
- analytics → decision intelligence
- ideas → executable product surfaces

This is not a content site.

It is a **working system for building, analyzing, and scaling products.**

## Project Structure

```bash
/
├── public/
├── src/
│   ├── components/
│   ├── layouts/
│   ├── pages/
│   ├── content/
│   └── data/
│       └── toolkit-analytics.json
├── scripts/
│   └── pull-toolkit-analytics.mjs
├── .github/
│   └── workflows/
│       ├── deploy-dev.yml
│       └── deploy-prod.yml
├── package.json
