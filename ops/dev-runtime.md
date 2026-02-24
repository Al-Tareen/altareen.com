# Dev runtime (dev.altareen.com)

## Overview
- `dev.altareen.com` is an Apache reverse proxy to a local Astro Node server on `127.0.0.1:4321`.
- Deployed artifacts directory (VPS):
  `/home/admin/domains/dev.altareen.com/public_html`
- The Node server is managed by systemd:
  `altareen-dev.service`
- Feedback API:
  `GET/POST https://dev.altareen.com/api/framework-feedback`

## Quick health checks (VPS)
```bash
systemctl is-active altareen-dev
ss -tulpen | grep ':4321'
curl -I https://dev.altareen.com
curl -i "https://dev.altareen.com/api/framework-feedback?slug=business-plans-apacen"