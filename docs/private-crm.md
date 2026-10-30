# Private CRM

The CRM is a single-user app with contacts, companies, deals, linked notes, and
dated follow-ups. The Overview shows due follow-ups, recent notes, and open
deals. Companies and contacts are separate records; deals can reference both.
CSV imports are reviewed before saving. Existing IDs update existing records,
and linked IDs must already exist. Import companies before contacts and deals.

## Preview and daily use

`tinykit dev` runs the local editor at `/companion`. **Open app
preview** opens `/companion?view=app` without the agent and publishing controls.
Both views use the same isolated local records. The preview is available only
while the local development process is running.

The published CRM is the daily-use app. Its address is
`https://your-instance/tinykit/preview/<app-id>` or its assigned domain. It
requires the owner's Tinykit account and keeps its records on the server.
Publishing updates source, content, and design while preserving hosted records,
uploads, ownership, and visibility. Preview sample records are never uploaded.

## Create the private CRM

1. Upgrade the Tinykit server with this checkout, including the private-app
   migration `1793300000_add_private_apps.js` and the complete `pb_hooks/`
   directory. Restart PocketBase. Keep PocketBase's listener private; expose the
   Tinykit Node application through HTTPS.
2. Run `tinykit start`, sign in to the upgraded instance, and choose **Private
   CRM**. Name the app and create it. Or choose **My CRM** in Studio's app picker.
3. Customize using the local workspace. **Review & publish** identifies the app
   as private. Open the published address and sign in to use the real app.
4. Configure backups before adding real customer records.

The starter refuses to continue if the host did not save private visibility and
an owner. New apps record the creating builder as owner. Existing public apps
keep their visibility; the migration preserves existing collection restrictions.
An existing ownerless public app must be assigned an owner by the administrator
before it can become private. Do not use publication as a way to change access.

The server checks app pages, data reads and mutations, realtime, display config,
uploads, source assets, exports, and publishing. PocketBase's collection rules
also restrict direct access to private projects and their files. Browser sessions
use a host-only, HttpOnly, SameSite cookie; HTTPS makes it Secure. Private
responses disable caching. An expired login requires signing in again.

Uploaded files and build artifacts are now protected in PocketBase. Public apps
continue serving these through Tinykit's existing asset and app routes. Previously
copied direct PocketBase file URLs require an authenticated file token.

## Database and uploaded-file backups

Run these commands **on the Tinykit server**, from its checkout, using its
existing setup file or the `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, and
`POCKETBASE_ADMIN_PASSWORD` environment. No administrator credential is added to
an exported app or passed to a coding agent.

```sh
node scripts/instance-backup.mjs schedule
node scripts/instance-backup.mjs create /private-backups/tinykit
```

The schedule uses PocketBase's built-in snapshot service: daily at 08:00 in the
server's timezone, retaining fourteen automatic snapshots. It preserves any
existing backup S3 configuration. The create command downloads a complete
database/storage snapshot with owner-only file permissions and a SHA-256
checksum. It reports success only after the archive is fully downloaded.
Automatic snapshots normally remain in PocketBase's backup storage; copy them
to another device/storage provider to survive loss of the server volume. The
schedule must be configured on the real deployment; opening a local preview
does not configure the hosted instance.

Treat snapshots as private: they contain user accounts, app records, uploads,
and server setup credentials. Keep them outside every public web directory.

For a recovery drill, verify the checksum, extract the snapshot into a **new**
data directory, and start the matching PocketBase binary with that directory and
the same migrations/hooks. Sign in and verify records, ownership, and uploaded
files before directing the Tinykit server to the recovered database. Do not
extract an archive over a running or occupied database. Source-code backups are
separate from database/storage snapshots.

## Verification

```sh
node --test tests/personal-crm.test.mjs
TINYKIT_TEST_PRIVATE=1 node --test tests/private-apps-runtime.test.mjs
```

The isolated integration test uses two accounts. It checks private delivery and
direct database/file permissions, browser sign-in and sign-out, same-origin
writes, encoded project IDs, and public-app compatibility. It publishes and
republishes the actual CRM while comparing stored records and uploads, then
creates a snapshot, restores it to another directory, starts a second database,
and verifies records, source, account access, and attachment bytes.

## Prospect Desk

The standalone Primo Prospect Desk is an outbound prospecting and call-logging
workflow, with researched leads, source links, conversation prompts, call
outcomes, notes, and follow-up dates. Calling delegates to the operating system's
`tel:` handler. Its progress lives in browser localStorage and is portable via a
JSON progress backup; the HTML file itself does not contain newly logged calls.

It would fit as a Prospecting view in this CRM: contacts/companies hold identity
and research, a linked calls collection stores each call's outcome and notes,
follow-ups use the existing task list, and qualified opportunities become deals.
Import the prospect list and an explicitly exported progress backup separately
when integrating it. That integration and built-in telephony are not part of
this first CRM version.
