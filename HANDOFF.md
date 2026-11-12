# Maintainer handoff

Version 0.7.1 · 2026-11-13

Start with README.md, Design.md and docs/self-hosting.md. This public source package intentionally contains no deployment credentials, site project identity, user data or earlier private Git history.

## Release checklist

- Update version in package.json, package-lock.json and site/content.ts; update CHANGELOG and documentation.
- Run npm ci, npm run check, npm test, npm run build and npm run verify:seo.
- Scan staged source and reachable history for credentials before making any repository public.
- Review page rendering, private API authorization, actual deployed domain and canonical origin.
- Commit/push/publish only with maintainer authorization; create a matching version tag after the source push.
- Deployment success is separate from test success. Record release verification in the release notes without internal account identifiers.

## Known follow-ups

See docs/roadmap.md. Do not claim live model quality, paid checkout, background workflows or guaranteed search visibility from passing local checks.
