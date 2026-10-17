# PR172 trusted-transition consumption

Owner instruction on 2026-10-17, direct human message
`01a14b17-4d91-7613-8c6d-df5dae52af4e` in this chat:
«Тогда одобряю слияние PR174 и отдельный допуск PR172 по проверенному пакету stage2. Продолжай.»

PR174 introduced the reviewed general mechanism and merged as
`5939dfff95d46078c943ad8ef1fa32b6290553a9`. The separate staging PR176 installs
the exact owner-approved payload SHA256
`2794dbc59290fe18a80f7da82472bda8fb34afa64afbf7439817f07baa847440` while leaving
the old source and baseline unchanged. Its merge commit is recorded below after
confirmation, and is the trusted comparison base for this correction.

This PR retains the exact two source files from
`389a92627caa402db289d627aedfd095fa4bbc99`. Only six task_identifier identities
are replaced in the baseline. Each existing row retains its count, owner, reason,
remediation and all other metadata. The authority record itself is unchanged.
No new bindings or task-specific production entry points are introduced.

Earlier sandbox proposal/TRUN documents describe historical failures before the
transition mechanism and its separate authorization existed. Their provenance is
preserved. The current result and its trusted base are recorded here, not inferred
from an aggregate count or from those historical NOT_ADMITTED markers.

The correction preserves browser sandbox defaults. Offline tests do not prove a
real native browser/session is ready. Shared Dzen adapter integration, provider
action-scope applicability and human UAT remain distinct requirements. No deploy,
provider request, publication fact or clearance of an existing refusal follows
from the owner's source/baseline admission approval.

Trusted stage merge: `0e33252ae3a6a8075e037ada739900b1423b2a3e` (PR176).
Stage verification: tower quality gate PASS, no applied transitions; GitHub Actions
run39057701483, all five jobs SUCCESS. Independent staging review of `d14605d`
confirmed fixed-path payload identity and unchanged source, baseline, gate and CI.

## Integrated verification

Executed source head: `5b505f8a98af3330bdac6c45c638849279a5ed27`.
Trusted event base: `0e33252ae3a6a8075e037ada739900b1423b2a3e`.
All tower project execution used the reviewed Docker/Compose controls: non-root,
network none, read-only source/root, CPU/memory/PID/log limits and bounded tmpfs.
No application service, database, scheduler or native browser was started.

- `npm run quality:gate`: PASS; score77 equals retained minimum77, no hard stops;
  findings7096, baseline7096, exactly six appliedTransitions. No scanner change.
- Six Dzen offline suites:56 PASS, zero failures/skips. Both actual launch-option
  regression checks and cleanup assertions remain included.
- Reviewed build-check Docker target: backend and frontend build PASS.
- Independent consumption review `/root/dzen_runtime_review_retry` of exact
  `5b505f8` against the trusted base: PASS, no open P1/P2. Full source hashes,
  exactly six identity-only baseline replacements, all row metadata/formatting,
  unchanged authority record/gate/CI and original regression tests confirmed.
  Reviewer inspected source/diff; they did not independently rerun these checks.

Runner setup errors preceded the final56/56 result: missing mountpoint beneath
read-only source, static-check image lacking generated Prisma client, then the
legacy module's required synthetic Telegram environment value. The runner was
corrected to use the generated build image and CI's clearly synthetic token with
network disabled. No test assertion was removed and no application code changed.
Temporary containers used --rm. Logs: `/tmp/browser-sandbox-consumption-quality.log`,
`/tmp/browser-sandbox-consumption-tests-final.log`,
`/tmp/browser-sandbox-consumption-build.log` on the operator Mac.

GitHub Actions results belong to the exact published head and are reported in
PR172 checks. This receipt does not predeclare them or claim human/native UAT.
The owner authorized PR174 merge and the separate exact admission; PR172 itself
is prepared for review and is not merged under an inferred broader approval.
