# LifeOS Tasks MCP proof

This is a task-only, authenticated MCP resource server. It shares the local
LifeOS store and its lock/atomic-write path. A separate synthetic-only Cloudflare
Worker is deployed for the approved synthetic remote demo. The approved
Wrangler grant is active, with encrypted credentials protected by macOS
Keychain. The final private Worker and D1 database are deployed. The user
completed secure secret entry and owner OAuth, then connected the private
LifeOS Tasks plugin. ChatGPT discovered all eight tools. Guarded activation
imported and verified all 37 existing tasks against a fresh full backup.

The server is implemented and tested locally and the private plugin is
installed and connected. Mercury's first direct call reached the authenticated
service before activation and returned an uninitialized-store error. A
successful retry after activation returned the 37 real tasks at revision 2 in
the main conversation. Mercury then created, read, edited, verified and trashed
one clearly labeled temporary task, reaching revision 5 without editing the
original records. Direct authenticated read/write access is verified.

The owner has now approved private task storage and full task editing. The
[final private read/write implementation](tasks-cloud.md) uses a D1 task-only
document with conditional revision writes and an explicit guarded cutover.
The shared desktop/capture adapter is active, with verified real-data reads and
unchanged task content. Cached reads work offline; task edits need internet.
Keep the existing read/write plugin; skip linking the synthetic demo.

## Tools and data boundary

| Tool | Behavior |
| --- | --- |
| `list_tasks` | Open tasks by default; `all`, `completed`, and `trash` scopes; exact project ID/Inbox, tag, due-date filters, pagination |
| `search_tasks` | Title, notes, tags, and ID substring search; open/completed by default |
| `get_task` | Exact ID, full notes, schedule, descendant count |
| `create_task` | Inbox or an existing project; optional parent inherits its project |
| `edit_task` | Atomic title/notes/priority/tags/schedule patch; optional `ifUpdatedAt` rejects stale edits |
| `complete_task` | Complete the non-trashed subtree, or reopen the selected task |
| `trash_task` | Recoverable subtree Trash, with existing 30-day retention |
| `restore_task` | Restore subtree/required ancestors, preserving identity/content |

Read tools omit notes in lists; `get_task` returns them deliberately. Project
IDs already attached to tasks are preserved, but no project or reading tools
exist. The general `/api/state`, desktop assets, Codex rail, browser capture,
permanent deletion, Trash cleanup, hierarchy edits, and calendar/mobile sync
are absent. Expired Trash is hidden from read results; this server never prunes
it. Normal LifeOS app cleanup still has its existing behavior.

Writes are disabled by default. Enabling them registers the five write tools;
OAuth still requires `tasks:write` for each invocation. Task edits use one store
transaction, preserve concurrent unrelated fields, and validate the full
result before saving. Completion, Trash, and restore reuse the existing domain
operations. Create is not idempotent: after an uncertain response, search/get
before retrying. There is no client operation-ID deduplication yet.

## Start locally

The official SDK v2 serves stateless Streamable HTTP at `/mcp`, with its legacy
2025 protocol compatibility enabled. The checkout requires Node 22+ for the
Worker development tools and full checks. The listener binds
only to `127.0.0.1`; it is separate from `npm run dev` and does not start the
Codex bridge. It requires an existing store and never initializes it on a read.

Authentication configuration must be an absolute path outside the workspace,
in a private mode-0600 file. Keep it, all credentials, and recovery files out of
Git. This example contains placeholders, not working credentials:

```json
{
  "mode": "oauth",
  "resource": "https://tasks.example.com/mcp",
  "issuer": "https://chosen-authorization-server.example.com/",
  "jwksUrl": "https://chosen-authorization-server.example.com/.well-known/jwks.json",
  "ownerSubject": "verified-subject-of-the-one-authorized-owner"
}
```

```bash
LIFEOS_MCP_AUTH_FILE="/absolute/private/mcp-auth.json" npm run mcp:tasks
```

`LIFEOS_MCP_PORT` defaults to 3010 (0 requests a random loopback port).
`LIFEOS_DATA_DIR` selects the existing store as in the stable CLI. For a
disposable fixture only, add `LIFEOS_MCP_ENABLE_WRITES=true`. Enable personal
write access only after the user approves that persistent access policy.

OAuth mode verifies asymmetric JWT signatures against the fixed JWKS URL,
issuer, canonical `/mcp` resource audience, expiration/not-before, owner subject,
and scopes. Missing/invalid tokens fail closed. `tasks:read` is required at the
endpoint; write tools also require `tasks:write`. The issuer must actually mint
access tokens for that resource and support the OpenAI client authorization
flow. Do not substitute Firebase ID tokens or tokens for another audience.
Issuer discovery, PKCE, consent, client registration, refresh/revocation, and
upstream sign-in remain the selected authorization server's responsibility.
Short-lived JWTs remain valid until expiry; this server has no immediate
revocation/introspection path.

