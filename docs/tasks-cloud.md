# Private task authority and final MCP connection

The private read/write Worker is deployed on the existing Free account. The
owner completed secure secret entry and connected the private LifeOS Tasks
plugin through GitHub public identity and OAuth. ChatGPT discovered all eight
tools. Guarded activation imported 37 existing tasks into D1 and verified every
task field against a fresh full backup. Desktop, CLI and the installed capture
helper now read this shared task authority. Other records remain local.
Backup paths, hashes and resource identifiers are private operational state
outside Git. Mercury's first direct call reached the authenticated service
before activation and returned an uninitialized-store error. After activation,
Mercury successfully called `list_tasks` in the main conversation and read the
37 real tasks at revision 2, establishing direct authenticated access.

## Small persistence boundary

`workers/tasks/worker.mjs` uses the shared OAuth boundary in
`src/tasks-worker.mjs` and a D1 binding named `TASKS_DB`. The database contains
one `lifeos_tasks` row: an integer revision and a JSON task document. This is
deliberate for a small personal app undergoing frequent schema changes. It
preserves task IDs, unknown task fields, hierarchy, timestamps, sort order,
notes, priorities, tags and schedules without migrating the whole application.
Only stable project IDs are retained to validate task relationships;
project names/content, Reading, logs, timers, Codex history and settings stay
local. Timezone is retained for task dates.

Each operation reads from D1's primary and conditionally updates the row using
`WHERE revision = ?`. Conflicting operations re-read and retry up to six times;
they do not replace a newer snapshot with an older one. Multi-field edits are
atomic. `ifUpdatedAt` rejects stale user edits. Fixture tests compare all five
task mutations with the local domain and exercise simultaneous edits.

Reads never initialize or purge. Trash moves the whole subtree and restoration
preserves identity/content and required ancestors. Expired Trash is hidden after
30 days, but this server never permanently prunes it. Create still has no client
operation-ID deduplication: search before retrying an uncertain create response.
The initial personal document limit is 1.5 MB/10,000 tasks; the admin CLI's inline
SQL limit is smaller (99 KB per query). Exceeding a limit fails without a write.
This is a personal store, not a general database design for a large workload.

## Shared desktop task adapter

The proposed archive-only cutover was rejected: it would stop existing desktop
editing and browser capture. That cutover is not active. The replacement is an
opt-in adapter in `src/task-online.mjs` at the existing `readStore`/`mutateStore`
boundary. The active desktop, CLI, capture and Mercury use the same D1 task
row. Existing desktop task actions keep their domain semantics; no project
content, Reading or time-entry storage moves to Cloudflare.

- Reads refresh the local task projection under the existing store lock, with
  atomic writes and the existing `.bak`. When D1 is unreachable they return
  the last local projection, visibly labelled as cached.
- Task edits and captures require connectivity. There is no offline task queue.
  Unrelated local edits still work offline unless an interrupted cloud save
  first needs recovery. Project deletion that moves tasks also needs internet.
- Each desktop task save checks the cloud revision. A racing or stale edit is
  refused with a refresh/retry message. Task detail drafts retain their original
  `ifUpdatedAt`, even when the cache later refreshes. Whole-file replacement of
  an independently writable replica is never allowed.
- Before a cloud write, a mode-0600 local journal records the intended local
  transaction and a commit ID. Cloud writes preserve that ID across Mercury
  edits. Recovery commits local records exactly once after a lost response or
  disk failure, preserving later Mercury changes. This also protects capture's
  combined local-project/task creation. Out-of-band local edits fail closed
  for reviewed recovery rather than silently overwriting unrelated records.
- Cloud task paths retain Trash records, hide expired Trash after 30 days, and
  block permanent removal. Desktop cloud-mode menus omit permanent deletion.

The first adapter reuses Wrangler's existing encrypted, Keychain-backed local
administration credentials through `src/cloud-task-repository.mjs`. It selects
only the approved account/database/configuration; it never extracts tokens.
This keeps the proof small and avoids another desktop credential or HTTP
administration endpoint. It requires this checkout, Node and installed Wrangler,
including from the copied capture helper. This is a deliberate development-app
limit: every task read starts a CLI command. Live fictional acceptance through
the actual encrypted Wrangler grant verified reads in 0.9–1.2 seconds and
desktop edit/capture domain saves in about 2 seconds. The isolated
`lifeos_adapter_fixture` table is unavailable through the Worker. The refreshed
installed native helper's read-only ping verified access to all 37 real tasks;
the Tasks screen was checked after the installed app's refresh. Queries have a
7-second deadline and a 99 KB SQL limit. A narrower desktop OAuth transport can
replace this repository contract later without changing domain actions.

