# Codex companion validation — 2026-10-21

The actual installed Codex CLI built a fresh app from a brief using its existing ChatGPT login. The companion previewed and published it twice to an isolated local production Node server, then twice to a separate **public Railway test instance**. Live records and hosted settings survived republication and a verified new container startup.

## Method

- Confirmed the installed CLI was logged in with ChatGPT. No `CODEX_API_KEY`, `OPENAI_API_KEY`, or `CODEX_ACCESS_TOKEN` override was present.
- Created a disposable blank Tinykit project through the authenticated builder API, with a `tasks` schema and a hosted-only sentinel record. Downloaded its ordinary authenticated export, with records excluded, and exported it to `../codex-e2e`.
- Used `codex exec` with the workspace-write sandbox and an ephemeral session to build **Launchpad** from that blank app. The brief requested task creation/completion/deletion, All/Active/Done filters, search, error handling, and persistence through `$data`. Codex was not given the hosted credentials or asked to deploy.
- Opened the real companion and interacted with the generated app in the browser. No mock database or simulated compiler was substituted.
- Isolated the Tinykit checkout from concurrent development, built the Node production server, and used a separate database with the actual hosted migrations/hooks. Its HTTP origin is `http://127.0.0.1:5204`; the companion is `http://127.0.0.1:5202/companion`.

## Verified behavior

1. Codex-generated source compiled and rendered in the live companion without hand-editing the app implementation.
2. Created two local tasks, completed/uncompleted a task, searched, used the Done filter, and deleted a task. Completion persisted across a browser reload and local data persisted across a companion restart.
3. Saved a hosted draft and published that saved draft through the companion buttons. The published app showed the pre-existing hosted-only task. The local preview task was absent.
4. Created another task through the published app, completed the original hosted task, and confirmed both changes after a browser reload.
5. Ran a second real Codex CLI invocation to change only the visible tagline. Confirmed its source was exactly the prior published source with that one replacement.
6. Published the changed local files through the companion. The published page showed the new tagline. The entire hosted record list was identical before and after publication, including record IDs and the completion state.

The two publication revisions were `df78914e…` and `708597f2…`. Project ID: `urec2b7du803r34`.

## Bug found and fixed

Polling a fresh project snapshot after a record write could re-run the preview's source/project watchers even when their values had not changed. This remounted the app and reset search/filter state. The watchers now compare the actual previous source, processing, revision, and project-ID values before compiling or resetting.

Repeated the browser regression with a searched task deletion. The search value and filtered empty state survived the subsequent companion data refresh. Ordinary source edits still rebuilt the preview, and existing local records remained available.

## Public Railway validation

- Instance: https://tinykit-production-afca.up.railway.app
- Published app: https://tinykit-production-afca.up.railway.app/tinykit/preview/urec2b7du803r34
- Railway project: `tinykit-codex-e2e-20261021`; one service and a volume mounted at `/app/pocketbase/pb_data`. No existing Railway project was changed.
- Built a clean source snapshot in a Node 22 Linux container. Generated credentials were configured at runtime, outside the upload folder. Setup completed before the public listener opened; repeat setup was rejected and unauthenticated hosted editing returned 401.
- Created a fresh project with a hosted-only task through its regular builder account. Exported it with hosted records excluded, restored the already Codex-authored app source locally, and started a separate companion at `http://127.0.0.1:5206/companion`.
- Published through the actual companion button. The public HTTPS app showed the original hosted task and excluded the local-only task. Created a new task in the public browser, changed both completion states, and verified those edits after reload.
- Ran the installed Codex CLI again to change only the hero tagline to “Built with Codex. Live on Railway.” Verified the exact source diff and the automatic companion preview update, then published through the companion again.
- Compared the entire hosted task array, including IDs and completion states, and hosted settings before and after publication. All were identical. The compiled HTML's definition marker matched the new publication; browser rendering confirmed the new visible tagline.
- Restarted the Railway service. Its new initialization log occurred after the republication check and before the persistence check. The same publication, records, and settings survived. Reloaded the public page and saved screenshots.

Public publication revisions: `708597f2…` and `bb739e15…`. Evidence: `../railway-validation/validation.json`, `public-validation.png`, and `companion-validation.png`. The test instance remains running.

### Issues found during hosting validation

The old download script did not reliably wait for ZIP extraction before exiting; the first container failed with an executable permission error. The script now awaits archive extraction, applies executable permissions, and downloads PocketBase 0.23.8, matching the tested runtime. A fresh macOS download executed successfully, followed by the successful Linux deployment.

The preview's watchdog could treat a suspension of its own timer as an iframe freeze. It now grants another heartbeat after the parent resumes. A temporary browser harness deliberately blocked the parent for 2.5 seconds; the preview remained usable without a false loop error. The harness was removed. Svelte checking passed with zero errors and the 15 existing warnings. Longer background/sleep testing remains useful.

