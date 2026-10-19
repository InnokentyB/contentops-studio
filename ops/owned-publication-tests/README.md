# Owned-publication independent adapter: offline native fixture

Run only in a secret-free Tower source copy, with compiled `dist` produced in a
Tower Docker build. No Mac Docker, host Node/browser, provider session, production
database, public listener, scheduler or publication consumer is involved.

The tests register a separate fixed **test-only** child executable from
`tests/fixtures/owned-publication-native/child.cjs`. Its real Chromium browser
uses the production generic Dzen protocol engine. Fixed native URLs are
intercepted inside that isolated child and fulfilled by an actual container-local
HTTP fixture. The production registry has no import, environment switch, endpoint,
permission callback or transport selection for this composition root. Production
registration remains `OWNED_DZEN_ACTION_SCOPE_UNRESOLVED` before credentials or
child startup. GREEN is offline engineering evidence, not provider permission,
session readiness, deployment approval or UAT.

## Container and sandbox

Reviewed cached base image `tower-browser-checks:20261016` must resolve to config
ID `sha256:06f5297407da27a070a6d1a2deec79003a2977b8aa037a64e2132116f97dc227`.
This is a local image identity, not a registry manifest digest. Stop on drift;
do not pull or substitute a new browser image. Playwright1.63.0 uses regular
Chromium153.0.8010.12 through its installed `chromium.executablePath()`, with
`chromiumSandbox:true`.

UID1000; root/source read-only; `cap_drop: [ALL]` with **no capability additions**;
no-new-privileges; default-deny seccomp; network namespace `none` with loopback
only;2CPU/2GiB/256PIDs;512MiB shm; bounded tmpfs; core0; Docker logs10MiB×2.
No Docker socket, host root, host networking or published ports are mounted.

The initial X-reviewed seccomp profile (`cc3e61...`) failed this stricter ALL
configuration at Chromium `sys_chroot("/proc/self/fdinfo/")`, then zygote SIGABRT.
Its chroot syscall allowance was conditional on outer CAP_SYS_CHROOT. Independently
reviewed repair changes **only that syscall rule's `includes` to `{}`**; it adds
no capability. Candidate SHA256:
`f922c7c9bfc1ece0b72b244e56dc85756ded002c837fb46054cfd8b275c74b6b`.
Kernel capability checks still apply; Chromium performs chroot in its own user
namespace. Actual probe confirms outer CapEff/CapBnd0, NoNewPrivs1, Seccomp2 and
`chrome://sandbox`: namespace, PID namespace, network namespace and Seccomp-BPF
all enabled. No host/AppArmor/sysctl policy changed. The profile delta was
reviewed and authorized for this bounded offline fixture before execution.

## Build prerequisite and run

Use the repository's Docker build/typecheck for release evidence. A bounded
transpile-only container was used for early native RED/GREEN iterations; that is
not substituted for the integrated backend build. Mount exactly the corresponding
compiled `dist` in the secret-free source copy before running:

```sh
docker image inspect tower-browser-checks:20261016 --format '{{.Id}}'
docker compose -f ops/owned-publication-tests/compose.yaml run --rm native-tests node tests/fixtures/owned-publication-native/sandbox-probe.cjs
docker compose -f ops/owned-publication-tests/compose.yaml run --rm native-tests
docker compose -f ops/owned-publication-tests/compose.yaml ps -a
docker compose -f ops/owned-publication-tests/compose.yaml stop
docker compose -f ops/owned-publication-tests/compose.yaml down
```

No volume exists to delete. Do not use `down -v`, prune, default external networks,
or production data. Health is scenario TAP plus exit status, never process start.

Native scenarios exercise two unrelated accounts/packages; complete published
and draft inventory; actual local create/edit/file-upload/final Submit; strict
receipt; a new-process same-object readback; and inventory detecting the result.
Failures cover mutation denial, active-browser cancellation, node SIGKILL after
browser custody, discarded stderr, unsupported primary proof and lost post-Submit
cover verification followed by same-attempt readback with no second Submit.
Tests inspect `/proc` to assert no live Chromium remains after success or failure.

Browser PID/start-time custody is private IPC, validated against direct child
ancestry and expected process group before acknowledgement. Timeout/cancellation
signals both adapter and retained browser resources concurrently; SIGKILL and
resource cleanup share the bounded stop deadline. No PID, browser handle, endpoint,
raw payload, cookie or secret is returned to the Planner operator. Every ordinary
publication uses package data through the same code; fixture business IDs never
enter production authority.

One server-generated `OwnedPublicationBudget` (absolute work deadline + abort
signal) spans authorization, inventory, publish/readback and their fences; it is
never a public request field. Service work normally ends within230s, reserving
up to10s for cleanup. The adapter forwards the same residual deadline through
private IPC, checks expiry before secrets/start/Submit and joins in-flight fence
callbacks before returning. Session configuration reads use a bounded transaction
with checks before and after the query. OAR04 proves inventory cannot reset the
budget for a later publish and cancellation waits for an already-running fence.

OAR06 kills the adapter during Chromium launch before resource acknowledgement,
with Chromium deliberately paused. Cleanup locates only an exact NUL-delimited
server nonce argument, same UID, permitted process group and revalidated PID
start time. The bounded container `/proc` scan and signals share the cleanup
deadline; the actual test requires no live Chromium within10s and zero native
requests. This marker carries correlation only, never business or action authority.

The actual native UI initiates each create/final Submit POST. A context-wide
interceptor consumes its sole request permission before continuing that exact
fixed native URL/method/body. The child streams that same request with only its
private cookie/content-type headers, no redirect/retry/fallback, request≤64KiB,
response≤2MB actual bytes and a15s/global residual deadline. Reader/body cleanup
runs on all outcomes. The browser receives only the bounded validated JSON;
unsupported, excessive or redirected responses are uncertain. OAR05/OAR07 prove
a malicious page cannot issue a second Submit/create request. OAR08/OAR09 prove
one actual HTTP request on excessive/redirected responses; a post-Submit failure
recovers only by new-process same-object readback, with no second Submit.

OAR10 changes the server-persisted published body while retaining the previously
correct editor DOM. A mandatory fresh native reload before the final primary
proof rejects that stale-DOM false receipt. Successful local flows also verify
the original UI JSON body/content-type reached create/Submit unchanged, including
the exact bound object in the final request.

OAR11 changes the persisted provider body during the awaited beforeSubmit fence.
After ACK, a dedicated verification phase blocks every write, including publish,
while the same native object is reloaded and its accepted body/title/cover are
verified. The dialog and unique connected final button are reacquired; the single
Submit request is armed only immediately before clicking. A changed body leaves
the original claim/object binding held and produces zero outgoing publish POSTs.

OAR12 holds an already-admitted native autosave response so its server commit
can otherwise race a fresh reload. Every admitted editing write is registered
before continuation and leaves the ledger only on requestfinished. Failure or
non-success response latches the whole phase closed. After the ACK cutoff, a
bounded15s/global-deadline drain precedes fresh reload/proof; unfinished/failed
writes cannot authorize a Submit, and phase failure blocks every later request.
The fixture proves the delayed commit is observed with zero publish requests.