Wrangler's remote `--file` path is bulk import and returns counts, not query
rows. The transport invokes the pinned CLI's ordinary `--command` query path.
A Node preloader reads SQL from a mode-0600 temporary file into JavaScript argv
after process launch, keeping task contents out of the OS command line. This
also avoids bulk import's temporary database unavailability. Wrangler retains
ownership of the encrypted credentials; the adapter never extracts them.
The active private configuration is kept in the durable macOS Application
Support `LifeOS/cloud-tasks/` directory with mode 0600, rather than the temporary
deployment directory. The adjacent authority marker selects this same approved
account/database; resource IDs and configuration contents remain outside Git.

## Explicit activation

The owner directly approved the exact final setup and online task edits/cached
reads. The following cutover completed after plugin connection: a fresh full
backup, staged import/readback, conditional cloud activation and the local
online authority marker. Task identity/content and all unrelated local records
were verified unchanged. These steps describe the guarded process for future
maintenance; do not repeat the migration against an active store.

1. Refresh the installed capture helper with `npm run capture:install` and stop
   the workspace server briefly. Its copied runtime must include the adapter;
   the CLI checks hashes and refuses running old task writers. Restart after
   activation. Extension access permissions remain unchanged.
2. Prepare a fresh full private backup under the store lock. Verify byte hashes
   and task-only import/digest. Preparation does not freeze tasks; later edits
   require a fresh backup rather than overwriting those changes.
3. Recheck the task digest under the lock and create the adjacent authority
   marker with phase `pending`, mode `online` and the exact private connection.
   Supported task writes pause only during this migration. Other local records
   remain writable.
4. Import into an empty D1 row with phase `staged`; never overwrite an existing
   different row. Read back and verify the document. Staged data is inaccessible
   through MCP.
5. Recheck the local digest/fence, conditionally activate the verified cloud row,
   then atomically mark the local adapter `active`. Desktop, capture and local
   CLI resume through the online adapter. A failed/uncertain migration leaves
   the temporary fence for inspection; do not silently fork task authority.

To revert, stop cloud writes, export/verify the latest cloud tasks and reconcile
under the local lock. Never remove the marker or restore an old whole-file
backup over later Mercury edits. No automatic rollback command is provided.

## Private administrator CLI

`npm run tasks:cloud -- help` describes backup/fence/import/activation and the
seven cloud task operations. It uses Wrangler's encrypted credentials; no
second task token or separate CLI OAuth grant is created. The CLI captures D1
responses privately, disables Wrangler disk logs/telemetry, sends SQL through
mode-0600 temporary files outside Git, and prints only counts for migration
operations. Explicit task reads/mutations return their content to the local
authorized caller. Unknown/private diagnostic contents are not printed.

```bash
npm run tasks:cloud -- backup --artifacts /private/new-backup --origin https://approved-task-host
npm run tasks:cloud -- fence --config /private/wrangler.jsonc --manifest /private/new-backup/cutover.json
npm run tasks:cloud -- import --config /private/wrangler.jsonc --manifest /private/new-backup/cutover.json
npm run tasks:cloud -- activate --config /private/wrangler.jsonc --manifest /private/new-backup/cutover.json
npm run tasks:cloud -- status --config /private/wrangler.jsonc
npm run tasks:cloud -- list --config /private/wrangler.jsonc
npm run tasks:cloud -- edit --config /private/wrangler.jsonc --input /private/task-edit.json
```

Configuration and input files must be mode 0600 outside the repository.
`LIFEOS_CLOUD_CONFIG` can select the private Wrangler configuration. Input uses
the same fields as MCP. No permanent-delete action is accepted.

## One final access grant

Skip installing the read-only demo plugin. The final private Worker advertises
`tasks:read` and `tasks:write` together. It validates opaque OAuth tokens,
canonical audience, exact numeric GitHub owner and scopes before constructing
the task service. Read-only tokens cannot invoke writes. Public health has no
task count/content, and neither data imports nor D1 queries have HTTP routes.
The task database is private and accessible through its binding and authorized
Cloudflare administration only. Private task data is never part of the bundle.

