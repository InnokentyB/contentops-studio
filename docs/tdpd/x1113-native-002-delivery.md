# X1113-NATIVE-002 delivery record

## Approval

APPROVED LOCK/QAR/ARCH/RISK on 2026-10-15 by direct human response
`01a140ef-8952-7333-8798-c11963149ee3` in Portfolio OS thread
`01a0df21-ea6c-71f2-9c1b-40393de0e105`: “Утверждаю X1113-NATIVE-002”.
Source read directly in the owning thread, not inferred from a delegation.
Exact approved baseline: commit `1a42c2c8aca6f8fcc9cb28ff57a4000979d4b504`,
`docs/tdpd/p10-personal1113-1114-1110-release-proposal.md`, section
X1113-NATIVE-002. Approval permits bounded implementation, no-send UAT and then
the existing exact1113 operational package after all gates, not a development send.

## First delivery slice: key compatibility prerequisite

Boundary: isolated test profile and local extension origin, no existing personal
profile, provider tab, credential, network call or production state mutation.
The 0.0.1 build has no host permissions, content scripts, background runtime,
external messaging or network access. It CANNOT execute or enroll and must not be
described as the production hook. Private P-256 key is generated non-exportable,
structured-cloned into extension-origin IndexedDB and checked after close/reopen.
Only a fixed local diagnostic message is signed; no caller signing endpoint.
Public fingerprint is not provider/account proof.

Scenarios: X-NATIVE-01 least-privilege/no-network manifest; X-NATIVE-02 private
export denied, valid fixed challenge verifies, altered challenge fails;
X-NATIVE-03 actual Chromium extension-origin persistent reopen and page reload
retain fingerprint; concurrent checks retain one key. No mocked persistence claim.

RED: 01/02 fail for absent compatibility implementation before source added.
GREEN: 01/02 PASS (Node WebCrypto); 03 PASS in actual isolated Chromium extension
origin (parallel access, DB close/reopen, page reload). Backend build PASS;
quality gate PASS at baseline77/min77, not a >=90 claim. Full browser close/reopen
also retains the same non-exportable key: all3 tests PASS on 2026-10-15.
CI and independent review remain unverified until reported on the exact commit.
No-send owner UAT remains separate from the isolated automated browser test.

Remaining before production: audited pairing/revocation, server nonce atomicity,
trusted native account/editor/duplicate readback, one-shot click journal,
signed native result/fact, historical-fence read-only recovery, isolated DB race
tests, independent review, deployment and explicit no-send owner UAT. Existing
PR154 remains Draft with unresolved P1s; no raw MCP bypass may be enabled.

Rollback of this slice: remove only this unpaired test extension from the test
profile. There are no Planner records or provider attempts to clear. Do not delete
any existing publication, work-item, lease, attempt, release or fact history.
