# Tinykit app format

New CLI-created apps use `format_version: 1` in `tinykit.json`. They are Svelte
5 browser apps, served by Tinykit with persistent data. Node 22+ and the Tinykit
installation provide the compiler and runtime dependencies. A new app does not
need its own npm install, agent integration, API key, or hosted server.

| File | Purpose |
| --- | --- |
| `App.svelte` | App interface and logic; one Svelte component |
| `content.json` | Editable text/content field definitions |
| `design.json` | Design field definitions and CSS variables |
| `schema.json` | Collection names and field definitions |
| `seeds.json` | Examples used only when creating new local collections |
| `assets/` | Flat filenames for authored images/files |
| `instructions.md` | App-specific requirements |
| `.tinykit/` | Private runtime database, diagnostics and publishing state |

`backend.js` is retained for portability but is not executed. Do not add a
second SvelteKit/Express server. Relative component imports are outside this
format; retain one component for this first workflow. Existing format-2 Svelte
projects are supported by their own generated AGENTS.md and should stay in that
format. Dependencies resolve from the Tinykit installation. Use its existing
libraries; arbitrary npm dependencies require separate installation support.

## Collections and records

Define the collections in schema.json before referring to them in the app:

```json
{
  "contacts": [
    { "name": "name", "type": "text" },
    { "name": "company_id", "type": "text" },
    { "name": "active", "type": "boolean" }
  ],
  "companies": [{ "name": "name", "type": "text" }]
}
```

Use stable record IDs to link rows; an optional text field such as company_id
can reference a company. `id` is generated on creation unless supplied. Validate
required inputs, types, dates and linked IDs in the app, and handle rejected
requests without losing drafts. The current data API warns about unknown fields;
it is not a replacement for app validation.

```svelte
<script>
  import { onDestroy } from 'svelte'
  import data from '$data'

  let contacts = $state([])
  let error = $state('')
  const stop = data.contacts.subscribe(
    records => { contacts = records },
    { all: true },
    () => { error = 'Could not load contacts.' }
  )
  onDestroy(stop)

  async function addContact(name) {
    try {
      await data.contacts.create({ name: name.trim(), company_id: '', active: true })
    } catch {
      error = 'Could not save the contact. Please retry.'
    }
  }
</script>
```

`data.contacts.list({ all: true })` returns an array. `create(fields)`,
`update(id, changedFields)`, and `delete(id)` are async. Subscribe returns a
cleanup function and receives the current list plus realtime updates. Local
and hosted records use the same API but separate databases. Never replace rows
with sample data during source updates or republishing.

## Content, design and files

```json
[{ "id": "title", "name": "Title", "type": "text", "value": "My app", "description": "App title" }]
```

Import `content` from `$content`. Keys come from normalized **field names**:
"Title" becomes `content.title`, and "Add button" becomes `content.add_button`.
Do not assume an arbitrary field ID determines the key. Import `$design` when
needed; design definitions with `css_var` also become CSS custom properties.
Use `asset` from `$tinykit` for authored file URLs, for example
`import { asset } from '$tinykit'` and `<img src={asset('logo.svg')} alt="Logo" />`.
Keep authored assets under the flat assets/ folder; use letters, numbers, dots, underscores, and hyphens in filenames. Runtime-uploaded files stay
in their database/storage and are distinct from authored assets.

## Checking and publication

`tinykit check --json` compiles with Tinykit's installed Svelte/Vite runtime. It
does not execute the app or backend code on the host, start a listener, contact
a hosted server, or require the browser preview. It returns the source revision,
build result and diagnostics. Inspect browser behavior separately.

`tinykit status --json` reports whether dev is running, its URLs, browser compile
status, and any matching headless-check result. A stale check or a browser-pending
state does not validate a newer source revision.

App source/content/design/schema are source-owned. Publish supports adding
collections and fields without replacing live rows. Removing fields/collections
or changing their definitions requires an explicit migration. A schema edit in
the local preview does not authorize a destructive hosted migration.

New local apps are private by default. Their first explicit publication creates
an owner-bound hosted target and starts with empty hosted records. Local examples
and records never travel with source publication. Later updates preserve hosted
records, uploads, access settings and service configuration. Read conflicts and
unknown-outcome errors rather than retrying with another project ID.
