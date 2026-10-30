---
name: tinykit
description: Build, customize, preview, and publish personal apps with Tinykit when the user asks to use Tinykit. Supports local-first apps with persistent data; does not replace an existing app's project format or hosting choice.
---

# Tinykit

Keep the coding conversation in the user's current agent. Tinykit supplies the
app preview, database, and optional hosting; the user does not need another agent
chat or the companion's embedded request box.

## Entry point

Use the installed `tinykit` command. If it is unavailable, this skill includes
`scripts/tinykit.mjs`, a Node launcher bound to the Tinykit installation. Run it
with `node` and the same arguments. It uses the installed runtime and reports
when that installation has moved or is missing. Do not assume Tinykit is a
published npm package or invent an install command. The current distribution
is a Tinykit source checkout with its dependencies installed using Node 22+.

For an existing app, read its AGENTS.md, instructions.md, and tinykit.json first.
Preserve its format and identity. Use its generated commands rather than
scaffolding another app over it.

## New app

Start locally. No server address, hosting account, API key, or coding-agent
subscription sign-in is required by Tinykit's create/check commands.

```sh
tinykit create ./my-crm --template crm --name "My CRM" --json
tinykit dev ./my-crm --no-open
```

Choose `--template blank` for an app without predefined collections, `crm`
for contacts/companies/deals/notes/follow-ups, or `project-tracker` for projects
and tasks. Apps default to private; use `--public` only when public access is
part of the user's intended app. Creation refuses an existing destination.

Read the generated AGENTS.md and TINYKIT.md. Edit the app to meet the user's
request. The supported new-app format is a single Svelte 5 component plus
JSON definitions and assets. For the data API, field formats, and limitations,
read [app-format.md](references/app-format.md).

Keep one dev process running. Use its printed **App only** URL, not the
**Editor** URL, when showing the user the app. New local apps reuse their last
port when it is free and otherwise select a free one. If an execution sandbox prevents a local listener, use the
environment's normal permission mechanism or explain the concrete limitation;
headless checks still work. Do not stop unrelated processes to free a port.

```sh
tinykit check ./my-crm --json
tinykit status ./my-crm --json
```

Check builds the current source without a browser or hosting connection and
returns nonzero on failure. It does not verify browser interactions, and it
reports app tests as skipped when no test runner is configured. Inspect changed
interactive behavior in the preview when browser access is available. Status
also distinguishes browser compilation from a successful headless check.

## Records

Use Tinykit's `$data` API for records. Source edits and restarts retain local
records separately from source files. `seeds.json` initializes new local
collections only. Never reset an existing database to demonstrate a change.
Keep credentials and `.tinykit/` runtime files out of app source and agent
requests. App-specific API limitations are in the generated TINYKIT.md.

## Publishing, when requested

Ask for the intended hosting destination only when publication requires it and
the user has not already provided one. Reuse the app's saved target. The user
signs into their own upgraded Tinykit instance with `tinykit login --server
<origin> --email <email>`; do not ask them to send a password or token in chat.

For a new local app, `tinykit publish ./my-crm --server <origin> --json` creates
an empty hosted target with the app's visibility, saves a draft, and publishes.
Subsequent `publish` commands send current source and additive schema changes,
preserving hosted records and uploads. A failed publication keeps the previous
live app. Follow the CLI's conflict instructions; do not acknowledge a changed
hosted baseline just to force a publish through.

**First publication does not transfer locally entered records or samples.**
Explain that the hosted app starts empty before publishing. Local records stay
in the local workspace. A data migration is a separate, explicit task. Verify
the resulting app using the owner's sign-in when it is private. Never treat a
successful local preview as evidence that a hosted app is deployed or private.
