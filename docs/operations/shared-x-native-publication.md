# Shared signed X native publication

Status: reviewable implementation; **not deployed, enabled, enrolled or UAT accepted**.
The shared text-only route accepts validated package data, not task/account
allowlists. It preserves LinkedIn/DEV.to/Setka image requirements and all shared
owner, tenant, accepted revision, identity, date, manifest, release, lease,
attempt, audit and fact fences.

## Controls and transport

`X_NATIVE_PILOT_ENABLED` defaults to `false` in both application and MCP runtime.
Enabling the flag only exposes the bridge/control plane; it cannot enroll an
installation or release a post. Owner/Publisher MCP has these generic controls:

- `ba_issue_x_native_pairing`: exact canonical package + public key + extension ID
  + independently reviewed `bundleSha256`;
- `ba_register_x_native_installation`: preview/apply, signed one-shot pairing and
  explicit real owner no-send UAT reference and the same reviewed `bundleSha256`;
- `ba_revoke_x_native_installation`: sticky, audited channel-scoped revocation;
- `ba_issue_x_native_challenge`: flattened shared claim boundary, installation,
  reviewed bundle digest, phase and attempt. Never returns a raw lease or click permit.

Remote MCP binds project/actor from the authenticated principal. Shared services
also require current project-owner access. These controls do not create an
executor RPC, bypass copy approval or approve subsequent publications.

HTTP prefix `/api/integrations/x-native/` has owner-authenticated JSON controls
`pair`, `register`, `revoke`, `challenge`. Signed extension delegates are
`pair-read`, `pair-receipt`, `read`, `advance`, `reconcile`, `refresh`, `heartbeat`,
`receipt`. Owner actor comes from JWT, never caller-supplied identity. Delegate
Origin must exactly equal the enrolled `chrome-extension://<extension-id>`;
signatures remain mandatory. Routes have bounded JSON bodies/rate limits,
no-store responses, redacted errors and isolated CORS. Receipt body is only
`{receipt}`. Raw lease is restored server-side from nonce/audited context and
never serialized to the extension or persisted in workflow audit.

Pairing and enrollment are one lifecycle; exact per-publication release/claim,
signed start, signed pre-submit and same-attempt confirmation are another.
Enrollment is not a standing publication release. A future scheduled package
cannot consume an editor receipt or start an attempt, and native click rejects
before page interaction. X account reference, profile handle and provider ID
must agree exactly before admission, avoiding an unconfirmable case mismatch.

## Build and verify

### Read-only installation/task diagnostics

`ba_get_x_native_state` is a single MCP-only observation for enabled
Owner/Publisher profiles whose authenticated user is a project owner. Required
arguments are `projectId`, `channelId`, `taskId`, `candidateInstallationId` and
the transport-bound `actorId`. IDs are positive signed32-bit integers; the
candidate is a64-character lowercase hex public installation fingerprint.
No `apply`, cursor, limit or arbitrary filters are accepted. No new HTTP route
or credentials are introduced.

The strict response exposes administrative binding consistency, capped public
installation/audit diagnostics and exact-task delivery-history booleans. It
contains no keys, cookies, accepted copy, leases or provider payload. Incomplete
or malformed evidence means unknown/null, never a proven empty inventory. A
sticky revocation wins even beyond the audit cap. Reads run in a bounded
read-only RepeatableRead transaction; a third simultaneous read returns BUSY.
Reads do not enroll, verify provider ownership, renew leases, approve execution
or establish exclusivity. Observe before a trust change, but do not treat the
snapshot as an atomic registration permit. Started/uncertain attempts still
require same-attempt reconciliation only.

Verification includes `x-native-state-read.test.cjs`,
`x-native-state-read-postgres.test.cjs` and the100-request/1RPS
`x-native-state-read-load.test.cjs` in `tests/tdpd`. Use the existing isolated
PostgreSQL Compose stack and X image overlay. On tower only, after inspecting
routes and networks, `x-native-state-read.tower.compose.yaml` selects a small
test-only subnet when the Docker default pools are exhausted. It must not be
used to alter or prune another project's network. Rollback removes only the
read command/capability after reads drain; it requires no data migration and
must not reset an installation, profile, journal, lease or publication history.

### Container checks

All build/test/browser workloads run in tower Docker. Build the reviewed
`ops/quality/Dockerfile` `buildcheck` target with a unique tag, then run Node
tests with source mounted read-only and `NODE_PATH=/opt/planner/node_modules`.
CI's shared-browser job records the focused suites and actual isolated
PostgreSQL races; the X overlay is `tests/tdpd/x-native-postgres.compose.yaml`.
Use a unique Compose project, synthetic guarded database only, and ordinary
`down` afterward; never mount production/restored data or use `down -v`.

