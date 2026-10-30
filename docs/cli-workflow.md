# Edit and publish an app locally

Use Node 22+. Install this Tinykit checkout's dependencies and run `npm link` once to make `tinykit` available. Without linking, run `npm run tinykit -- <command>` from the checkout and pass the app folder to commands.

## Open an app in a local agent

On macOS, set up an app folder once with `tinykit edit .`, then install the Studio launcher:

```sh
tinykit launcher install
```

This builds a small native helper using Apple’s Command Line Tools and registers `tinykit://` links. It installs at `~/Applications/Tinykit Launcher.app`, pins the current Node 22 executable and Tinykit checkout, and needs no background listener. Keep those installations in place; rerun the install command after moving them. macOS may request access if your checkout or registered app is in a protected folder such as Desktop.

In Studio, choose **Edit with local agent**. Your browser may ask to open **Tinykit Launcher**. The helper resolves the exact server origin and app ID through your local workspace registry, starts or reuses its preview, and opens Codex with the folder and a prefilled composer. It does not submit a request or publish. The Studio dialog offers **Open again**, setup instructions, and **Copy command** if the helper isn’t installed or the browser doesn’t open it. The browser cannot report whether the native handoff completed.

The native link opens **registered, prepared apps only**. Unknown/moved/mismatched folders fail with setup instructions; it never exports a new app or installs dependencies in response to a browser link. Run the terminal command to perform that first setup:

```sh
tinykit edit <project-id> --server https://apps.example.com
```

The first run exports a normal Svelte app under `~/Tinykit Apps/` and installs its dependencies if needed. Sign in to that server first with `tinykit login --server <origin> --email <email>`. App records are excluded from this first export. If you already have an exported app, run `tinykit edit .` inside its folder once; subsequent project-ID commands find that exact folder and preserve unpublished edits. Use `--directory <folder>` with a project ID to select an existing matching folder or a new export destination. Existing unrelated/incomplete folders are never overwritten, and moved/mismatched registered folders require explicit re-registration.

The command starts or reuses the app's verified local preview and opens the installed Codex desktop app with that workspace and a prefilled composer containing the app identity, preview URL, and check/publish instructions. Describe the change you want and send it there. Opening the agent does not automatically submit a request or publish. This first handoff supports Codex desktop on macOS, using its existing sign-in. Its native workspace/composer link follows the [official deep-link reference](https://learn.chatgpt.com/docs/reference/commands).

Workspace associations are stored with owner-only permissions in `~/.config/tinykit/workspaces.json` (or `TINYKIT_CONFIG_DIR`), separate from credentials. `.tinykit/edit-context.md` contains local handoff context, and `.tinykit/edit-preview.log` records preview startup. These stay outside exported source. A preview started by `edit` stays running after the command exits. Use `tinykit status --json` and `tinykit stop` from the app folder to inspect or stop it; stopping verifies its saved session before signaling its own process. Previews started with an older CLI need a restart with the updated `tinykit dev` before reuse.

`tinykit edit . --register-only` adopts a folder without starting anything. `--no-agent` prepares the folder/preview/context without opening Codex; `--json` returns the resolved folder, preview URL, reuse state, and whether the native open request succeeded. Agent launches exclude Tinykit credentials and inherited API keys from their environment. Studio sends only a validated app identity, never a shell command, token, or local path. The helper invokes a fixed CLI entrypoint with argument arrays, validates exact link keys, and checks the registered folder’s current identity before opening it. Launcher errors appear in a native dialog; the last CLI result is saved privately at `~/.config/tinykit/launcher-last-result.json` (or the config directory selected at installation). There is no daemon, browser-accessible port, automatic install, or automatic agent submission.

## Sign in, export, edit, publish

```sh
tinykit login --server https://apps.example.com --email you@example.com
tinykit export <project-id> ./my-app
cd my-app
npm ci
tinykit dev
```

The project ID is the `id` in the app's Studio URL. If the export has no lockfile yet, use `npm install`; export prints which command to run. The last server you signed in to is the default for direct exports. Pass `--server <origin>` to select another server. Preview and publishing use the target saved in the app's `tinykit.json`.

Open this folder in your editor or coding agent and edit `src/` normally. Vite reloads saved changes. Local interactions use isolated records in `.tinykit/local-data.json` and cannot write to the hosted app. Records are excluded from export by default; add `--include-records` for a local sample.

Keep `tinykit dev` running in a terminal before handing the folder to an agent. The agent can edit files and run `tinykit check --json` without starting another server; this also works when its sandbox cannot open listening ports. Reuse installed dependencies rather than reinstalling them for each edit.

From the same folder:

```sh
tinykit check --json
tinykit publish
tinykit remote-status
```

Publishing builds with the project's installed dependencies, verifies source/build consistency, and uploads the complete source bundle and HTML. It confirms changed source files and the app URL. Hosted fields, schemas, records, settings, backend code and uploads are preserved. Local field/schema JSON edits are preview changes, not migrations.

`tinykit dev --port 5186 --no-open` prints a URL without opening a browser. Occupied ports fail without stopping other processes. Ctrl+C stops the preview started by that command and releases its workspace lock. Publishing also works with the preview open.

## Sign-in and conflicts

