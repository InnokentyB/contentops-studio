# Agent settings save diagnostics — proposed corrective delta

## LOCK
Show a visible, localized result and recovery action when saving agent configuration fails. Preserve existing coordinated writes and their order. Do not claim that the entire form was saved when only one field committed. No automatic retry and no production outage injection.

HTTP errors expose allowlisted code, action, and per-field save outcome (prompt/model/key identifiers only, never values). Distinguish not_saved, partially_saved, synchronization_pending, and unknown. A failed response before any commit is not_saved only when proven by the writer contract; an unexpected transaction/control error is unknown. Post-commit synchronization failure records that field as committed/pending; later fields are not attempted. A later pre-commit failure preserves prior successful field outcomes.

UI retains user edits, shows cause and next action, and never displays the normal success message on failure. Pending/partial/unknown outcomes instruct the operator to check stored values and restore synchronization before repeating; a proven not_saved result permits retry after Redis recovery. Do not display secret payloads or key values. Existing errors remain Error-compatible through the API client.

## QAR
Deterministic acceptance for pre-commit refusal, post-commit pending, later-field failure, unknown failure, normal success, and legacy API errors. Test real HTTP/client/UI boundaries with synthetic data in Docker; no sleeps or production Redis shutdown. Relevant backend/frontend builds and quality gate required. Human UAT remains separate.

## ARCH
Small shared error/result mapper for the agent save route, structured Error-compatible frontend transport, scoped visible diagnostics in existing agent settings UI. Preserve sequential persistence and durable invalidation contracts. No new schema, cache exemption, auth grant, worker or publication operation. No changes to scanner/baseline are authorized by this proposal.

## RISK
Never infer whole-form atomicity from single-field commit. Unknown errors remain unknown. Do not serialize exception objects, raw details, setting values, tokens, Redis URLs or provider secrets. Preserve current Owner/tenant checks and don't weaken writer refusal on Redis loss. No repeated save from an automatic retry. Public PR/deploy are not covered by this local corrective design approval.

Status: Owner approved in this engineering chat on 2026-11-11 before acceptance scenarios and implementation. Local synthetic verification only; no public push or production release authorized by this approval.