Public protected-resource metadata is served at
`/.well-known/oauth-protected-resource` and
`/.well-known/oauth-protected-resource/mcp`. Authentication failures advertise
the canonical HTTPS metadata URL. Per-tool OAuth metadata is in
`_meta.securitySchemes`, the shape preserved by the installed official SDK.
Insufficient tool scope also returns `_meta["mcp/www_authenticate"]`. Confirm
actual OAuth linking/tool discovery in ChatGPT before treating these local
tests as account compatibility.

The alternative `local-token` mode accepts a mode-0600 configuration containing
`{"mode":"local-token","token":"a-private-token-at-least-32-characters"}`.
It is for local clients/tests only. It is not the ChatGPT authentication route:
ChatGPT custom MCP plugins cannot present arbitrary customer API keys. Do not
publish or tunnel a local-token server. No token-generation or configuration
command is provided, and no personal MCP access credential has been created.

## Cloudflare synthetic-only demo

The deployed demo is `workers/tasks-demo/worker.mjs`, a single
Worker with three explicitly synthetic records compiled from `demo-tasks.mjs`.
Only list/search/get are exposed. It cannot read the Mac, environment-selected
task files, the full LifeOS JSON, or app assets. The demo has no D1 binding or
task write tools. After direct owner approval, one isolated
OAuth KV namespace and this Worker were created on the existing account's
verified Workers Free plan ($0, Current plan). The actual destination and
deployment configuration are recorded outside Git. `wrangler whoami` confirmed
`account:read`, `user:read`, `workers_scripts:write`, `workers_kv:write`, the
subsequently directly approved `d1:write`, and
`offline_access`; credentials are stored in an encrypted file outside Git with
its key in macOS Keychain. Generic warnings about absent unrelated scopes do
not authorize expanding this grant.

Live HTTPS checks verified synthetic health, protected-resource metadata at
`/.well-known/oauth-protected-resource/mcp`, authorization metadata, CIMD/S256
advertising, missing/invalid-token rejection (401), hostile Origin rejection
(403), query/method/body-size restrictions, and absence of app-state and anonymous
registration routes. Owner sign-in remains unconfigured (503), so no valid live
MCP token or authenticated remote task read has been demonstrated. The provider
serves metadata at the resource-specific path advertised by its 401 challenge;
the root protected-resource metadata path returns 404.

Authentication uses Workers OAuth Provider 1.2.3 on the same Worker, with an
OAuth KV namespace. A split authorization/resource deployment would add
infrastructure without helping this three-record proof. The provider validates
opaque access tokens and their canonical resource audience. The protected
handler independently requires the exact owner and `tasks:read`; it never
accepts forwarded identities, arbitrary API keys, or the GitHub upstream token
as an MCP token.

The owner signs in using a dedicated GitHub OAuth app with an explicitly empty
scope list (public identity only). The callback fetches `/user`, compares the
stable numeric ID to `OWNER_GITHUB_ID`, then discards the upstream token.
Previously granted broader GitHub scopes are rejected. No repository, email,
or private profile permissions are requested. The GitHub app authorization
persists at GitHub until revoked; discarding the token is not grant revocation.

CIMD public clients use S256 PKCE; anonymous DCR is disabled. Consent shows the
client domain and redirect hostname, escapes client content, refuses framing,
and uses the provider's browser-bound single-use consent/upstream helpers.
Tokens grant synthetic `tasks:read` for one hour, with no refresh token or
remembered consent. This intentionally requires reauthorization after expiry.
Public OAuth endpoints can still consume Free KV quotas; this is a limited
proof, not a hardened multi-user authorization service. Measure Worker CPU and
KV usage after deployment before promising ongoing zero cost.

The checked-in `wrangler.jsonc` is a nonfunctional template, with an invalid
placeholder origin/owner/namespace. No assets, D1, paid services, preview URLs,
or request logging are configured. Secrets belong in Worker secrets; account
IDs, destination URLs and real configuration belong outside Git. Do not put a
GitHub client secret in `vars`, `.dev.vars` committed content, or shell arguments.
Wrangler and Miniflare require Node 22+, so the checkout's declared minimum
and documentation now reflect that development requirement.

Safe local checks:

```bash
npm run mcp:demo:test
WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false npm run mcp:demo:check
```

The dry-run compiles only Worker imports. It does not create an account,
credentials, namespace, deployment, or grant. The full OAuth flow is tested
in local workerd with fictional clients, owner IDs and mocked GitHub responses;
the official MCP client successfully lists/searches/gets synthetic tasks.

### Final access setup

