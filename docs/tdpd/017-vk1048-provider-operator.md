# VK1048 provider: operator boundary

Only project10/task1048/channel117, accepted revision1, asset130 and ordinary
image feed are in this pilot. The existing job is retained; resuming it is not a
new publication approval and does not permit a different revision or channel.

## Current production prerequisite

The existing Publisher credential is sufficient for Planner control commands.
No replacement token, password, OTP, browser cookie or profile export is needed
for this code change. Authentication to Planner and permission to act in VK are
separate checks.

On 2026-10-13 the agent attempted to bind the existing Chrome community tab
`https://vk.ru/club240051152` for a read-only inspection. Browser Use rejected
that action under its site-safety policy and explicitly prohibited indirect
execution, raw CDP, alternate browser surfaces, and other workarounds for the
same outcome. This is a current, community-scoped tool denial, not a VK login,
token, or application authorization failure. The agent must not activate a
standalone provider to bypass it.

The historical 2026-10-08 denial concerned binding a VK conversation tab
`/im/convo/-22884714`; it did not establish a permanent blanket domain ban.
The new denial above independently covers the current community inspection.
No prompt or automatic approval review was attempted by the tool on either
reported denial; no approval-service API or policy-clearance endpoint exists.

The application's ephemeral managed-host challenges authorize and fence Planner
operations. The existing authenticated Publisher host is a trusted client: it
collects wall text, timestamps, object IDs, media binding and pagination evidence.
The server cannot independently prove those DOM observations or an absence scan
from a caller-supplied envelope. A nonce prevents replay and scope substitution;
it does not prevent forgery by an equally privileged Publisher owner. Independent
bounded downloading can verify supplied image bytes, but does not independently
prove that the image URL belongs to the claimed wall object. This assurance
limitation must remain visible in acceptance and incident handling. They do not grant the agent platform-policy clearance, establish a
logged-in session, or independently prove every browser observation. Local
profile/resource configuration is not permission. The existing managed consumer
remains inactive for provider operations; login and community rights are
NOT_CHECKED. A human operator must perform the live verification in their own
execution context before acceptance.

An offline successful fixture is evidence of integration behavior only. It is
not a live publication, a proof of the current browser session, or owner UAT.

## Safe result handling

A complete, fresh inventory must cover the exact release-through-capture window
within 120 seconds and at most100 objects. Ranking search results or viewing a
single wall page does not prove absence. A matching caption without a verified
approved-image acknowledgement remains UNKNOWN. Provider absolute time and
object/permalink must agree with the exact community.

An existing exact post is reconciled without sending. Only proven scoped absence
and a valid canonical lease permit a single durable attempt. An uncertain upload
or send is never automatically retried. Current generation, package and lease
are checked at each consequential boundary and within fact recording.

## Rollback

Stop provider consumption before reverting its executable. Keep compatible state
readers and the additive schema, job history, previous receipt, canonical lease,
attempts, publication facts and measurement checkpoints. Do not reset an
uncertain job or work item to available. Do not remove the additive columns or
host mode constraint expansion while newer rows may reference them. The
infrastructure-only consumer remains the fallback; it does not publish.

## Acceptance still required

Live permission assessment, current session/community checks, provider media
acknowledgement, complete inventory, one scoped real-provider smoke and explicit
owner UAT are required before claiming successful automatic publication.

The implementation adds an owned Playwright lifecycle, bounded wall collection,
original-photo byte verification, heartbeat renewal, and a reconciliation-only
handoff after an uncertain attempt. These are offline-tested implementations;
wall pagination and original-download selectors still require live verification.
A complete feed scan is required before absence can permit a send. A provider
that recompresses the approved image may fail exact-byte verification; retain
UNKNOWN in that case rather than inventing acknowledgement.

## Explicit human operator entry

The managed LaunchAgent invokes the normal consumer entry. It never injects a
browser runtime, even if provider mode or profile resource paths are configured.
A human-owned execution context can deliberately use the checkout entry
`node dist/workers/vk_connector_consumer.js --operator-run <private-config>`.
The current restricted agent must not invoke that entry or arrange for another
process to invoke it. This is an operator handoff, not a tool-policy override.

Operator prerequisites: stop the existing managed consumer gracefully, preserve
its exclusive lock until its owner releases it, keep the same host/job/package,
and use the existing private VK profile and Publisher credential. Do not copy
cookies or credentials, create another job, reset an uncertain attempt, or
change the release. `profileDirectory` and `evidenceDir` must be absolute,
owner-only existing resource directories; the private config remains mode0600.

The operator entry requires the checkout's pinned Playwright dependency and its
vendor browser assets. The copied managed artifact can start independently of
checkout dependencies, but does not bundle Playwright/browser assets for live
operator execution. Do not claim a missing runtime dependency is a VK/token
failure.

A blocked pre-attempt job requires a fresh owner CAS resume against its current
generation; retain existing job `3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de`. An
uncertain or started attempt requires reconciliation-only rebind and readback,
never another send. Record the resulting canonical fact/permalink or the precise
UNKNOWN blocker. Accept only after real provider selectors, login/community
rights, inventory completeness, media identity and single-send behavior have
been checked and the owner has performed UAT.

## Mandatory route rule (owner amendment, 2026-10-13)

The single operating source is `docs/operations/vk-owned-publication-route.md`.
All Codex roles use only documented Planner control commands and the registered
independent adapter. Never open VK through Codex CUA/ComputerUse, personal tabs,
CDP/session injection or fallback, even for preflight, login checks or UAT. A
failed/unavailable adapter remains BLOCKED for engineering repair. Explicit
site/action denials remain binding; independent architecture grants no override.
The human operator handoff above is separate and does not grant this agent a
provider execution context. UNKNOWN/started/uncertain never becomes a resend.
