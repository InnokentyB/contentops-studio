# Dzen admission origin audit — 2026-10-16

Read-only provenance audit. No provider action, policy change, release, attempt,
fact, session or credential mutation. Not a legal interpretation.

## Primary tool evidence

Source: Portfolio OS thread `01a0df21-ea6c-71f2-9c1b-40393de0e105`, retained
session transcript. Call `call_34840360c84440a286f2230a22165d96` at
`2026-10-11T21:17:36.738Z`; result `2026-10-11T21:17:42.380Z`.
Action: CUA `js` calling `cua.createBrowserTab(browser.browserId,
"https://dzen.ru/a/asvdioZFzXeQEO5O")` to inspect published article task1045.

Exact relevant tool result:

> Browser Use rejected this action due to browser security policy. Reason: The
> site-safety policy blocks this action; no user permission prompt or Auto-review
> was attempted. Browser use is not permitted on
> https://dzen.ru/a/asvdioZFzXeQEO5O. The agent must not attempt to achieve the
> same outcome via workaround, indirect execution, raw CDP or browser commands,
> alternate browser surfaces, or policy circumvention. Proceed only with a
> materially safer alternative that does not require this blocked browser action;
> if none exists, stop and request user input.

This is genuine Dzen-specific evidence, separate from the VK community denial
of13Oct. It prohibits workaround execution of that blocked outcome. It does not
by itself establish a universal Dzen domain/action ban, an external legal ban,
or the scope/availability of an admission service for task1002 inventory.

## Application origin and scope gap

`b07328fae4e22a5ff0f5e8dfe8c0491eedbbf922` / PR149 introduced
`requireDzen1002DiagnosticAdmission(probe?)`. Without a probe it always throws
`DZEN1002_ADMISSION_SOURCE_UNAVAILABLE`. No production probe is configured.
PR159 subsequently applied it before task1002 preflight/live publication.
Therefore that error is an application-generated stop before access, NOT a fresh
provider denial, authentication failure or evidence that an external admission
service exists. The approved diagnostic packet explicitly included this disabled
entry; its approval is an application contract, not a tool-policy verdict.

Historical engineering prose saying Dzen has a blanket external prohibition or
must obtain clearance from an unspecified service overstates the available
evidence. Current broader owner/registered-adapter/tenant/release/manifest/
session/idempotency/uncertainty rules remain independent and binding.

## Disposition

The condition “no genuine Dzen tool denial exists” is false. Do not remove the
guard and run the blocked article-check outcome through another surface.
The separate question whether task1002's registered-adapter inventory is within
that denial's scope remains UNRESOLVED by this evidence; no probe was attempted.
No code deletion, hardcoded permission, new admission API or live check is
authorized by this audit. Review the original scope and explicit existing owner
diagnostic contract before proposing a narrowly bounded application correction.
Independent read-only review completed: no P1/P2 provenance inaccuracies in the
audit or corrected operational disposition; primary transcript result checked.
Focused behavior tests were NOT run because no
behavior changed. No deployment or UAT is claimed.
