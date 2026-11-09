# Bookmarks: Svelte files → Tinykit

Bookmarks is an ordinary Svelte 5 + Vite project whose complete source tree can be published and exported again. Local agents edit normal files, Vite builds them, and Tinykit continues hosting the app's fields and data.

The working example is `../bookmarks-app`. Its visible local change adds alphabetical/newest-first sorting, result counts, and tag search. The new Tinykit project is **Bookmarks — local round trip** (`g44lp5v9y01a8op`). No existing app was replaced.

## Try the example

The supported entry point is now the [Tinykit CLI workflow](cli-workflow.md): sign in once, export directly from a server, then use `tinykit dev` and `tinykit publish`. The scripts below remain available as lower-level adapters.

Use Node 22 or newer. In `bookmarks-app`:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5180`. Edit `src/App.svelte`, `content.json`, or `design.json`. Local bookmark changes persist in `.tinykit/local-data.json`; they never touch the hosted database.

To publish to the server named in `tinykit.json`, supply a Tinykit **builder** token through `TINYKIT_TOKEN_FILE` (a private file) or `TINYKIT_TOKEN` in your shell environment:

```sh
npm run publish
```

With the local Tinykit server running, the published example is at `http://127.0.0.1:5173/tinykit/preview/g44lp5v9y01a8op`.

## Export another copy

Download the project's JSON export from Tinykit; include sample records if wanted. From `tinykit-studio`:

```sh
node scripts/static-project/export.mjs /path/to/export.json /path/to/new-app http://127.0.0.1:5173
```

The destination must not already exist. Export does not include service credentials or chat history. Uploaded assets and local URL metadata fetching are outside this first experiment.

## What stays connected

- `$content` and `$design` use a small runtime adapter. Hosted pages fetch public display fields from `/_tk/config/:id` and refresh visible pages every two seconds. CSS custom properties update with the design values.
- `$data` uses Tinykit's existing CRUD and realtime endpoints when published. Vite serves isolated sample records during local development.
- Publishing saves a versioned `source_bundle` alongside the built HTML artifact and `frontend_code`. Live content, design, schemas, records, settings, and backend code remain on the server. Local field/seed changes are preview changes, not migrations.
- A source hash covers the entire tree, including child components, helpers, configuration, and dependency files. It rejects stale publishes. A build stamp rejects source changes during or after a build. A private export backup is saved in `.tinykit/before-publish.json`. The server hash check is optimistic, not a transactional release system.
- JavaScript and CSS are bundled into the existing HTML attachment. Hosting needs no per-app Node process, framework server, or CDN compiler.

## Components and source storage

`src/App.svelte` coordinates data and view state. `src/components/` contains the header, tag sidebar, sort toolbar, bookmark collection, card, row, and add-bookmark dialog. `src/lib/bookmarks.js` holds pure search/tag/sort helpers; `src/styles/bookmarks.css` holds shared styles. Components use ordinary relative imports.

The versioned bundle stores exact file bytes for `src/`, `tinykit/`, `scripts/`, package manifests/lockfiles, Vite/Svelte configuration, the HTML entrypoint, and project guidance. Binary assets imported from `src/` are supported. Re-export restores the saved files, including additions and deletions; it does not regenerate a scaffold over the saved source. The freshly restored example was installed with `npm ci`, then a child-only edit was built and published from that copy.

The bundle excludes `.env` files, credentials, `.tinykit/`, `node_modules/`, builds, seeds, and local content/design/schema JSON. Export regenerates the field JSON from the hosted app. Limits are 500 files and 5 MB of decoded source; unsafe paths, case collisions and symlinks are rejected. Production proxies and the Node adapter must allow the request size; configure `BODY_SIZE_LIMIT=20M` when using the maximum source/build limits.

Hosting still uses one bundled HTML artifact. Imported assets are inlined; public-directory copies and extra output chunks are rejected. Schema migrations, runtime uploaded-file export, multi-user app roles, and release rollback remain separate work. Apps marked private require their owner’s Tinykit sign-in across pages, data, realtime, and files; see [Private CRM](private-crm.md). Existing public apps retain their public data access.

Studio previews the published component app and manages fields/data. Its Code tab lists saved source files and shows the root for reference. Source editing and publication happen in the local project. Legacy single-file publishing paths refuse to replace an app that has a source bundle.

## Server upgrade

Deploy the Node application with `pocketbase/pb_migrations/1792600100_add_source_bundle.js` and the updated PocketBase hooks, then restart PocketBase. The migration adds one JSON field and leaves records untouched. The publisher refuses to upload a component app to a server that lacks this field. Existing single-component exports still work and receive a source bundle on their next publication.

## Verification

```sh
node --test tests/static-project.test.mjs
```

The tests cover isolated persistent CRUD, concurrent local writes, field refresh, project/origin boundaries, safe artifact packaging, realtime create deduplication, authenticated publishing, source conflicts, exact source preservation across repeated multipart uploads, nested/binary source round trips, child-only conflicts, source deletions, private-file exclusions, and stale-build rejection. The example was also exercised in a browser against Vite and the local Tinykit server.
