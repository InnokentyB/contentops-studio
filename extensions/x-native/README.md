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
The public identity also exposes `bundleSha256`. Ops must compare it with the
independent reviewed build receipt and pass that digest explicitly to owner
pairing, enrollment and challenge controls. A client self-report alone is not
approval of a build. Missing/legacy build bindings fail closed.

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

Every authority boundary re-reads the allowlisted packaged bytes and integrity
manifest. A changed bundle gets a different non-exportable key slot and needs
fresh signed no-send pairing/owner enrollment. Old keys and permanent journals
are preserved, not reset or automatically enrolled. Finish or quarantine
in-flight work before updating; revocation is audited. After a quiescent update,
reload the extension itself (never edit its loaded directory in place), then
save your draft and reload the X editor tab: the content reader must match the
built reader identity before a click can be sent. History/readback use a separate
temporary profile tab; the original editor is never navigated or replaced.

This is software self-measurement, not remote/device attestation. A deliberately
modified extension, compromised browser/OS or cloned profile/key can lie; those
remain the approved trusted-executor residual risks. Do not treat this mechanism
as proof against malicious code replacement on the enrolled host.
Disk-byte measurement also does not prove which background modules were already
loaded before an in-place edit; the quiescent reload discipline is mandatory.

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
