# X verified pairing recovery

Owner LOCK/QAR/ARCH/RISK approval: direct owner answer `да` to the owning
X-registration chat's concrete one-recovery/current-package/24-hour proposal,
2026-10-20. Earlier human no-send UAT acceptance remains historical evidence;
fresh successor requires a new signed no-send observation. No publication scope.

Independent design review identified grant binding, global cap, concurrent
supersession, snapshot transition and time/preview details. This contract closes
those details without increasing the approved recovery count or send authority.

## Operator boundary

Existing owner-authenticated `ba_issue_x_native_pairing` / HTTP `pair` accepts an
optional strict `recovery` object: predecessor nonce, explicit owner reference,
phase (`preview`, `authorize`, `apply`, `revoke`) and exact grant ID for apply-ready
preview/apply/revoke. A preview without grant ID explicitly returns
`pairing_recovery_authorization_preview`, `apply_ready:false`, grant-required reason
and next step. It is not an apply-ready preview. A preview with the exact grant ID
validates all apply eligibility without writing or reserving anything.
No new endpoint, role or extension permissions. Transport binds actor as before;
current project-owner membership is checked on every operation. A reference alone
does not authorize apply: authorize first creates a durable server grant and
immutable audit with authenticated owner, exact predecessor hash, current full
snapshot, key/installation/extension/bundle and approval binding. Apply resolves
that grant and atomically consumes it. Revoke is sticky and audited.

## Limits and times

Ordinary issue cap stays three per project/task/actor. Only one recovery grant
and one successor per project/task, across all actors, roots and installations;
this deliberately stricter cap prevents another ordinary root or identity opening
another lineage. Grant is valid for 15 minutes, never beyond predecessor issuance
+24 hours. Its expiry is not renewed on authorize replay. A predecessor must be
ordinary, expired, unconsumed and verified in its original five-minute window;
recovery rejects at predecessor issuance +24 hours. Root is the immutable ordinary
issue audit/nonce hash; successor cannot be recovered recursively.

Server verification audit timestamp must satisfy issuance <= verification <
challenge expiry and verification <= now. Challenge read/verify still rejects at
five minutes. Enrollment rejects at issuance +24 hours, uses that original bound,
and never renews proof. Clock rollback/future or malformed audit fails closed.

## Exact binding and concurrency

Predecessor and successor snapshots must be deeply equal for every field except
`manifestChecksum`. Project/task/actor, public key, installation, extension and
bundle must be identical. Current entire canonical snapshot passes existing
owner/tenant/accepted-copy/schedule/assets/identity/manifest gates. Do not check a
stale manifest against current context as though it were fresh; the newly signed
successor is the only proof that can enroll the current manifest.

Reject existing installation or sticky revoke audit, publication fact, attempt,
active work or dispatch. Recovery grant consumption, exact predecessor CAS,
successor issuance and immutable supersession event are one serializable
transaction. All read/verify/enrollment paths reject a superseded nonce. The
predecessor signed record is never rewritten. Enrollment and recovery contend on
the same predecessor row, yielding one winner. Failure rolls back all mutations.

Shared read-only eligibility is used by preview and apply; preview is neither
reservation nor enrollment. Existing registered-record idempotency remains
separate and cannot bypass ownership, current context or sticky revocation.

## Evidence required

Time-controlled RED/GREEN: delayed enrollment; three-issue recovery; no grant or
wrong grant/owner/snapshot/key denial; expired/unverified/recursive root denial;
one global successor; altered copy/schedule/identity/bundle denial; future/missing
or malformed verification evidence; original and 24-hour boundary equality;
preview no-write parity; revoked installation; audit rollback. Isolated PostgreSQL
concurrency must establish atomic one-successor and enrollment/supersession fence.
Backend build, quality gate and independent patch review are mandatory.

Real recovery only through sole Publisher after reviewed deployment. Preserve
all audit, keys, journals and attempt/fact records. No counter reset or DB repair.
Trusted-executor self-measurement limitations remain unchanged. Rollback reverts
new recovery admission; do not erase already accepted registration or history.
