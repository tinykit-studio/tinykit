# Local companion (first milestone)

Edit a Tinykit app with your existing coding agent and see the result in a local preview. External agents can edit the files directly. The optional one-click agent actions use your existing Codex ChatGPT or Claude Code subscription sign-in; Tinykit does not need an AI API key.

## Guided project tracker

With Node.js 22+ and this checkout installed, run `tinykit start` (or `npm run tinykit -- start` from the checkout). The browser launcher signs in to your existing hosted Tinykit account, creates a project tracker, exports its files, prepares local example data, and opens a connected companion. No manual export, project ID, dependency install, or link step is required. Use `--server <origin>` to prefill the instance address on first use. The instance must support the hosted workflow below.

Choose **Make change with Codex** after describing a change. On macOS this immediately submits the exact request using the installed Codex CLI and your existing ChatGPT sign-in, and keeps the persistent chat ready for follow-ups in the companion. There is no clipboard or manual send step. The preview shows progress and the agent’s update. **Open chat** reopens that same chat, and **Stop** cancels the task while retaining any edits already saved. Only one Tinykit-started task, across both agents, can edit an app at a time. Tasks survive browser/companion restarts and stop after 30 minutes. The project includes instructions and a current request file. Codex keeps the user's configured model, uses the workspace-write sandbox, and rejects commands requiring extra permission instead of bypassing the sandbox. Tinykit's runtime credentials and inherited API keys are excluded from the agent environment. Sign in to Codex with ChatGPT before starting; Tinykit does not install Codex or supply an API key. Desktop thread links are documented in [OpenAI's command reference](https://learn.chatgpt.com/docs/reference/commands); task execution uses [codex exec](https://learn.chatgpt.com/docs/cli/reference). Try the change in the preview. For an unconnected app, choose **Set up publishing** when you’re ready. Then choose **Review & publish**; the review reports live record counts without exposing record contents. Live records, uploads, and settings stay on the server. Local sample projects are never uploaded.

Choose **Claude Code** in **Customize with** for the same immediate request → preview → review → publish workflow. The installed Claude Code CLI must be version 2.1.285 or later and signed in with a Claude subscription (`claude.ai` authentication). Tinykit prefers the user-local native/npm installation before PATH and supports an explicit `TINYKIT_CLAUDE_BIN` override. No API-key fallback is used. Requests are sent on stdin, saved as resumable sessions, and streamed into the same progress and Stop controls. Codex and Claude share one workspace lock, so switching agents cannot start a second Tinykit-managed writer.

Follow-up requests automatically resume the selected agent's saved conversation for this app. Codex and Claude retain separate chats when you switch agents, reload the companion, or restart its server. The recent-requests disclosure shows the last three requests and updates. The composer clears after a completed request so you can describe the next refinement.

Choose **Start new chat**, then enter and send a request to begin a separate conversation for that agent. Switching back to **Keep using the saved chat** cancels this choice before sending. Starting a new chat does not reset source files, records, or the other agent's conversation. Older sessions remain in the agents' own history. For Codex, **Open chat in Codex Desktop when finished** is optional and remembered with the app’s last Codex request. Tinykit waits for its CLI process to exit before opening the same saved chat. Uncheck it to keep refining in the companion. Native View actions are unavailable while that agent is working; opening Desktop early can show a competing-writer banner. Claude Desktop remains an optional View action after completion. An idle native chat can claim the same conversation’s writer lock. If the native agent already owns the chat, finish there and close that native chat or window, then retry. The companion preserves the exact failed request and never forks around the lock. Existing companion chats from earlier versions are recovered automatically for both agents.

Each request gets its own task ID for progress and cancellation, while the provider's conversation ID is reused explicitly (`codex exec resume <id>` / `claude --resume <id>`). Tinykit never uses whichever session happens to be most recent globally. Only confirmed conversation IDs from this app's saved tasks become bindings, and the worker rejects an unexpected ID. If a saved session is unavailable, the request fails visibly; retry or explicitly start a new chat. The subscription, permissions, workspace lock, and publishing protections apply to follow-ups too.

Claude runs with `dontAsk` permissions, scoped Edit/Write tools, a fixed allow rule for the Tinykit preview-status command, and no permission bypass flag. Requests needing extra permissions show **needs attention** instead of a false success. Tinykit excludes inherited provider credentials and its own runtime credentials from the child environment. This invocation disables hooks and external MCP discovery. It leaves the user's model choice unchanged.

Claude Desktop cannot import an active CLI session. On macOS with Desktop installed, **View in Claude Code** opens the saved session **after** the CLI finishes. The desktop CLI requires a terminal connection; Tinykit provides it with the system's pseudo-terminal launcher and no user input. If Desktop cannot open, the request, edits, summary, and CLI session remain saved. Claude Code also works without Desktop installed. This behavior follows Anthropic's [CLI reference](https://code.claude.com/docs/en/cli-reference), [programmatic execution guide](https://code.claude.com/docs/en/headless), and [Desktop session handoff](https://code.claude.com/docs/en/desktop#coming-from-the-cli).

The launcher remembers app folders in `~/Tinykit Apps` (or the optional directory argument). **Continue** reopens the same folder and reuses its running preview. Setup retries use the same hosted project identity and retain local source edits. Stop the launcher to stop its local previews; published apps keep running. The project tracker is public by default: anyone with the link can view and edit its records. The Private CRM starter requires owner sign-in. The publication review states the app’s access before publication. See [Private CRM](private-crm.md) for setup and backups. Direct Svelte project exports are unchanged.

## Preview the app itself

Use **Open app preview** to view `/companion?view=app` without editing controls. This is still a local development preview. The published app has its own address and hosted records.

## Start from an existing app

For a normal Svelte project with components, use the [CLI workflow](cli-workflow.md). Direct server export creates a Svelte project; this guide describes the older single-file companion format, which the same CLI continues supporting.

Use Node.js 20.19+ and install this Tinykit checkout's dependencies with `npm install`. Installation downloads the PocketBase binary. From this checkout, run `npm link` once to make the `tinykit` command available.

1. Open your app in the updated Studio, sign in, and choose **Download Project File**. By default, the download contains source, authored content, design, and collection definitions. Select **Include current app records** and/or **Include uploaded files** only if you want those copied locally. Uploaded files may include private user submissions; Tinykit cannot currently distinguish those from design assets. Asset exports are limited to 50 MB. Service credentials and chat history are always excluded.
2. Convert the download to a new project folder:

   ```sh
   tinykit export ~/Downloads/my-app-export.json ~/Projects/my-app
   ```

   The parent directory must exist. Export refuses to overwrite an existing folder.
3. Start the companion:

   ```sh
   tinykit dev ~/Projects/my-app
   ```

   Or run `tinykit dev` from inside the app folder. It opens a local browser window. Use `--port 5197` to choose another port or `--no-open` to print the URL without opening it. An occupied port fails with an error; other processes are never stopped.
4. Open that same folder in your coding agent and edit `App.svelte`. Saved changes appear automatically. Syntax errors appear with line numbers in the companion and terminal; correcting the file clears them automatically. JSON import errors preserve the last imported project until the JSON is fixed.

Without `npm link`, run these from the Tinykit checkout:

```sh
npm run tinykit -- export /path/to/my-app-export.json /path/to/new-app-folder
npm run tinykit -- dev /path/to/new-app-folder
```

The exported `AGENTS.md` explains the files to coding agents. `instructions.md` retains the app's custom instructions. The companion URL can also be opened in a desktop agent's browser panel.

The CLI preserves the inclusion choices made in Studio's download dialog. When converting older JSON exports, records and assets are excluded by default; pass `--include-records` and/or `--include-assets` explicitly to copy data already contained in that download. Excluding uploaded files may leave image references that need matching files in `assets/`.

## Project files

| Path | Purpose |
| --- | --- |
| `tinykit.json` | Versioned format, app name, stable project ID |
| `App.svelte` | Single Svelte component, including script and styles |
| `content.json` | Tinykit content field definitions and values |
| `design.json` | Tinykit design field definitions and values |
| `schema.json` | Collection names and field definitions |
| `seeds.json` | Initial records for new local collections |
| `assets/` | App assets using their original flat filenames |
| `backend.js` | Preserved backend source; not executed in this milestone |
| `.tinykit/` | Ignored local database, process status, and syntax diagnostics |

The existing `$content`, `$design`, and `$data` imports work in the preview. The compiler supports the same third-party imports as Studio; those packages may require a network connection. Relative imports of additional components are not supported yet.

## Source and data behavior

Files control the source; editing happens in your external agent. The companion previews the app and provides hosted draft/publishing controls. File changes are checked twice before importing to coalesce editor saves. Invalid JSON leaves the previous imported state intact. Invalid Svelte is imported so both the syntax checker and the browser compiler can report the problem.

Run `tinykit status --json` from the app folder for structured feedback. It reports the current source revision, process state, and compilation state (`pending`, `success`, `error`, or `blocked` by an import error). Browser compilation requires the companion preview to be open; syntax validation alone never counts as a successful browser build. Reports from earlier source revisions, compilation attempts, or dev sessions are rejected or ignored. Browser bundling errors are available through this command, while runtime errors appear in the preview. `.tinykit/status.json` stores import/syntax diagnostics and `.tinykit/compile.json` stores browser reports; prefer the status command, which matches them by revision.

The companion starts its own PocketBase instance under the app's `.tinykit/` directory. Preview interactions persist in that local database; hosted connections are used separately for review and publishing. Source edits preserve local records. `seeds.json` initializes new collections only; changing it does not replace existing records. Removing a collection from `schema.json` does not delete its stored local data in this milestone. Uploaded files created inside the preview stay in the local runtime and are not written back into `assets/`.

The local server binds to `127.0.0.1`, accepts same-origin browser requests, and exposes only the companion and the current app's data/assets routes. A workspace lock prevents two companion processes from opening the same local database. Ctrl+C stops the processes started for that workspace.

Old asset-free JSON exports can also be converted. Older exports did not include uploaded assets or backend source; download a fresh export for those apps.

## Scope

The local companion covers export → file editing → local preview and errors. You can now [push definitions and publish to an upgraded hosted instance](hosted-workflow.md), preserving live records. Visual write-back, multiple source components, destructive schema migrations, and backend execution remain follow-up work. The CLI currently runs from an installed source checkout; a standalone distributable package is not included.

## Verification

```sh
npm test
npm run test:companion
npm run check
```

The runtime test starts temporary localhost servers and verifies atomic file edits, data preservation across edits and restart, syntax/JSON error recovery, stale compilation report rejection, local access boundaries, and shutdown cleanup. It is separate from `npm test` because restricted environments may not allow listening on local ports.

## Hosted publishing controls

The companion includes a **Hosted app** panel to connect, compare local/draft/published versions, save a draft, and publish. See [the hosted workflow](hosted-workflow.md#publish-from-the-companion). Source editing continues in your app folder, and local preview records are never pushed.
