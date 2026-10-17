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

- `ba_issue_x_native_pairing`: exact canonical package + public key + extension ID;
- `ba_register_x_native_installation`: preview/apply, signed one-shot pairing and
  explicit real owner no-send UAT reference;
- `ba_revoke_x_native_installation`: sticky, audited channel-scoped revocation;
- `ba_issue_x_native_challenge`: flattened shared claim boundary, installation,
  phase and attempt. Never returns a raw lease or click permit.

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

## Operational sequence and stop conditions

1. Review the exact code and verify bundle integrity before approved installation.
2. In the approved owner browser, obtain only the public installation identity.
   Complete real signed no-send pairing/UAT against the exact canonical package;
   record actual evidence, never invent an acceptance reference.
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