Wrangler access and synthetic Free deployment have been directly approved and
completed. Exact private setup was subsequently directly approved; the D1
scope, private database, GitHub identity app, Worker secret, private deployment,
owner OAuth, plugin connection and guarded online activation are complete. No
billing upgrade or unrelated scopes were enabled. The owner completed these
credential and connection steps directly:

1. The dedicated GitHub OAuth app and exact `${MCP_ORIGIN}/callback` were
   registered, with wildcard/device flows disabled. The user generated the
   client secret and entered/submitted it in the Cloudflare Production
   secret form (`GITHUB_CLIENT_SECRET`, Secret checked). Keep all secret values
   out of chat, clipboard inspection, configuration files and command arguments.
2. The private ChatGPT custom MCP plugin was installed with OAuth and CIMD, and
   GitHub owner sign-in completed with the approved `tasks:read tasks:write`
   scopes. Its management page verified the connected owner and OAuth account.
   The actual client metadata/redirect URI came from the plugin form; do
   not guess callback-specific IDs or switch to unauthenticated mode.

Keep the private configuration outside Git with the selected account, actual
namespace ID, canonical Workers HTTPS origin and owner ID. Set the dedicated
GitHub secret through the authorized secure user handoff, keeping its public
client ID separate. Use approved secret
handling. Use the absolute Worker entry path in that private configuration.
For a code update, re-run a dry-run and inspect the bundle before
`wrangler deploy --config /absolute/private/wrangler.jsonc`.
If an account/subdomain selection or terms screen needs human action, report
the exact choice and pause that step. Deployment without owner sign-in secrets
fails closed and cannot complete the authenticated proof.

Then verify public metadata, unauthenticated/invalid-token rejection and real
owner-authorized MCP reads over the actual HTTPS endpoint. Before personal
activation, use isolated fictional storage for write acceptance. Complete the
verified backup/cutover in the private runbook and have Mercury call `list_tasks`
directly in its main conversation. Only that real-task read completes the goal.
Mobile sync remains deferred.

## Remote proof before migration

OpenAI documents a personal custom MCP plugin supporting reads/writes and
OAuth. A dot can use installed/enabled plugins directly. The account's native
Plugins → Add → Add custom MCP server form was verified and filled with the
private URL and OAuth. Installation, owner sign-in and authenticated discovery
of all eight tools are complete.

The selected implementation is the private Worker and guarded shared task
authority in [the private runbook](tasks-cloud.md). An alternative for
real local reads uses an approved HTTPS forwarding endpoint to the local
task server and a compatible JWT OAuth issuer. Route only `/mcp`
and the two protected-resource metadata paths. Preserve `Authorization` and
the exact configured canonical Host. Reject other paths; never forward the
existing LifeOS app port. Unauthenticated local callers and hostile Host/Origin
headers are rejected. No CORS access is enabled.

For that alternative, obtain any approvals not already granted for:

1. The exact hosting/tunnel account and endpoint, free-plan scope, and required
   terms. No billing activation is included.
2. The authorization provider/account, verified owner subject, OAuth client
   configuration and grants. Initially grant read access to demo tasks only.
3. Creating/installing the private LifeOS Tasks plugin and accepting its risk
   confirmation in ChatGPT.
4. Separately, exposing the real local task store through that approved path,
   initially read-only. Back up and verify the store before any migration or
   enabling remote writes. Never mutate real tasks just to test.

With approval, configure the HTTPS route and issuer, run the server with an
isolated `LIFEOS_DATA_DIR`, and verify metadata, initialization, `tools/list`,
authenticated reads, unauthorized-owner rejection, and scope rejection from
outside the Mac. In ChatGPT Plugins choose **Add custom MCP server**, enter the
approved `https://…/mcp` URL, select OAuth, create/install the private plugin,
and have Mercury call `list_tasks` directly in the main conversation. A local
read, another Codex thread's output, or an Inspector call is not this test.
Refresh the plugin after changing tool metadata.

The owner approved the real-data D1 path and task write access. The Worker
cannot simply be pointed at the Mac's store: use the verified backup and guarded
shared-authority transition before uploading tasks. Require a direct Mercury
real-task read and verify source bytes as appropriate. Record only
counts/verification evidence in public development notes. Existing personal
tasks must never be mutated merely to test.

An OpenAI Secure MCP Tunnel could avoid public ingress and data migration, but
the current guide requires a Platform runtime API key and separate tunnel
permissions/workspace associations. That key authenticates tunnel control-plane
traffic, not model inference. It still requires explicit approval to create/use
credentials and a review against the project's API-key boundary. It is not
enabled here. For a personal account, use its personal Platform organization
and associate the target ChatGPT workspace. Creating/editing a tunnel needs
Tunnels Read + Manage; running/selecting one needs Read + Use. Custom MCP
permission is separate. Both the local server and `tunnel-client` must remain
running on an online Mac; this is direct tool access without routine Codex
threads, but is not hosted always-on persistence or iPhone sync. A connected
computer alone does not establish a direct installed MCP plugin path.

