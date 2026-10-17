# ContentOps X native extension

This is the shared native route, not the older key-only prerequisite. Build the
explicit package with `node scripts/build_x_native_extension.mjs --output <new-directory>`
inside the reviewed tower container. The output contains the pilot manifest,
required runtime assets and deterministic integrity receipt. Do not install a
partially copied source directory or ship the old source `manifest.json`.

Installation, public-key registration, no-send pairing and owner release are
separate events. Building or loading an extension never grants publication
authority. Only an operator-approved, reviewed build may be installed. The
extension ID must be registered against the owner/project/channel installation.

Open exactly one X tab in the focused browser window. The profile and already
open accepted draft must match the Planner package; unknown drafts are never
replaced. Paste only the eight public package fields: `projectId`, `taskId`,
`channelId`, `revision`, `bodySha256`, `account`, `profileUrl`, `scheduleAt`.
Never paste tokens, cookies, leases or authorization headers.

Use **Проверить без отправки** for the no-send check. A pairing code is not a
publication release. Without a code, the local check also needs the accepted
text and does not establish server enrollment. Public installation details
contain only the public key and IDs; the non-exportable private key remains
in extension IndexedDB.

Sending is disabled by default. A fresh exact-package Planner readiness check
and deliberate checkbox are required before **Опубликовать один раз**. The local
readiness window is at most 30 seconds; the server's signed pre-submit permit
is separately capped at 15 seconds. Server authorization, tenant, identity,
revision, text hash, lease and once-only controls remain mandatory.

Lost responses, browser crashes and uncertain results allow only same-attempt
reconciliation. **Проверить результат начатой попытки** cannot send. Never clear
the journal or reload a fresh profile to retry. Closing the popup does not cancel
an operation already started in the service worker. Do not assume success until
Planner has a confirmed provider identity/publication fact.

Updating or uninstalling a key-bearing installation requires an operator
reconciliation/revocation plan. No automated enrollment, publishing on startup,
paid API, alternate browser route or engineering send is part of this package.
