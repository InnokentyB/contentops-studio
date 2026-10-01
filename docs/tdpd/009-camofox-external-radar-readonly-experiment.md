# TDPD-009 — Hardened read-only Camofox pilot for External Radar

Status: **BLOCKED at RED gate / NO-GO for integration**  
Date: 2026-09-26  
Method: Test-Driven Product Development (TDPD), an original method by Innokenty Bodrov.

## Evidence baseline

- Upstream: `https://github.com/jo-inc/camofox-browser`
- Release: `v1.17.0`
- Commit: `389c996ae3c7d42e539295a336ee6f975847f066`
- Review date: 2026-09-26
- Authority: external upstream; untrusted until reproduced inside the hardened boundary.
- Approval: security review permits specification and RED tests only.
- No repository install, lifecycle script, browser binary, add-on, cookie, token, profile, container or network call was used for this experiment artifact.

Material upstream changes invalidate this evidence baseline and require review before work resumes.

## BP-01 — Business problem and success signal

Some permitted public research sources are unreliable in headless Chromium, while raw HTML/DOM consumes excessive tokens. The organization researcher needs a cheaper or more reliable anonymous reader without gaining publication authority or account access.

The pilot succeeds when a fixed 20–30-task corpus shows either:

- completion rate improves by at least 15 percentage points; or
- token cost falls by at least 30%;

while extraction accuracy degrades by no more than 2 percentage points and session residue, unauthorized egress, policy incidents and external writes all remain zero.

## Reliance and harm

Risk is high because the component controls a browser and upstream defaults can expose secrets, internal networks and arbitrary page execution. Errors may be delayed and externally observable. The pilot therefore remains anonymous, allowlisted, read-only, isolated and human-gated. CAPTCHA, login walls, bans and platform controls are terminal manual-evidence states, never bypass targets.

## Architecture decision ADR-009

### Decision

Do not embed Camofox in `puppeteer_publisher.service.ts` and do not expose upstream HTTP routes. Introduce a future `BrowserDriver` interface with Chrome as the default/control. A Camofox implementation, if Green is authorized, runs as a separate internal container behind a ContentOps-owned project-scoped facade.

The minimal future topology is:

`Organization Researcher → External Radar service → project-scoped read-only facade → isolated Camofox container → allowlisted public origin`

### Facade surface

Only three operations may exist: `navigate_public`, `snapshot_accessibility`, and `close_session`. The facade owns project/session identity, method filtering, URL/DNS/redirect validation, timeouts, teardown and structured evidence. It never accepts raw cookies and never returns browser cookies or storage.

Explicitly absent: evaluate, upload, download, cookie import/export, VNC, plugin install, POST/PUT/PATCH/DELETE, authenticated profiles, proxy rotation, drafting, comments, reactions, outreach and publication.

### Hardened image proposal

- Build with lifecycle scripts disabled; fetch no `latest` artifacts.
- Pin source, browser and uBlock artifacts by immutable version and SHA-256 or signature.
- Override vulnerable `adm-zip`; require `npm audit` with zero high/critical and a CycloneDX SBOM.
- Run as a numeric non-root UID/GID with read-only root filesystem, `cap_drop: ALL`, no host mounts, tmpfs-only profile/download paths, memory/CPU/PID/time limits and a dedicated network namespace.
- Disable persistence, crash reporting, Sentry, traces, default plugins, YouTube integration and VNC.
- Allow egress only to DNS plus the per-experiment origin allowlist; validate resolved addresses before connection and after every redirect.
- Destroy the session on success, timeout, crash, challenge or policy violation.

This is a proposed boundary, not an implemented or approved runtime.

## Deterministic rules and traceability

| Rule | Observable scenario | RED test |
|---|---|---|
| SEC-01/02 | Reproducible offline install evidence; pinned hashes; clean dependency audit; SBOM | supply-chain contract |
| SEC-03/06/07 | No telemetry or persistent state; contained non-root runtime | hardened runtime contract |
| SEC-04/09 | Private/rebound/redirected targets and mutating requests are denied | network policy contract |
| SEC-05/08 | Missing/cross-project identity and excess capabilities are denied | facade contract |
| POL-01/OPS-01 | Challenge/login/crash stops safely without bypass or mutating retry | stop-state contract |
| CMP-01 | One approved 20–30-task corpus drives Chrome and Camofox against the same oracle | corpus contract |

Run RED evidence with:

```sh
npm run test:tdpd:camofox:red
```

The command must currently fail because the hardened candidate, facade, audit evidence, SBOM and approved corpus do not exist. It is intentionally excluded from the normal production test suite until the Input gate is reopened.

## Gates

- Evidence gate: PASS for the named upstream revision only.
- Reliance-and-harm gate: PASS with high-risk constraints above.
- Input gate: **BLOCKED** — hardened fork/image and exact public-domain allowlist are not owner-approved.
- Surface gate: **BLOCKED** — facade contract is proposed, not approved for implementation.
- RED gate: PASS when the command fails on the absent controls rather than test infrastructure.
- Green gate: NOT STARTED. Green never grants publishing rights.
- UAT: NOT STARTED. Owner compares the fixed corpus and decides whether the reader is useful; capability remains read-only even after acceptance.

## Human decisions required before implementation

1. Approve the exact fork/repository and immutable image provenance.
2. Approve the domain allowlist and the 20–30 oracle-labelled anonymous corpus.
3. Approve the three-operation facade and the proposed container/network boundary.
4. Confirm that authenticated drafting or publishing remains a separate hypothesis and security review.
