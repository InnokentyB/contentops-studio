#!/bin/sh
# Host orchestration only. All application logic runs in Docker.
set -eu
cd "$(dirname "$0")/../.."
job_log=$(mktemp /tmp/planner-cache-restart.XXXXXX)
docker compose -f ops/egress/compose.yaml run --rm -e EGRESS_RESTART_ONLY=1 postgres-checks >"$job_log" 2>&1 &
job_pid=$!
for step in $(seq 1 120); do
  if grep -q RESTART_REDIS_NOW "$job_log"; then
    docker compose -f ops/egress/compose.yaml up -d --wait redis
    break
  fi
  if ! kill -0 "$job_pid" 2>/dev/null; then break; fi
  sleep 1
done
result=0
wait "$job_pid" || result=$?
cat "$job_log"
rm -f "$job_log"
exit "$result"