The shared consent flow retains CIMD, S256 PKCE, browser-bound single-use state,
Origin checks, escaping and frame protections. GitHub requests an explicitly
empty scope (public identity only); broader upstream grants/other owners are
rejected. Upstream tokens are discarded. The final MCP access token expires
after an hour; refresh tokens are valid for 30 days. GitHub's app grant persists
until revoked, separately from MCP tokens. The user generated and submitted
the client secret directly into the encrypted Worker secret; the agent did not
read or copy it. Live owner sign-in and authenticated tool discovery succeeded.

The owner's direct typed approval covers this exact setup:

- Extend the approved Wrangler grant by `d1:write`; keep its existing four
  account/user/Workers/KV permissions and offline Keychain-backed storage.
- Create the dedicated GitHub OAuth app with the final approved HTTPS homepage
  and `/callback`, public identity only, exact owner, and securely handled
  `GITHUB_CLIENT_SECRET` stored only as a Worker secret. Credential creation or
  transmission must use supported secure handling or a user handoff. The user
  should generate/reveal the GitHub client secret themselves, paste it into the
  prepared Cloudflare Production secret value field, and submit the deployment.
  Alternatively use Wrangler's interactive `secret put GITHUB_CLIENT_SECRET
  --config <private config>` prompt in their terminal. Do not paste it into chat, inspect the
  clipboard, put it in command arguments or save it in repository/config files.
  The public client ID can be supplied separately.
- Install the private ChatGPT OAuth/CIMD MCP plugin with both task scopes and
  30-day renewable refresh-token access; review its actual client/redirect and
  displayed risk confirmation. Never guess the plugin's callback identifiers.

The D1 extension, private database, GitHub app, Worker secret, private deployment,
owner grant, plugin connection and guarded activation are complete. No further
approval or secret handoff is pending for the agreed setup. All resources
must stay on Free; paid requirements need approval. No billing upgrade, public
task publication, permanent deletion or Projects/Reading transfer is included.

## Verification and outstanding acceptance

Model/cutover/adapter tests use temporary stores. Adapter fixtures verify
existing desktop/capture actions, offline cache and unrelated writes, stale/CAS
conflicts, uncertain success and failure, local disk failure, out-of-band edit
refusal, exact-once capture recovery and retained Trash. Workerd tests use disposable D1/KV,
fictional clients/owners and mocked GitHub; they verify private CRUD, retained
Trash/restore, scope rejection, no unauthenticated data and no public task
counts. Syntax, full Node tests and Tauri compile check are run by `npm run check`.
`npm run mcp:private:check` builds only code and placeholder bindings.

The deployed private endpoint passed 13 HTTPS boundary checks, including both
task scopes in metadata, no public task counts, missing/invalid-token rejection,
Origin/method/query/body restrictions and absent permanent-delete routes.
The active production row contains the 37 verified tasks. No personal task was
edited merely to test: live mutation tests used the separate fictional table.
Desktop and installed native-helper reads verified the online authority and
preserved task content plus unrelated local records. The complete check passes
133 Node tests and the Tauri compile check, including the pinned Wrangler query
transport and its private SQL preloader.

Mercury's direct `list_tasks` call succeeded in the main conversation after
activation: 37 real tasks at revision 2. A separate installed-plugin read also
succeeded. The live plugin's read/write discovery and owner connection are
verified. Mercury created one clearly labeled temporary task, read it, edited
it with `ifUpdatedAt`, verified the persisted fields and moved only that task
to recoverable Trash, reaching revision 5. The 37 original tasks were not edited.
Do not duplicate that write smoke test or permanently purge its task.
Read-only follow-up confirmed the installed native helper and desktop
projection matched revision 5, including the one recoverable test task. After
Refresh LifeOS, the Tasks screen showed one Trash item and shared cloud storage.
All original task fields and unrelated local records matched the pre-cutover
backup; no recovery journal remained pending.
Refresh-token rotation remains unverified live. Existing personal task records
are never edited just to test. Measure actual authenticated request CPU against Workers Free limits
before promising ongoing zero cost.

Sources: [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/),
[D1 primary reads](https://developers.cloudflare.com/d1/best-practices/read-replication/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and the
[MCP/OAuth runbook](tasks-mcp.md).
