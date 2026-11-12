# CraftCanvas architecture

Version 0.7.0 · 2026-11-13

## Boundaries

- `components/`, `App.tsx`: React product UI and canvas.
- `workflow/`: graph validation, invalidation, templates and browser scheduler. Two ready steps may run concurrently; successful unchanged results are reused.
- `services/`: browser requests and persistence. Account checks and ETag conflicts prevent accidental cross-session or stale writes.
- `server/`: Worker API, authentication, quotas, encrypted settings and provider adapters.
- `db/` and `drizzle/`: D1 schema and append-only migrations.
- `site/`: public page content and rendering. The build produces usable HTML before JavaScript runs.

## Data flow

Authentication resolves a local session first, then optionally trusted Sites identity. Ordinary self-hosting never trusts caller-supplied identity headers. Admin access requires an exact server-side allowlist.

D1 stores accounts, metadata, usage and the current snapshot key. R2 stores content-addressed private images and immutable project/workflow snapshots. Account-derived storage prefixes isolate assets. Saving uploads a new snapshot and conditionally updates its revision; stale writers receive a conflict rather than overwriting newer content. Old snapshots are retained; garbage collection is not implemented.

Generation runs through server-side provider adapters. Credentials do not enter the client bundle. Usage reservation and completion track quota and credit outcomes. A network timeout cannot guarantee that a provider did not process a request.

## Public delivery

Vite builds client chunks. `scripts/prerender.mjs` renders the same React public pages into HTML, creates route-specific metadata, Markdown, sitemap and llms.txt, and preserves a separate private app shell. The Worker maps known pages to internal asset files to avoid static-host clean-URL redirect loops. Unknown paths return HTTP 404; private app pages carry noindex.

Set `CRAFTCANVAS_PUBLIC_SITE_URL` in the build process to enable production indexing metadata. An unset value produces a noindex local build. Access permissions still control whether a crawler can actually reach the site.

## Validation

Node test suites exercise graph rules, scheduling, cloud conflicts, authentication, admin boundaries and usage behavior with local SQLite and mocked providers. `verify:seo` inspects production artifacts and public/private route separation. Browser checks cover layout and navigation. Real paid-provider testing is a separate activity.