## Backend opinion

| Option | Personal-use fit | Main constraint |
| --- | --- | --- |
| Existing local JSON + authenticated HTTPS forwarding | Smallest initial proof; one source of truth, no migration | Mac and forwarding process must stay online; not iPhone sync |
| Cloudflare Workers + D1 Free | Selected task backend; small SQL store and stateless MCP | Guarded source-of-truth transition and desktop adapter implemented; CPU/KV quotas must be measured |
| Firebase Firestore + Functions | Strong mobile SDK/offline ecosystem; familiar existing account | Functions deployment requires Blaze billing even when usage may fit no-cost quotas |
| Supabase Free | Postgres/auth/SQL tooling; easy relational model | Free projects pause after a week of inactivity; another provider/account |

The verified Cloudflare Free limits are 100,000 Worker requests/day with
10 ms CPU/request, D1 5 million rows read/day and 100,000 rows written/day,
5 GB total storage with a 500 MB per-database cap. OAuth may also need KV:
its free allowance is 100,000 reads/day but only 1,000 writes/deletes/day.
These quotas suggest personal-task traffic is plausible, not a measured
zero-cost guarantee. Node test latency is not Worker CPU profiling.

The Cloudflare implementation uses the current stateless
`createMcpHandler`, not deprecated `McpAgent` templates. Workers OAuth Provider
v1 validates resource audiences and supports a split authorization/resource
server: use owner allowlisting, PKCE, per-tool scopes, consent protections, and
rate limits. Its authorization server needs KV; a separate resource server can
validate through a Service Binding without its own KV namespace. That provider
can issue opaque tokens: they cannot be passed directly to this JWT verifier.
Use its `OAuthResourceServer` adapter at that boundary instead of weakening
the local audience/signature checks.

Do not upload the whole LifeOS JSON or make D1 an independently writable copy.
After the direct plugin proof, choose one authority for tasks. My preference
for eventual always-on/iPhone use is D1 as the task authority, with the desktop
using the same task API and an explicit offline outbox/conflict protocol.
Keep the other domains local. Retain task IDs, parent IDs, project-reference
IDs, timestamps, notes, priority/tags, schedule and manual order. A minimal
project-reference registry may be needed to validate IDs; it is not a Projects
migration. Use transactional subtree operations, revisions/compare-and-swap,
and idempotency keys before accepting multi-device writes. Back up the full
local store outside Git, hash/validate it, dry-run an inventory/map, and require
approval before uploading even task-only data. This phase is deliberately
unimplemented until authenticated plugin access is proven.

## Verification

```bash
node --test tests/tasks-mcp.test.mjs
npm run mcp:demo:test
npm run mcp:demo:check
npm run check
```

Focused tests use disposable stores and ephemeral test authentication only.
They cover real HTTP/client discovery, authentication, Host/Origin rejection,
request bounds, schema errors, task-tree lifecycle, identity/content retention,
atomic/stale edits, concurrent mutations, no read writes/seeding/purging,
OAuth signature/issuer/audience/owner/expiry checks, and write-scope denial.
Worker tests also cover owner OAuth/CIMD/PKCE and synthetic MCP reads, another
owner, broader upstream grants, consent escaping/CSRF/single-use handles,
audience/write-scope rejection and fail-closed endpoint/configuration bounds.
The live approved setup additionally verified Wrangler's control-plane grant,
private D1 activation, GitHub owner OAuth and authenticated ChatGPT tool
discovery. All 13 live HTTPS boundary checks passed. The final deployment bundle
contained no private task ID/title/notes markers or filesystem imports. A fresh
full backup and post-activation reads verified all task fields and unrelated
local records unchanged. Mercury's real-task read subsequently succeeded
directly in the main conversation. An iPhone client and live refresh-token
rotation remain deferred/unverified. Startup time reported by deployment is not per-request CPU
profiling; actual Free-tier OAuth/MCP CPU suitability remains to be measured.

Sources checked for this implementation:

- [Custom MCP plugin route](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Dot plugin access](https://learn.chatgpt.com/docs/dots/computers-and-apps#connect-apps)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel requirements](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Current stateless Worker MCP path](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Workers OAuth Provider v1](https://developers.cloudflare.com/changelog/post/2026-10-01-workers-oauth-provider-1x/)
- [Current consent and upstream sign-in helpers](https://github.com/cloudflare/workers-oauth-provider)
- [GitHub OAuth code flow and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub scope boundaries](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [Firebase Functions billing requirement](https://firebase.google.com/docs/functions/quotas)
- [Supabase free project limits](https://supabase.com/pricing)