## Guided project-tracker journey

The next milestone was tested through the new `tinykit start` browser launcher against the same isolated Railway instance. Starting with an empty local sign-in store, the browser connected the regular builder account, created **Studio projects**, prepared the app folder and local example records, and automatically opened a connected companion. There was no manual export, dependency install, project-ID entry, or linking step.

The real **Open in Codex** button wrote the current request and successfully opened the app folder using the installed desktop launcher. At this stage it copied a request for the user to paste; the one-click follow-up below replaces that handoff. The actual signed-in Codex CLI implemented that same request, adding project priorities and high-priority highlighting. Current-revision compilation succeeded, and the new control worked in the preview. Publishing through the browser review produced an empty live tracker, with all local examples excluded.

Created a hosted project and task in the public browser, set high priority, owner, deadline, and notes, and completed the task. Stopped the local launcher and preview, then restarted without specifying a server. **Continue** reopened the same app without another sign-in or setup step. Source customizations, the local priority edit, and the publishing connection were retained.

A second actual Codex invocation changed only the subtitle in `content.json`. The test exposed stale preview content after asynchronous module initialization. The iframe now receives the current source revision's content after imports and before mounting. The generated iframe message handler has a regression test; a live content-only edit and exact restoration both updated the already-open preview without a reload.

The publication review showed **“Keeps 1 project and 1 task”** and explicitly stated that this is a public app. The second publication changed the subtitle and preserved the complete hosted record arrays, IDs, high priority, owner, deadline, notes, completed task, active schema, and hosted settings. The published page was reloaded and checked in the browser.

- Launcher: http://127.0.0.1:5210
- Public tracker: https://tinykit-production-afca.up.railway.app/tinykit/preview/b1ba2d5ae74cb42
- Revisions: `f126e117…` → `60bbe113…`.
- Source and evidence: `../tracker-journey/`; `validation.json` contains no credentials.
- Final test suite: 265 passed, 0 failed, 3 optional runtime suites skipped. Production build passed. Those skipped suites are not claimed as run; this browser/Railway/Codex journey was tested separately.

