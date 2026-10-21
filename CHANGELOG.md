# Changelog

## Unreleased — maintenance update

- Fix Docker installation by copying the PocketBase download script before dependency installation and supplying bash and curl at runtime. Based on the community report and fix in [#8](https://github.com/tinykit-studio/tinykit/pull/8).
- Exclude host binaries, credentials, and local data from Docker builds; use Node.js 22 and pass custom model URLs through Compose.
- Add DeepSeek and custom OpenAI-compatible endpoints in Settings, including exact model IDs and keyless local servers.
- Use Chat Completions for custom endpoints in both the builder and history summaries.
- Preserve saved keys only for the same provider and endpoint, and allow clearing a saved local-server key.
- Correct Docker ports and environment instructions, document local-model networking, and replace outdated roadmap promises with current alpha status.

## v0.0.1 — 2026-01-06

First published release. The package version was 0.1.0. Included the AI builder, Svelte editor and preview, starter kits, content and design editing, PocketBase storage, snapshots, and app publishing.