The import-safe packager is `scripts/build_x_native_extension.mjs`:
`--source <extensions/x-native> --output <new-directory>`. It checks every
mandatory asset, least-privilege pilot manifest, syntax and local dependencies
before exposing output. Explicit allowlist excludes old key-only UI, unrelated
files and secrets. Existing output is preserved. Trusted cooperating builders
are serialized by an exclusive sibling lock; staging is renamed only after all
checks. This is not a hostile-filesystem race guarantee. `INTEGRITY.json` has
deterministic file byte counts/SHA-256 and a bundle digest; no machine path/time.
Build never evaluates extension source, installs it, enrolls it or sends.

Runtime software self-measurement checks that fixed, exact manifest inventory,
byte counts and file digests still match the independently reviewed receipt.
It does not enumerate arbitrary unreferenced files on disk. The reader is stamped
with its template SHA at build time and read-handshaken before any click; an old
loaded content script cannot silently act as the reviewed reader. CSP adds only
`connect-src 'self'` for these packaged resources; no remote host/permission grows.
The digest is immutable in audited enrollment and bound into signed reads and
pairing/execution challenges. Missing legacy bindings fail closed. Each bundle
uses a distinct non-exportable key slot; no automatic enrollment or key/journal
reset occurs. Updating requires quiescent/in-flight reconciliation or explicit
quarantine, reloading the extension itself and X editor, and new pairing/enrollment;
keep old journals. Never edit an already-loaded directory in place: measuring
disk bytes cannot attest which background modules were loaded earlier.

This implements the approved trusted-executor model, **not device/remote
attestation**. A malicious replacement retaining a key could lie about a digest;
compromised extension/browser/OS and deliberate profile/key cloning remain the
explicitly approved residual risk. Defending against that requires a separate
trust boundary, not a stronger claim for this self-check.

## Operational sequence and stop conditions

1. Review the exact code and verify bundle integrity before approved installation.
   Ops supplies the independent bundle receipt; do not approve a digest merely
   because the extension reported it.
2. In the approved owner browser, obtain only the public installation identity.
   Complete real signed no-send pairing/UAT against the exact canonical package;
   record actual evidence, never invent an acceptance reference.
   Keep the accepted editor open; scanning uses a separate disposable profile tab.
3. Owner enrolls that key/extension for the channel, separately from releasing
   the accepted publication via the shared audited lifecycle.
4. Sole operational Publisher claims the exact released package and issues its
   START challenge. Extension checks current account, history and existing draft.
   Unknown drafts are never replaced. The permanent local journal precedes start
   and click; signed pre-submit grants at most one permit lasting ≤15 seconds.
5. An observed native object must match account/text/time/status URL before the
   canonical atomic fact/attempt/audit confirmation. Receipt alone is not success.

Lost responses, UNKNOWN, crashes and an existing journal entry allow only
same-attempt reconciliation. No journal clearing, alternate route/API,
engineering send or blind retry. Heartbeats never renew execution windows.
Revocation and default-off flag stop further delegate authority without erasing
installation, nonce, lease, attempt, release or fact history. Reconcile in-flight
work before rollback/uninstall; do not destroy a key to evade a pending attempt.

## Remaining release evidence

Tower unit/contracts/build and isolated PostgreSQL races do not prove the real
Chrome service-worker Origin, native provider DOM, popup rendering or owner UAT.
The earlier **No usable sandbox** failure was the fixture omitting the existing
reviewed seccomp profile and narrow `SYS_CHROOT` capability. Reusing that exact
boundary passed actual namespace/seccomp diagnostics, synthetic signed pairing
and worker Origin checks, native negative/once-only/restart checks and both
desktop/mobile renders. Independent reviews accepted the applied delta and
bounded visual/source result. `ops/x-native-extension/` records provenance and
commands. No `--no-sandbox`, privileged/unconfined container, `SYS_ADMIN`,
host-policy change or personal-profile injection was used.

These synthetic checks do not establish production endpoint compatibility or
real-account pairing. Do not claim activation, enrolled real installation or
real no-send UAT before those actual steps and explicit owner acceptance.
Publication remains solely with Ops.

## Minimal first-install no-send handoff

Ops prepares the exact current canonical eight-field public package, accepted
text, reviewed artifact/receipt and one-shot pairing code. No tokens, cookies or
leases belong in the packet. The existing publication GO is not requested again.

Owner steps, after Ops confirms deployment/flag and releases only the no-send
pairing flow:

1. Load the verified built directory as an unpacked extension in the intended
   personal Chrome profile. Keep one X tab with the exact accepted draft; after
   installation/update save the draft and reload that tab.
2. Open the extension and choose **Показать данные установки**. Return only its
   public JSON. Ops compares its bundle digest with the reviewed receipt and
   issues the exact pairing code.
3. Paste the supplied public package and pairing code, then choose **Проверить
   без отправки**. Report the actual result; leave **Опубликовать один раз** alone.
   Ops records the real owner UAT reference and performs preview/apply enrollment.

This packet does not authorize engineering to send. Sole Ops then follows the
existing exact-package release/claim lifecycle. A started/uncertain attempt is
reconciliation-only, including across bundle changes.
