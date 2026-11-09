# Push and publish a local app

`tinykit push` saves a hosted draft containing the local app definitions. `tinykit publish` builds that draft on your machine and activates it on the hosted server. Publishing requires no open browser preview.

Both commands preserve hosted records, user uploads, service credentials, domain configuration, and chat history. `seeds.json` and the local preview database are never uploaded. Source assets use separate, immutable storage.

Apps can be public or private. A private app requires its owner’s Tinykit sign-in, including for records and uploads. Publishing preserves this setting. See [Private CRM](private-crm.md) for setup and recovery.

## Prepare the server

Upgrade the hosted Tinykit instance with this checkout, including the Node server, `pocketbase/pb_migrations/1792600000_add_hosted_workflow.js`, and the entire `pocketbase/pb_hooks/` directory. Restart PocketBase to apply the migration and load the hooks. The migration adds draft/publication/schema fields and a separate source-assets collection; it does not rewrite app records. Existing Docker/Railway packaging copies these files with the application.

The hosted workflow needs a regular Tinykit builder account in the `users` collection. Each operation checks that account's project view/update rules. Remote servers require HTTPS; HTTP is supported for loopback development servers.

## Publish from the companion

Start `tinykit dev` and open its companion URL. In **Hosted app**, enter the server address and project ID. Sign in with your builder email and password, or leave email blank to reuse this app's saved login. The password is used only to sign in; the origin-bound account token is saved in the ignored `.tinykit/` folder. The web interface does not use ambient `TINYKIT_TOKEN` variables.

**Review changes** compares local files, the saved hosted draft, and the last publication made with this workflow. When the current hosted source differs from its draft, it is shown too. Existing Studio publications without publication metadata cannot be compared as source artifacts here. Changes to records and user uploads are excluded.

**Save draft** uploads app definitions without making them public. **Publish local files** saves the draft, builds it locally, and activates it. **Publish saved hosted draft** publishes that saved version without uploading newer local files. Build errors and partial outcomes appear next to the controls; the previous public app stays available if the build fails.

Fresh exports already have a baseline. For an older export or hosted source conflict, compare the versions and choose **Accept reviewed versions** before pushing. This acknowledges the reviewed source/draft revisions; it does not merge or pull hosted files. Reconcile changes in your editor first. A file or hosted revision change after review stops the operation and requires a refresh.

The companion refreshes remote state every 15 seconds while idle; **Refresh** checks immediately. The app preview runs in an opaque-origin sandbox. Its capability permits access to its isolated local data only, and cannot access the hosted login or publishing endpoints.

## Sign in and publish

From an exported app folder:

```sh
tinykit login --server https://apps.example.com --email you@example.com
tinykit push
tinykit publish
```

Login prompts for the password without echoing it. It stores only an account token in `~/.config/tinykit/credentials.json`, with owner-only permissions and a binding to the selected server. Sign-in is shared across project folders; older `.tinykit/credentials.json` files remain a compatibility fallback. The generated `.gitignore` excludes this directory. To renew an expired login, run the login command again.

For automation, use `TINYKIT_TOKEN` or `TINYKIT_TOKEN_FILE` instead of saved credentials. These override the saved token. Tokens are sent in authorization headers and are excluded from exported source, builds, command results, and retry instructions. Do not store tokens in `tinykit.json`.

Fresh exports from the upgraded server include the hosted target and a source revision in `tinykit.json`. An older export needs a baseline:

```sh
tinykit link --server https://apps.example.com --project <project-id>
```

Link reads the hosted state and records the current source/draft revisions. It does not upload files. Review and reconcile hosted changes before linking: it acknowledges the currently hosted source as the baseline for your next push. Connection state is stored in `.tinykit/remote.json`.

Commands also accept an app folder argument when run from the Tinykit checkout:

```sh
npm run tinykit -- push /path/to/my-app --publish --json
npm run tinykit -- remote-status /path/to/my-app --json
```

With `npm link` installed, `tinykit push --publish` combines saving a draft and publishing it. JSON output distinguishes the push and publication outcomes. A successful push remains saved if publication fails. Run `tinykit publish` to retry that saved hosted draft without uploading local files again. If source correction is needed, edit locally and push the correction first.

## Drafts, conflicts, and records

A hosted CLI draft is separate from the current app source and public HTML. Saving it does not activate code or change public content. Publication updates the app's source/content/design and compiled artifact together inside a PocketBase transaction. The new artifact is compiled completely before that transaction; a failed build retains the previous public app.

The draft/publication transaction checks the hosted source revision and draft revision before writing. Edits made in Studio or by another CLI stop a stale push or activation with a conflict. Record changes and new runtime uploads do not count as source conflicts. There is no automatic pull, merge, or forced overwrite. Preserve your local work, download the updated hosted app into another folder, review/reconcile the changes, then link and push.

The hosted draft can be reviewed in the companion or through authenticated hosted status/API responses; Studio continues showing the current app source until publication. After publication, Studio contains the activated code, content, and design.

Schema activation uses a separate schema field. It supports new fields and new collections without replacing existing rows. Removing a collection/field, changing its type, or changing an existing field's options requires a separate explicit migration and is rejected by this workflow. The data API overlays activated schemas onto existing records; new collections start empty, regardless of local seeds. `tinykit push` and `publish` never set the hosted `data` field.

Source files under local `assets/` are uploaded to `_tk_source_assets`, separate from runtime `project.assets`. Files are addressed by content digest. Draft assets stay private until their draft is published, and previously published asset versions remain available to open app sessions. Neither source-asset deletion nor runtime-upload synchronization is included. Pushes support up to 6 MB of source assets and a 10 MB total request; production proxies must permit that request size.

## Check outcomes

```sh
tinykit remote-status --json
```

This reports the source, saved draft, published revision, publication time, and public URL. `tinykit status --json` continues to report the local companion's preview state.

Pushes and publications have unique request/attempt IDs. The server recognizes retries of the same operation. If a response is lost, the CLI checks hosted status for that ID. If it cannot establish an outcome, it reports `unknown`; inspect hosted status before retrying. IDs are scoped to the app, and reusing an ID for different content is rejected.

## Build scope and verification

The publisher compiles the hosted draft with Tinykit's installed Svelte/Vite dependencies, Tinykit's `$content`, `$design`, `$data`, and `$tinykit` modules, and a fixed build configuration. Project Vite configs, package scripts, environment files, and server-side app code are not executed. The output is a single HTML artifact with bundled JavaScript/CSS; rendering happens in the browser. This companion workflow retains its single-file format. Component apps use the [Svelte source-tree workflow](static-svelte-roundtrip.md); these single-file push/publish commands refuse to replace them. `backend.js` is preserved as source and is not executed by this workflow.

```sh
npm test
npm run test:hosted
npm run check
npm run build
```

The hosted integration test uses temporary server/database directories with migration generation disabled. It covers login, draft push, headless publication, live writes during push, records/uploads/settings preservation, additive schemas, private staged assets, immutable published asset versions, failed builds, source conflicts, activation checks, retries, and account permissions.
