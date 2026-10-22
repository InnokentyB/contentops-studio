# Offline Settings verification

Run from repository root on Tower. All application logic runs in temporary Linux amd64 containers. Synthetic project only; no production credentials or providers. Resource limits and browser sandbox are declared in Compose. No published ports or persistent services/volumes.

Prerequisites: retained reviewed dependency image `planner-owner-manual-confirmation:20261020` (project Docker build dependencies) and sandbox browser image `planner-x-native-sandbox-fixture:20261017-v1`; reviewed browser seccomp profile at `ops/x-native-extension/seccomp_profile.json`. Source is mounted read-only; only result files are writable. These images provide dependencies, while the fixture bundles the current checkout's real Settings page.

```sh
mkdir -p /tmp/contentops-channel-list-results
docker compose -f ops/channel-list-tests/compose.yaml config --quiet
docker compose -f ops/channel-list-tests/compose.yaml run --rm build-fixture
docker compose -f ops/channel-list-tests/compose.yaml run --rm browser
```

Build: `build-fixture` bundles current Settings and theme. Start/check: `browser` serves that fixture inside its own network-isolated container, runs assertions and exits. Health: exit code zero and JSON `pass:true`. Logs: standard output; screenshots/results in `/tmp/contentops-channel-list-results`. Temporary containers remove themselves. If interrupted, stop only this stack with `docker compose -f ops/channel-list-tests/compose.yaml down` (no volume removal). No database, publisher or scheduler starts.
