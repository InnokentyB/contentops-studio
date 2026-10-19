# Approved LinkedIn acceptance plan

Owner approved LOCK/QAR/ARCH/RISK on 2026-10-19. Named deterministic dependency: LinkedInPostsSynthetic, replacing HTTP responses and server-owned admitted bindings, never production identity or permissions.

| ID | Initial state/action at recovery operation | Observable result |
|---|---|---|
| LI-01 | Trusted attempt receipt + exact provider GET | One verified object delivered to canonical finalizer; no dispatch |
| LI-02 | Complete unique history match but no receipt | UNKNOWN, causal proof unavailable; zero fact writes |
| LI-03 | Wrong author/body/time/object/media or non-public lifecycle | Incomplete evidence, zero fact writes |
| LI-04 | Missing grants, route admission or application reader | Specific capability/permission block, no provider fallback |
| LI-05 | 401/403/429/5xx and malformed/oversized response | Safe denied/transient/incomplete result; zero raw secret disclosure |
| LI-06 | Pagination incomplete, repeated cursor or arbitrary next URL | Bounded incomplete result; no external-host fetch |
| LI-07 | Abort/deadline/request budget exhausted | No further HTTP request or late verified evidence |
| LI-08 | Candidate injection into verify | Unissued candidate rejected; independent provider GET required |
| LI-09 | Actual MCP uncertainty callback with unavailable capability | Structured actionable recovery returned through real diagnostic serialization |

Existing coordinator/finalizer tests remain required for transaction races, changed package, revoked approval, budget across replay, and no side effects on rejection. Live permissions and trusted receipt issuer remain unverified and unadmitted; engineering GREEN is not live UAT.
