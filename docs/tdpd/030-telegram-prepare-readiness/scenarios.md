# Accepted preparation readiness — executable boundary

Owner approved the concrete LOCK/QAR/ARCH/RISK local implementation on2026-10-23: «Да, утверждаю локальную реализацию исправления для №1159. Делай и проверяй.» The implementation is shared, without business-ID authority. Source design copied beside this file. Interface: existing ba_prepare_publication_task through the authenticated publication principal. Provider sends, production mutations and deploy are outside this local approval.

Essential synthetic PostgreSQL scenarios through the actual registered MCP handler:

1. Approved, accepted current Telegram revision and active approved durable asset → ready_for_execution, same approval_required mode and exact text/revisions/asset/review records, rebuilt current bundle, one actor-bound audit; zero attempts/facts/releases.
2. Repeated preparation of the now-ready task is read-only and creates no additional audit; existing ready and owner_released behavior stays unchanged.
3. Foreign/missing principal, revoked membership or demo actor cannot write readiness or audit.
4. Stale/rejected/foreign/inactive decision or required-but-missing visual cannot gain readiness, even with project visual pipeline disabled.
5. Publication fact, prior attempt/release, hold, executing/leased work, storage incident or pending reassessment → refusal without mutation.
6. Audit failure, CAS failure or package change between initial read and transaction → no partial preparation; stable safe cause and corrective action.
7. Concurrent preparation → at most one state transition/audit; conflicting request is retried only after fresh read.
8. Drafted tasks are not accepted; other transports do not enter the Telegram repair path.
9. Valid current NO_VISUAL_NEEDED decision may prepare, but cannot waive required visual.
10. Imported handoff/account and legacy stored asset metadata never expose or newly persist credentials; accepted content and checksum fields remain usable. Response-only redaction preserves legacy records unchanged.
11. An imported stale slot cannot be silently prepared as a different current schedule. Concurrent asset replacement is detected even with the same millisecond timestamp.
12. Lost COMMIT acknowledgement is reported as unconfirmed, not falsely rolled back; readback/repetition observes the one existing preparation audit and creates no send authority.

Live provider availability and human acceptance are not established by synthetic scenarios. The sole Publisher remains the only sender after a separately authorized release.
