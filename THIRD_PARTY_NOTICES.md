# Third-party software

Direct runtime dependencies currently used:

| Package | License | Use |
| --- | --- | --- |
| ai | Apache-2.0 | Gateway requests and constrained evaluation |
| libfx | Apache-2.0 | Agent orchestration and bundled WASM |
| marked | MIT | Markdown parsing |
| zod | MIT | Runtime validation |

Exact versions are recorded in `bun.lock`. Dependencies and transitive dependencies remain under their respective licenses, not the project's license. A dependency's inclusion is not an endorsement.

The build copies available LICENSE/COPYING/NOTICE files, including nested notices for vendored code, from installed runtime packages into `apps/extension/dist/licenses`, with a package/version index. This includes the ISC notice for the schema converter inside `@ai-sdk/provider-utils` and the nested MIT notice inside `undici`. The build also includes this document and the full [Apache License 2.0](licenses/Apache-2.0.txt), sourced from the [Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0.txt), because some packages provide only a short license header. Preserve these files when distributing extension builds. Review upstream notices and artifact provenance before publishing binaries; generated notices are not a legal audit.

The Ulka source logo (`ulka-logo.jpg`) and derived PNG icons (`apps/extension/public/icons`) are included under the project's MIT License, as confirmed by the maintainer.
