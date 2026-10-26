# LOCK028 acceptance scenarios

Approval: direct Owner reply to call_9b383b5e13564f89a33d2c6cbf3d56e3, before scenarios/tests. Deterministic dependency: SyntheticLegacySupervisor + SyntheticOwnedProfileReader; these do not prove Setka production readiness.

| ID | Initial state/action at Owner control boundary | Observable result/persistence |
|---|---|---|
| L01 | Expired historical Setka attempt, no permit; preview | Exact prerequisites, no writes or provider calls, no submit authority |
| L02 | Same scope, registered valid technical custody and fresh complete profile absence; apply then replay | Same attempt resumes once into private supervised pickup; atomic audit; no extra attempt, fact or permit; replay no extra reads |
| L03 | Valid same-attempt native object found by reader | Existing canonical finalizer records one fact/attempt/audit atomically, replay read-only; no resend |
| L04 | Any old permit/dispatch, active lease, extra attempt/history, unaccounted writer/native challenge | Specific hold before provider work; no generation/lease change |
| L05 | Supervisor absent/forged/wrong scope/late/partial custody, or incomplete/wrong account/stale/ambiguous read | UNKNOWN, actionable cause; no NOT_DISPATCHED/pickup authority |
| L06 | Concurrent apply/apply and permit/apply, old-generation callbacks | At most one admitted generation; no old permit or fact writer bypass |
| L07 | Non-owner/demo/cross-tenant/revoked approval/changed accepted package/visual/fact conflict | Zero unauthorized calls/writes; late change rechecked transactionally |
| L08 | Process restart/new keys/transient failures/request exhaustion/deadline/cancellation | Durable cumulative max3/20/180s; no reset or late commit |
| L09 | Audit/fact failure injection | Adoption/fact/lease/audit all roll back; safe persistent hold after reservation |
| L10 | Real MCP SDK calls and role/principal scoping, default absent runtime | Strict schema rejects proof flags; safe messages no secrets/lease; live unsupported mutation hidden |

Focused tests exercise real PostgreSQL and existing fact/preparation lifecycle, with concurrency bounded to one file. Existing Setka/shared/recovery/preparation/visual guards remain regression gates. Backend build and quality gate required; new provider smoke and human UAT remain pending.
