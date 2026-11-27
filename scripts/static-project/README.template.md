# A Svelte app on Tinykit

Use Node 22+. With the updated Tinykit CLI installed, run `npm ci` (or `npm install` if there is no lockfile), then `tinykit dev`. Edit components and helpers under `src/`. Vite serves the app at `http://127.0.0.1:5180`. `npm run dev` also works.

The local preview reads `content.json`, `design.json`, and `schema.json`. Sample records start in `seeds.json` and persist separately in `.tinykit/local-data.json`. Editing source and fields does not reset records.

Run `tinykit check --json` after editing to build the current source and run the app's `test` script when defined. It returns one JSON result and exits nonzero on failure, with file/line/column diagnostics when available. Test output is included on failures; apps without tests explicitly report them as skipped. Check interactive behavior in the preview as well.

Sign in once for this server, then publish from this folder:

```sh
tinykit login --email you@example.com
tinykit publish
tinykit remote-status
```

The target is recorded in `tinykit.json`. Publishing builds first, checks that the source still matches the build, backs up the previous export in `.tinykit/before-publish.json`, and uploads both the source tree and built HTML. Changes to any hosted source file trigger a conflict; export into another folder and reconcile before publishing again.

The saved source tree includes `src/`, `tinykit/`, `scripts/`, the package manifest and lockfile, Vite/Svelte configuration, the HTML entrypoint, and project guidance. Imported binary assets under `src/` are preserved. Re-exporting restores those files byte-for-byte, including file additions and deletions. Source bundles have a 5 MB / 500-file limit; paths and symlinks are checked before upload or extraction.

Credentials, `.env` files, `.tinykit/`, dependencies, build output, local field JSON, and seed records stay outside the source bundle. Content, design and schema JSON are regenerated from the server on export. Publishing source does not replace hosted fields, schema, bookmark records, settings, backend code, or uploads. Source should contain only files intended for the app; files under `src/` can become browser code.

The published app uses Tinykit's existing data/realtime endpoints and loads live content/design fields every two seconds. JavaScript, CSS and imported assets are bundled into Tinykit's existing HTML artifact, so there is no per-app server. Use imported assets rather than public-directory files or output chunks; the publisher rejects unpackaged build files.

Tinykit Studio shows the published app and still manages fields and data. For a component app, its Code tab lists the saved files; source edits and publication happen in your local editor. The old single-file publishers cannot replace this app. This does not introduce app authentication, schema migrations, a release rollback system, or server-side SvelteKit rendering.

Local URL metadata fetching and export of runtime uploaded files are outside this example. Hosted URL metadata retains Tinykit's existing proxy. `npm run preview` serves static output only; use `npm run dev` for local fixture data or the published Tinykit URL for production verification.
