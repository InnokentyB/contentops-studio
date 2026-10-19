# Shared VK adapter: synthetic container checks

This recipe reuses the reviewed Tower browser and Planner dependency images. It starts no consumer, scheduler, app server or provider session. It contains no environment file or production credential. Network is disabled during build and tests; the only browser fixture is local HTML. Temporary containers use `--rm`.

Before building, verify the shared runtime evidence under `/home/innokenty/migration-evidence/tower-infra-20261016/container-browser`. Its seccomp profile is the official pinned Playwright profile. Do not replace it with unconfined seccomp or disable sandbox. Expected browser image ID: `sha256:06f5297407da27a070a6d1a2deec79003a2977b8aa037a64e2132116f97dc227`. The dependency image must pass both package-lock comparisons; a mismatch blocks the build and requires rebuilding dependencies through the reviewed Planner quality recipe.

From a source-only checkout on Tower:

```sh
docker compose -f ops/vk-container/compose.yaml build
docker compose -f ops/vk-container/compose.yaml run --rm --no-deps verify npm run build:backend
```

For compile and tests in the same disposable filesystem:

```sh
docker compose -f ops/vk-container/compose.yaml run --rm --no-deps verify sh -c 'npm run build:backend && node --test tests/tdpd/vk-shared-browser.test.cjs dist/tests/vk_connector_shared_data.test.js dist/tests/vk_shared_execution.test.js dist/tests/vk_shared_consumer_readiness.test.js'
```

The `verify` service has a writable disposable root for compilation, still runs as UID1000, drops all capabilities except namespace sandbox SYS_CHROOT, has bounded memory/CPU/PIDs/logs and no host mounts/ports/network. The default `check` service has a read-only root. Neither service mounts a profile or private config. `APP_BROWSER_EXECUTABLE_PATH` selects the existing container executable and grants no application or site permission. The shared launch helper always enables Chromium sandboxing. Xvfb can be used for local headed fixture checks; it must not expose a TCP listener.

No persistent stack is needed. Inspect `docker compose -f ops/vk-container/compose.yaml ps --all`; stop remaining services with `stop` or `down`. Never use `down -v` or prune. Synthetic DB tests require their separately reviewed isolated network/fixture; this network-none recipe does not connect to any database. Browser fixtures and mocked control tests do not certify live VK selectors, login, community rights or publishing.
