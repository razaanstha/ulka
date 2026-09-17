# Contributing

Use Bun and the committed lockfile. Run `bun install --frozen-lockfile`, then `bun run check` before submitting a change. No Gateway key is needed for the automated test suite.

Keep changes focused. Add a regression test for bug fixes, update documentation for behavior changes, and avoid adding dependencies for small helpers. Do not commit `node_modules`, build output, browser profiles, diagnostic exports, or credentials.

For live testing, load `apps/extension/dist` in a disposable browser profile and use `bun run test-page` first. Check Stop/Take over, error handling, and narrow-panel layouts when relevant. Mention what was actually tested; do not equate passing unit tests with working on every website.

Bug reports should include reproduction steps, expected/actual results, browser version, and build ID. Review any logs before attaching them. Report sensitive vulnerabilities privately as described in SECURITY.md.

Before publishing a release, run checks, review the permission list and model IDs, preserve the project's MIT License, review rights for newly added third-party assets, and include dependency licenses with any distributed build. Never include a preconfigured API key.
