# Local key compatibility build (NOT a publishing executor)

Approval and remaining gates: `docs/tdpd/x1113-native-002-delivery.md`.
Version 0.0.1 deliberately has no X/Planner permissions or network access.
No enrollment, arbitrary-message signer, provider reader or click is implemented.
Do not install in an existing personal profile as an operational connector.

Automated no-send check:

```
node --test --test-concurrency=1 tests/tdpd/x1113-native-key.test.mjs tests/tdpd/x1113-native-browser.test.mjs
```

Uses the repository Playwright dependency and an installed Playwright Chromium.
Creates a new temporary profile, blocks HTTP(S) page routes, loads only the local
extension page and closes both browser instances. It never selects an existing
browser or profile. The isolated profile is retained for local debugging; its
only application state is a synthetic, unpaired key, no provider credentials.

Owner no-send UAT after independent review: in a fresh disposable test profile,
load this directory as an unpacked extension, open its options page and run the
local check. Close and reopen that test browser, run again and compare the public
fingerprint. Expected: same fingerprint, persisted=true, privateKeyExtractable=false,
enrolled=false, publicationAuthorized=false. No login or provider tab required.
Remove only this test extension/profile after UAT; do not clear any real profile.

This proves WebCrypto/IndexedDB compatibility, not OS key isolation, provider
identity, server admission or permission to publish. A compromised OS or copied
browser-profile directory remains outside this protection.