Sign-in is shared across folders for each server. Tokens are saved with owner-only permissions in `~/.config/tinykit/credentials.json`, outside exported projects. Passwords are entered without echoing and are not saved. `TINYKIT_CONFIG_DIR` selects another configuration directory. A saved login is never sent to another server origin. Sign in again when the session expires.

`tinykit logout --server <origin>` removes that shared session. Explicit `TINYKIT_TOKEN` / `TINYKIT_TOKEN_FILE` values override saved sessions, and older app-local credentials remain a compatibility fallback. Logout does not remove those separate credentials. Build/preview children do not inherit token environment variables.

A hosted source edit, including a child component, stops a stale publication. Export into a new folder, review and reconcile your edits, and publish from that copy. The CLI never force-links a component project to discard a conflict. Live record and field changes are not source conflicts. Failed builds leave the public app untouched. A lost publication response is reported as an unknown outcome; inspect remote status and the app before retrying.

## Status and formats

`tinykit check [directory] [--json]` actively validates an exported Svelte project without signing in or changing the hosted app. It builds with the app's installed Vite and runs `package.json`'s existing `test` script, including its npm lifecycle hooks. Projects without a test script report tests as `skipped`. The command returns nonzero if the build/tests fail or source changes during validation. Builds and publications share a lock; local preview can stay open.

JSON output is one object with `ok`, `runtime`, `source_hash`, `build`, `tests`, and `diagnostics`. Build and test stages have `state` and `exit_code`; failed stages include captured output (last 16,000 characters). Each diagnostic has `stage`, `severity`, `message`, `file`, `line`, and `column`; unavailable locations are null, and known columns are one-based. Setup/argument failures use the CLI's existing `{ ok: false, error }` envelope. Build/test children do not inherit Tinykit token environment variables. Checks time out after 120 seconds per stage; interruption stops the current stage and makes the check fail.

Fresh Svelte exports include agent instructions to run this command and fix failures. Existing component exports preserve their saved `AGENTS.md` exactly, so add the instruction there when adopting the new workflow. A successful check confirms compilation and declared tests, not full typechecking or browser runtime behavior; verify interactions in the preview too. Single-file companion projects keep their existing `status` workflow.

```sh
tinykit status --json
tinykit remote-status --json
tinykit publish --json
```

Local Svelte status reports the preview process, source hash, build state, and last successful CLI publication. It does not certify browser runtime behavior; Vite and the browser report those errors. Remote status compares local source, the export baseline, and hosted source and lists changed files.

Direct server export creates a normal Svelte/Vite project. Component bundles in downloaded JSON restore to that format too. An older single-file JSON download keeps its companion format by default; add `--svelte --server <origin>` to convert it. The CLI detects the format for dev/status/publish. Single-file apps retain the reviewed push → publish workflow; component projects publish directly.

See the [source-tree contract](static-svelte-roundtrip.md) for included files, limits, and server upgrades. Runtime uploaded-file export remains limited to the older companion workflow. The standalone `npm run publish` adapter still supports explicit token environment variables; the CLI uses shared sign-in.

## Verification

```sh
npm test
TINYKIT_TEST_COMPONENT_CLI=1 node --test tests/component-cli-runtime.test.mjs
npm run test:hosted
```

The component integration test uses temporary servers, credentials and a database. It covers shared sign-in, direct export, isolated local data, duplicate startup, shutdown, publication, failed child builds, hosted conflicts, fresh export/reconciliation, and record preservation. The hosted test checks the older companion flow.

`tests/check.test.mjs` runs real Vite builds and Node tests to verify skipped tests, compiler file/line diagnostics, failing tests, repair, token-environment exclusion, source mutation during checks, JSON exit status, and overlapping publication locks.

`TINYKIT_TEST_EDIT=1 node --test tests/edit.test.mjs` verifies registration, target identity, first export with records excluded, retained unpublished edits, escaped workspace/composer links, credential-environment exclusion, real preview startup/reuse, stale-session refusal, and shutdown. It also checks Studio link round trips, malformed/extra/duplicate URL parameters, refused unknown/retargeted workspaces, and the refusal to install missing dependencies through a link. Preview dependency caches live under each app's `.tinykit/`, including when test dependencies are shared, so app previews do not replace Studio's dependency cache. The initial Bookmarks acceptance run used Studio's actual **Edit with local agent → Copy command** dialog. The native launcher acceptance run compiled and installed the macOS helper, dispatched the registered `tinykit://edit` link through LaunchServices, and confirmed the registered Bookmarks folder and running preview were reused with the native Codex open request successful. All 32 source files and the four hosted bookmarks, fields, settings, backend and uploads were preserved.

On 2026-10-21, the installed local Codex CLI was given the Bookmarks source folder and a `/` search-focus brief using its existing ChatGPT sign-in. It edited three Svelte components and added a helper plus six guard tests, then ran `tinykit check --json` successfully. Dependency downloads were unavailable in its sandbox; it recovered exact lockfile versions from existing local installations. Browser verification ran against a separately started preview because that sandbox could not open a listener. The checks covered search focus without slash insertion, slash typing in search and the dialog, modified shortcuts, and dialog focus. The parent workflow published through the CLI, verified the shortcut in the published browser app, and compared all 32 source files byte-for-byte. The four hosted bookmarks, content/design fields, schema, settings, backend, and uploads were unchanged. This follows the [official non-interactive Codex workflow](https://learn.chatgpt.com/docs/non-interactive-mode); Tinykit's check command is independent of which coding agent is used.
