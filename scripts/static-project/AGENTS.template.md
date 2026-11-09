# Svelte app

Use Node 22+ and Svelte 5 runes. Read instructions.md. Source starts at src/App.svelte; put components and helpers under src/. Tinykit modules are $content, $design, $data, and $tinykit.

When launched through tinykit edit, read .tinykit/edit-context.md for this workspace's current local preview URL and app identity. That file contains handoff context, not credentials.

Use installed dependencies when available. For a fresh folder, install with npm ci (or npm install without a lockfile). Start the preview with tinykit dev. After editing, run tinykit check --json and fix any failures before finishing. It builds the current source and runs package.json's test script when present. Failures exit nonzero; diagnostics include the stage, message, and file/line/column when available. Build success alone does not verify browser behavior; check interactive changes in the preview too.

tinykit status --json reports local preview/build state. tinykit remote-status --json compares local and hosted source. tinykit publish builds and publishes the complete source tree while preserving live Tinykit fields, schemas, records, settings, backend code, and uploads. Source edits to local content/design/schema JSON are preview changes, not hosted migrations.

Local records persist separately in .tinykit/local-data.json. Sign-in is shared across project folders and stays outside source. Never put credentials in browser source. Keep editable source under src/, scripts/, and tinykit/; configuration and the lockfile also round-trip. Read README.md for source-bundle limits and exclusions.
