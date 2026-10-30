# Build an app from your agent

Start in your existing coding agent:

> Make a private CRM using Tinykit for just me: contacts, companies, deals,
> notes, and follow-ups.

The agent creates a local app, starts its preview, and edits files in the same
conversation. Tinykit runs the app and its database. A hosted server or Tinykit
account is not required for local creation, preview, or build checking.

## One-time installation

This milestone runs from a Tinykit source checkout with Node 22+. There is no
standalone npm distribution yet. In that checkout, install its dependencies and
then install the reusable skill:

```sh
npm install
npm run tinykit -- skill install
```

The installer adds `tinykit` under `${CODEX_HOME:-~/.codex}/skills`. Start a new
agent chat so it can discover the skill, or explicitly load its SKILL.md in an
existing chat. The skill includes a launcher pinned to this checkout and Node
runtime, so a global npm link is not required. Moving either installation needs
a skill reinstall. Use `--directory <skills-directory>` for another destination.
An unmanaged existing Tinykit skill is preserved rather than overwritten.

If you prefer a shell command on PATH, `npm link` from the checkout remains
available. The following examples use that `tinykit` command; the installed
skill's scripts/tinykit.mjs launcher supports the same arguments.

## Create, preview, and check

```sh
tinykit create ./my-crm --template crm --name "My CRM" --json
tinykit dev ./my-crm
tinykit check ./my-crm --json
tinykit status ./my-crm --json
```

Create supports `blank`, `crm`, and `project-tracker`. It refuses an existing
destination, creates a new stable project ID, and defaults to private visibility.
Use `--public` only for an intentionally public app. Creation has no hosted side
effects and does not start or invoke Codex/Claude.

The agent reads the generated AGENTS.md, TINYKIT.md, and instructions.md. This
first workflow uses one App.svelte plus content/design/schema JSON and flat
assets. The CRM starter is fully editable; it is not a separate fixed app.

Dev selects a free port for a newly created app and opens its **app-only
preview**. Keep the command running while using it. The optional editing workspace
is available at the separately printed editor URL. `tinykit dev --editor` opens
that workspace instead. Existing exported apps retain their original dev defaults.
Use `--no-open` when the agent will open the printed URL itself.

App records persist separately from files and survive source updates and dev
restarts. Source does not reset records. Examples in seeds.json initialize new
local collections only. A missing PocketBase executable reports the exact
installation recovery command; dependencies normally prepare it at install time.

Check compiles the current source with Tinykit's installed compiler. It works
without dev, a browser, a server account, or hosted credentials. Failures return
nonzero with structured diagnostics. It explicitly distinguishes compilation
from browser verification and skips app tests when there is no test runner.
Status works before dev starts and reports matching or stale headless checks.
Some agent sandboxes cannot inspect another process and report runtime state as
unknown; inspect the app URL rather than treating that as proof dev has stopped.

## First publication

Publish only when the user asks, to their own upgraded Tinykit instance. That
server needs the private-app and CLI-creation migrations and the complete
PocketBase hooks directory from this checkout.

```sh
tinykit login --server https://your-instance.example --email you@example.com
tinykit publish ./my-crm --server https://your-instance.example --json
```

The user enters their password into the CLI prompt, not the agent conversation.
The first publication requires an explicit server destination, creates an empty
owner-bound target, saves the local source as its draft, builds it, and activates
the result. The app name, privacy intent, server, and a creation ID are frozen
before the first creation request. A lost response retries that same intent and
never adopts another app with a colliding ID. Recovery returns the original
creation baseline, so intervening source edits still trigger conflict checks.

**The hosted app starts with no records. Locally entered records and sample data
stay local.** Source publication is not a data migration. Tell the user this
before first publication; transferring local records is a separate explicit task.

After first publication, the same folder remembers its destination:

```sh
tinykit publish ./my-crm --json
tinykit remote-status ./my-crm --json
```

For these newly created local-first apps, publish sends the current local files
and additive schema changes while preserving hosted records, uploads, access
settings, and services. Existing exported companion apps retain their explicit
push / publish-saved-draft workflow. Schema removals/type changes require a
separate migration. Conflicts or unknown outcomes must be checked rather than
bypassed with a different project ID or an automatically accepted baseline.

The resulting private app requires its owner's sign-in. Verify it separately
from the local sample preview. Configure backups on the real host as described
in [Private CRM](private-crm.md); opening a local preview does not configure them.

## Verification of this milestone

- Create/check/skill installation tests use fresh directories and no server.
- A separate agent used the installed skill, added a preferred contact method,
  created and edited a fictional contact in the browser, and verified it after
  reload. No hosted account was needed.
- The runtime journey creates a CRM, enters a local-only record, restarts dev,
  and verifies persistence. It then publishes to an isolated private host,
  confirms no local records were transferred, creates a hosted record, and
  republishes source plus an added field while comparing the hosted records.
- Server tests cover idempotent recovery, concurrent retries, collisions,
  account boundaries, metadata protection, and existing collection rules.

This does not finish standalone CLI distribution, hosting provisioning,
multi-component authoring for newly created apps, or local-to-hosted record
migration. Existing component-project exports continue to use their own workflow.
