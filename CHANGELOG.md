# Changelog

## v0.1.1 — unreleased maintenance update

- Fix Docker installation by copying the PocketBase download script before dependency installation and supplying bash and curl at runtime. Based on the community report and fix in [#8](https://github.com/tinykit-studio/tinykit/pull/8).
- Exclude host binaries, credentials, and local data from Docker builds; use Node.js 22 and pass custom model URLs through Compose.
- Add DeepSeek and custom OpenAI-compatible endpoints in Settings, including exact model IDs and keyless local servers.
- Use Chat Completions for custom endpoints in both the builder and history summaries.
- Preserve saved keys only for the same provider and endpoint, and allow clearing a saved local-server key.
- Correct Docker ports and environment instructions, document local-model networking, and replace outdated roadmap promises with current alpha status.
- Connect an unassigned domain to an existing app or create a new app while retaining access to the dashboard.
- Fix Canvas image uploads through built-in storage, including saved-image updates and recovery after failed uploads.
- Bundle the matching Svelte runtime for preview and publishing, and retry temporary failures loading other CDN dependencies.
- Preserve the order of rapid edits and allow later saves to proceed after a failed update.
- Improve realtime update handling, domain dialog scrolling, and editor type correctness.
- Default Docker and Railway request-body limits to 10 MB.
- Leave the unfinished JSON data importer and local-agent companion out of this release.

### Upgrading

Back up PocketBase data, rebuild, and restart Tinykit. Keep the same Compose project name and data volumes. Republish existing apps to receive the generated runtime and data-client fixes. The updated Canvas template applies to newly created Canvas apps; existing apps keep their source code and data.

This version follows the package's `0.1.0` version; the first published GitHub release was tagged `v0.0.1`.

## v0.0.1 — 2026-01-06

First published release. The package version was 0.1.0. Included the AI builder, Svelte editor and preview, starter kits, content and design editing, PocketBase storage, snapshots, and app publishing.
