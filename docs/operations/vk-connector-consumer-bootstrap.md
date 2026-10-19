# Registered VK consumer and shared readiness checks

The governed route remains Planner command → existing registered independent consumer → adapter-owned session. Read `vk-owned-publication-route.md` first. No Codex browser, personal tab, CDP, API, alternate worker or other-chat fallback is allowed for a denied outcome. A Planner application challenge does not clear an external tool restriction.

## Identity and data boundary

A publication is an authenticated tenant-owned task, accepted revision, channel/community, approved asset, release, immutable package and existing work item. These values are resolved and cross-checked as data. They are not a task/account allowlist in production code. Existing package hash ordering remains compatible; old job, attempt, lease, fact and audit history must not be rewritten during upgrade.

MCP normalizes actor/project to the authenticated Publisher principal. The optional private configuration `actorId` is not authority; the client transport sentinel `authenticated` asks the remote boundary to use its authenticated actor. It is never an authenticated identity by itself. The consumer reuses the existing scoped Publisher credential and logical host/instance fencing. These are not independent hardware/process attestation.

Private configuration retains its existing schema: positive project ID, registered host ID, pinned Planner publisher endpoint, owner-only runtime directory, build version and mode. Credential references are exclusive: private token file OR a `CONTENTOPS_*_PUBLISHER_TOKEN` environment reference. Do not copy credential values into source, images, logs or chat. Endpoint binding is still pinned to `https://planner-mcp-production.up.railway.app/mcp/publisher`; generic task data does not permit redirecting this credential to another host.

`profileDirectory` and `evidenceDir` reference already-existing owner-owned0700 directories without symlinks. They locate resources and grant no execution permission. Do not provision replacement profiles, import/export cookies, or rotate credentials to diagnose missing application composition.

## Registration and managed mode

Poll requires an existing tenant-owned host record and preserves its registered mode. Unknown hosts and requested mode upgrades are rejected. Initial generic host onboarding is not implemented by this slice: obtain a separately reviewed owner-managed registration mechanism rather than treating a poll or a syntactically valid host ID as registration authority. Existing registered hosts remain compatible.

The ordinary command remains:

```sh
node dist/workers/vk_connector_consumer.js /absolute/private/config.json
```

It serially polls/acknowledges and reports state. Normal launch does not inject a provider runtime factory. `vk_feed_provider` mode or heartbeat online does not prove that provider execution is wired. Never start another instance against a live queue just to test this command. On Tower all commands execute only in a reviewed Docker workload; no Mac Docker or native-host workaround.

A local private lock prevents concurrent consumers. Crash/stale-lock recovery requires inspecting the actual process and canonical job/attempt state; do not remove another process's lock or reset uncertain publication state. Another registered host must not interrupt or take over a healthy host's active job.

## Readiness-only operator boundary

After building, the explicit request selects an EXISTING job and its immutable package:

```text
node dist/workers/vk_connector_consumer.js --operator-preflight /absolute/private/config.json TASK_ID JOB_UUID EXPECTED_PACKAGE_SHA256
```

Supply IDs/hash obtained through authorized Planner reads, not a new hardcoded production route. Missing request data fails before control use. This mode calls only preview/get-job/get-health, checks the job again for drift, and inspects directory/dependency metadata. It does not poll, register a host, obtain a lease, issue a challenge, reconcile, upload, send, mutate a fact, or read profile contents. Deadline120s; cleanup30s. Unknown control/cleanup results remain blocked or unknown with sanitized codes; no retry is implied.

Diagnostics separate control availability, application authorization NOT_ASSESSED, provider readiness NOT_CHECKED and supplied recorded restriction provenance. A missing owning restriction projection is not proof of permission or absence of restrictions. Supplied null/malformed records fail closed. Scoped owning-system records can prohibit a matching operation; no match never grants execution. Current live provenance loading/verification is not established by synthetic fixtures.

Resources PASS means configured directories and the library are present. It does not prove installed browser assets, login, community rights, selectors, complete inventory or actual media acknowledgement. Production readiness remains false. An offline fixture is explicitly labelled and never becomes live evidence.

## Execution and reconciliation are distinct

The existing explicit `--operator-run` entry can inject the application provider runtime. It is execution-capable, not a harmless login diagnostic. The explicit `--operator-reconcile CONFIG JOB_UUID` can change reconciliation binding/generation. Neither is authorized by a readiness check or infrastructure migration. Do not install either into the managed service to bypass a denial.

Application-host challenges are scoped, short-lived and generation/package/instance/purpose bound. Upload requires canonical lease and a durable attempt first; fresh provider readback/media verification is required for a canonical fact. Started or uncertain results allow reconciliation only, never resend. A queued job, receipt, click, heartbeat or local timestamp is not success.

Shared connector image-feed execution is implemented. The existing lower-level Clip helpers remain available for synthetic tests, but shared connector Clip inventory/media acknowledgement is not verified and returns FORMAT_UNSUPPORTED before claim/send. Never use wall-photo absence/proof as Clip absence/proof. Browser search's fixture mode likewise does not establish live DOM/authentication readiness. Search API credentials are separate and do not grant publication rights.

## Container checks and rollback

Use `ops/vk-container/README.md` and the reviewed Tower runtime. Shared Chromium launch always enables sandbox and validates an optional immutable executable path. The test image has no session, credential, host socket, public port or network access. No new publisher/scheduler/consumer is activated by its tests.

Rollback code by reverting the shared release; preserve immutable job/history and private resource bindings. This change requires no database migration or secret rotation. The owner-approved historical two-field binding/backup remains a separate record. Runtime activation, session migration, provider acceptance and owner UAT remain separate from compilation and offline GREEN.
