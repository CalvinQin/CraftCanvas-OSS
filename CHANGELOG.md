# Changelog

## 0.7.1 — 2026-11-13

- Align public-page canonical URLs, structured data and sitemap with the trailing-slash URLs served by Sites.
- Match the same redirects in direct Worker deployments; preserve private-page URLs and authorization.

## 0.7.0 — 2026-11-13

### Added
- MIT license, bilingual project presentation, contribution and security policies, issue and PR templates, and CI.
- Product documentation for workflows, local development, self-hosting and known limitations.
- Eight pre-rendered public pages, route-specific search and sharing metadata, structured data, sitemap, Markdown mirrors and optional llms.txt.
- Proper missing-page responses, canonical URL redirects and private-page noindex headers.
- Explicit trusted-Sites identity setting; direct self-hosting ignores forged platform headers by default.

### Maintenance
- Refreshed dependency security patches and aligned the legacy migration loader with the current esbuild dependency.

### Included from the private development series
- Infinite product canvas, personal asset library and account-scoped cloud persistence.
- Six visual workflow node types, three templates, branch execution, successful-step caching and JSON backup.
- Version-checked saves, image deduplication, private model proxies, quotas and admin settings.

### Known limits
Browser workflows require an open page. Payments, email verification, password recovery, account merging, background execution and historical-object garbage collection are not implemented. Live provider quality requires separate validation.
