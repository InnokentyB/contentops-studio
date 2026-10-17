# X native extension: isolated browser fixture (tower only)

This is a synthetic no-send test, not a publisher, live account login, deployment,
enrollment or production UAT. Use a secret-free source copy containing a separately
verified built `dist/x-native-extension`; never mount a personal Chrome profile,
production environment, Docker socket, host root or restored data.

## Reviewed runtime

Linux amd64; Node from the locally cached image; Playwright **1.63.0**;
`/opt/playwright/chromium-1243/chrome-linux64/chrome` (Chromium153). Alternative
Puppeteer cache `/opt/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome`
is inventoried, not used as a sandbox fallback. Reviewed base image config ID:
`sha256:06f5297407da27a070a6d1a2deec79003a2977b8aa037a64e2132116f97dc227`.
The local tag is not a portable registry digest: stop if it resolves differently;
re-review the replacement, do not silently pull another image.

Runtime is non-root1000, read-only, capabilities dropped except `SYS_CHROOT`, no-new-privileges,
bounded memory/CPU/PIDs/logs/tmpfs, no network namespace egress or published ports.
Chromium uses **chromiumSandbox:true**. The exact reviewed seccomp profile enables
user namespaces and the narrow `SYS_CHROOT` capability supports Chromium's chroot
boundary. No privileged, unconfined, additional capability,
SUID or `--no-sandbox` workaround is authorized. The host must support sandboxed
unprivileged user namespaces under its reviewed AppArmor/seccomp policy.

## Build, run, inspect, stop

On tower, in the secret-free source copy (editing/transfers may happen on host;
all application commands below execute in containers):

```sh
docker image inspect tower-browser-checks:20261016 --format '{{.Id}} {{.Config.User}}'
mkdir -p .impeccable/review
docker compose -f ops/x-native-extension/compose.yaml build --pull=false browser-fixture
docker compose -f ops/x-native-extension/compose.yaml run --rm browser-fixture
docker compose -f ops/x-native-extension/compose.yaml ps -a
docker compose -f ops/x-native-extension/compose.yaml logs --tail 50 browser-fixture
docker compose -f ops/x-native-extension/compose.yaml stop
docker compose -f ops/x-native-extension/compose.yaml down
```

Health is the scenario's TAP/exit code, not container start or package build.
Run is temporary and removed by `--rm`; use `stop` for an interrupted run. No
volumes are created and no `down -v`/prune is needed. Existing backup/production
stacks are untouched. Remove only these named synthetic containers on rollback.

The test derives a temporary fixture copy: only its Planner API origin,
host permission and connect-src become loopback HTTP. The distributable and
production source remain unchanged. This mock is a real in-container HTTP server,
so the service-worker's actual `Origin: chrome-extension://…` is asserted;
service-worker fetches do not depend on Playwright request interception. X pages
are synthetic intercepted DOM; external network is unavailable. Unexpected traffic
is blocked/counted. No provider submission API exists in this fixture.

Assertions cover two distinct packages/accounts, no-send inspection, signed
pairing, wrong account, untouched unknown draft, expired and over15s native permit,
one-only local invocation after response loss, installation and permanent fence
across browser restart. The only invocation is a synthetic throwing callback;
expired native controls must never click. Screenshots are produced together at
720px and360px, with overflow checks, under `/evidence/desktop.png` and
`/evidence/mobile.png` (the explicit `.impeccable/review` mount). They contain
synthetic values only. Transfer exactly those files after successful execution;
do not fabricate screenshots if browser launch fails.

## Resolved fixture configuration blocker — 2026-10-17

A strict launch probe using this image/user/security boundary failed with:
`Chromium sandboxing failed` / `zygote_host_impl_linux.cc:129 No usable sandbox!`.
Host readback: `kernel.unprivileged_userns_clone=1`,
`kernel.apparmor_restrict_unprivileged_userns=1`. Container readback:
`unshare --user --map-root-user true` → `Operation not permitted`,
`NoNewPrivs:1`, `Seccomp:2`; Chromium helper is0755/non-setuid.
These facts do not isolate AppArmor from seccomp as the sole cause.

This was an incomplete fixture configuration, not evidence that tower could not
run a protected browser. The existing reviewed runtime at
`/home/innokenty/migration-evidence/tower-infra-20261016/container-browser/`
already passed four Puppeteer/Playwright headless/headful checks. Its exact
`seccomp_profile.json` (SHA256
`cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`),
`cap_add: [SYS_CHROOT]`, 512MiB shm and core0 were adopted here without host-policy
changes or `SYS_ADMIN`. Independent review approved both proposed and applied
delta. The profile remains default-deny; its conditional `CAP_SYS_ADMIN` rules
are inactive because that capability is not added.

The actual extension fixture now **PASSES** with Chromium153.0.8010.12;
`chrome://sandbox` confirms namespace and seccomp sandbox enabled. Actual worker
Origin is asserted by the loopback server, signed pairing covers two packages,
and native negative/once-only/restart assertions pass. A Node WHATWG URL bug in
the fixture (`chrome-extension:` origin serialized as `null`) was corrected with
explicit validated protocol/extension ID, not by weakening the production route.
Desktop/mobile captures are `.impeccable/review/{desktop,mobile}.png` and the
durable synthetic receipt is `.impeccable/review/x-native-browser.json`.
Set `X_BROWSER_CAPTURE_SCREENSHOTS=0` for functional reruns without another visual
round. No global userns/AppArmor/seccomp policy was changed. Real-account owner
UAT and production endpoint pairing remain separate, unperformed steps.