The guided starter currently uses the single-component companion. Codex folder handoff is implemented for macOS with the app already installed, using the [documented CLI workspace launcher](https://learn.chatgpt.com/docs/cli/reference). First sign-in remains a user step; the one-click follow-up below removes pasting the request. Publishing is public; private app access and publication rollback are separate work.

## One-click Codex customization

The companion now starts `codex exec` using the existing ChatGPT sign-in, freezes the exact request, persists the task, and opens its saved chat using the documented [desktop thread link](https://learn.chatgpt.com/docs/reference/commands). No clipboard or manual send step is involved. The companion shows progress, the final update, View in Codex, and Stop. Only one Tinykit-started task edits each app at a time. Request and result survive reloads; a detached runner owns completion and a 30-minute limit. Stop terminates the task's process group, retaining edits already saved. Controls carry the displayed task ID so a stale tab cannot stop a newer request.

Tested two actual **Open in Codex** button clicks in the same Studio projects companion. Both submitted the exact textarea request and completed with the real signed-in CLI. The first changed the subtitle to “One click, a little more clarity.” The second changed it to “One click from idea to app.” Both reported current-revision compilation success; the already-open preview updated automatically. The desktop URL opener succeeded, and Codex's thread reader confirmed the submitted prompt, file edit, compile check, and completed turn. Native desktop UI automation is unavailable for Codex, so no native transcript screenshot is claimed.

Reloading the companion restored the second request and completed result. Exact assertions confirmed all other source/config/schema/design/seed files were unchanged. The three local projects, three tasks, and saved high priority remained. The public HTML still referenced the prior publication: these test requests did not publish.

Nine dedicated tests cover exact stdin submission and persistent thread IDs, environment isolation, active-task deduplication, stopping and retrying, stale task controls, failed/incomplete runs, unavailable authentication, symlink/path guards, spawned-command termination, disappearing executables, and abandoned task/lock recovery. The full suite passed with 282 tests, 0 failures, and 3 optional runtime suites skipped. Production build and Svelte checks passed (0 errors, 15 existing warnings). Final task-ID guard assertions also passed in the focused suite.

Evidence: `../tracker-journey/codex-autostart-validation.json` and `codex-autostart.png`. The CLI retains the user's model configuration, uses workspace-write sandboxing, and rejects permission-requiring commands instead of bypassing protections. Tinykit runtime credentials and inherited API keys are excluded from its environment. Codex must already be installed and signed in with ChatGPT. Desktop handoff is currently macOS-only.

## Claude Code one-click workflow

The same companion now offers Codex and Claude Code in an agent chooser. Requests, progress, Stop, the current-request file, and the workspace lock are shared. An active task cannot be replaced by starting the other agent. Older Codex task state remains readable in the existing runtime folder.

Updated this machine's existing user-local Claude Code npm installation from 1.0.31 to the official 2.1.307 package after the old updater failed. Subscription authentication was already available; no new sign-in or API key was needed. The application discovers this user-local installation before the old global PATH entry. CLI version and authentication checks run in the app's own directory, matching its settings scope.

Used the actual **Open in Claude Code** button twice in Studio projects. The first request changed only the subtitle to “A little clarity, with Claude.” The second changed it to “Your projects, with a little more clarity.” Both started automatically with no clipboard or manual send step, edited the source, and verified current-revision browser compilation with the permitted Tinykit status command. The first changed revision 4; the second observed pending compilation, checked again, and confirmed success for revision 5.

Claude's desktop import can run only after the CLI exits. Its CLI also rejects redirected output for `--desktop`, and macOS's `script` wrapper rejects Node's default stdin socket. The final launcher gives the fixed desktop-resume command a PTY with `/dev/null` input. The second complete button-driven test opened its saved session automatically, with CLI exit 0 and an explicit `Opening session` acknowledgement. Native Claude UI inspection timed out, so no visual verification of the native chat transcript is claimed. The companion and preview were verified in the browser.

After reload, the Claude selection, exact second request, completed result, and desktop-open acknowledgement were retained. Exact assertions confirmed every other source/config/schema/design/seed file and the entire local data object were unchanged. The public HTML still referenced the previous publication; neither test request published anything. API checks confirmed both agents were available, executable paths and process IDs were omitted, invalid providers returned 400, and cross-origin requests returned 403.

The full suite passed with 369 tests, 0 failures, and 3 optional runtime suites skipped. All 16 focused Codex/Claude tests passed after the final auth-directory and PTY fixes; these include cross-agent exclusion in both directions, cancellation, permissions, incomplete/error results, API-key rejection, exact stdin submission, persistent sessions, and desktop-resume without another prompt. The desktop mock now requires a real TTY on macOS, catching the launch bug. Production build and Svelte checking passed (0 errors, 15 existing warnings).

Evidence: `../tracker-journey/claude-autostart-validation.json` and `claude-autostart.png`. The requests use `dontAsk`, scoped file edits, a fixed preview-status command, no permission bypass, and no inherited provider/Tinykit credentials. Hooks and external MCP discovery are disabled for this invocation. Permission denials show needs-attention status. The 30-minute task limit and Stop controls apply to both agents. Claude Code 2.1.285+ and a subscription sign-in are prerequisites; macOS Desktop handoff is optional. See Anthropic's [CLI reference](https://code.claude.com/docs/en/cli-reference), [headless execution guide](https://code.claude.com/docs/en/headless), and [Desktop handoff](https://code.claude.com/docs/en/desktop#coming-from-the-cli).

## Saved-conversation follow-ups

Validated with the installed subscription-backed CLIs and the real companion API/browser. Each turn has a new task ID; the underlying agent conversation ID remains stable. Per-provider bindings and the last three request/update pairs live privately in the app's existing `.tinykit/codex/` runtime directory. Existing task history is migrated automatically, including the other agent's conversation when switching providers. Starting a fresh chat replaces only the selected provider's binding after the CLI confirms the new session.

- Resumed the earlier Codex chat `01a160fe-1cfe-7dc0-b0e9-5725c5774398`. Without repeating its previous subtitle, requested that it restore that value and append “ Refined together.” It correctly recalled “One click from idea to app.” despite Claude having changed the file in between, and verified revision 6 compiled successfully.
- Resumed Claude session `ca26bb64-082a-4c5d-b8ec-135e36898f0e`. The equivalent request correctly used its own earlier subtitle, yielding “Your projects, with a little more clarity. Refined together.” Revision 7 compiled successfully. A subsequent **Continue in Claude Code** browser request recalled that exact value, retained the session ID, and raised its saved turn count to 3.
- Used **Start new chat** and **Open in Codex** in the browser to remember a test phrase without editing files. **Continue in Codex** recalled the phrase on the next request without repeating it in the prompt. Both turns used `01a161a7-3bfa-7303-b924-f4012ada03e5`; the fresh chat did not change Claude's binding. The earlier session remains in Codex's own history.
- Verified agent switching, reload recovery, recent request history, the fresh-chat choice surviving polling, and cancellation of the fresh-chat choice before sending. Invalid agent/fresh-chat payloads returned 400. Status returned both saved conversations without executable paths or process IDs.
- Exact comparisons confirmed the entire local project/task data object was unchanged: 3 projects and 3 tasks, including IDs, priorities, and completion state. App source, project identity/configuration, design, schema and seeds matched the earlier baseline; only the requested subtitle changed. The Railway public HTML continued to reference publication `60bbe113…`; none of these changes were published.

Browser testing caught a real Desktop ownership issue: automatically opening Codex Desktop can leave an active writer attached to the saved conversation. Subsequent CLI resume correctly fails rather than forking. Requests now stay in the companion; **View in Codex / Claude Code** is an explicit optional handoff. Busy/unavailable sessions show a bounded, credential-free diagnostic and preserve the request for retry. Starting a new chat is always explicit. A companion-created chat with no automatic Desktop handoff successfully completed consecutive browser-driven turns. An existing chat still owned by Desktop requires closing its native chat/window before CLI continuation; the companion does not force ownership away from another writer.

Also fixed a preview watchdog false alarm uncovered during testing: embedded browser tabs can report visible while their native host is unfocused and iframe timers are throttled. Freeze detection now gives an unfocused/hidden preview fresh heartbeat and mount timing, and allows five seconds for companion mount/heartbeat timing instead of the studio’s tighter thresholds, while retaining detection for a focused preview. The real tracker rendered correctly after returning to the companion.

All 19 focused agent tests passed, covering same-ID continuation for both providers, independent bindings, legacy recovery, restart persistence, explicit fresh chats, failed/mismatched/busy resumes without silent replacement, scoped permissions, and cancellation. The full suite passed with 385 tests and 3 optional runtime suites skipped. Build and Svelte checks passed, with 0 errors and 15 pre-existing warnings.

Evidence: `../tracker-journey/companion-followup-validation.json` and `companion-followups.png`. Historical one-click sections above describe the earlier automatic Desktop handoff; this section supersedes that behavior.

## Automatic Codex completion handoff

Added **Open Codex when finished**, checked by default in the companion and remembered from the latest Codex request. Turning it off retains the companion-only workflow. The worker waits for the CLI’s actual `close` event, enters a short `handing_off` state, and then opens the same validated thread ID using the supported Desktop deep link. It never opens the native chat during a Tinykit-managed turn. Manual View is also unavailable while that agent is active. Failed and cancelled requests do not automatically open Desktop. An OS launch failure preserves the completed customization and offers manual View instead.

Verified two real subscription-backed handoffs with no-edit requests: the studio chat `01a161a7-3bfa-7303-b924-f4012ada03e5`, and the original chat from the reported lock-banner screenshot, `01a16194-4bfb-7e61-b5f0-ea78d392c178`. Both resumed their existing conversation, completed, exited their Tinykit runner/CLI, and acknowledged the Desktop open. After each handoff, an independent no-turn `thread/resume` ownership probe received the active-writer conflict. Since Tinykit’s processes had exited and no other test client retained a session, this verifies Desktop had taken ownership. The probes did not send model messages, fork, archive, or edit either chat. All app source hashes remained unchanged. No Retry click was used in these tests.

Codex blocks native UI automation of itself, so the composer/banner was not visually inspected. The supported deep link is documented in [OpenAI’s commands reference](https://learn.chatgpt.com/docs/reference/commands); the ownership probe used the documented [app-server protocol](https://learn.chatgpt.com/docs/app-server), with this installed CLI’s `workspace-write` sandbox enum. Tinykit does not modify Codex’s lock files, force another writer off the chat, or click native UI controls.

All 23 focused agent/handoff tests passed, and the full suite passed with 456 tests and 3 optional runtime suites skipped. Svelte checking reported 0 errors and 15 existing warnings. The optional production build was stopped after a concurrent verification run caused prolonged resource contention; no completed production-build result is claimed for this change. Focused tests cover delayed CLI exit, handoff state sequencing, preserving the same thread/request/summary, unavailable Desktop, invalid target IDs, cancellation/failure skips, active-View rejection, and the existing continuation and permission behavior. This section supersedes the previous companion-only Desktop default while retaining it as an unchecked option.

## Evidence and remaining scope

Local artifacts:

- `../codex-e2e/App.svelte` — app authored by Codex.
- `../codex-e2e/published-validation.png` — second publication and preserved hosted tasks.
- `../codex-e2e/companion-validation.png` — local preview and publishing controls.
- `../codex-e2e-validation.json` — publication IDs and record-preservation assertions; no tokens.

This validates a single-component app with the real Codex subscription, macOS companion, Linux container packaging, Railway HTTPS hosting, and persistent storage. It does not cover first-time CLI onboarding, a new Railway account, custom domains, multi-file app coverage, or a long-running reliability soak. The launcher and one-click handoff cover the guided tracker journey; fresh-account onboarding, additional starter coverage, and longer reliability testing remain follow-up work.
