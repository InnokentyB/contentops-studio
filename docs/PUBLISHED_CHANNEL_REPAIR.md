# Published channel repair

Use this owner-only workflow only when an already published task, its publication fact, and its existing metric snapshots point to the wrong legacy channel.

1. Call `ba_preview_published_channel_repair` with the exact current task, fact, public URL, snapshot IDs, and snapshot channel IDs.
2. Review every entry in `changes`, the `affected_ids`, `target_contract`, and `unchanged_assertions`.
3. Call `ba_apply_published_channel_repair` with the same guards, the returned `preview_hash`, an explicit reason, and a unique idempotency key.
4. Keep the returned `audit_id`. Verify `authoritative_readback` and `dzen_metric_collection_eligible` before collecting metrics.

The apply operation updates one task, its existing publication fact, and the explicitly guarded snapshot rows in one transaction. It does not create a publication fact, snapshot, delivery attempt, work item, visual record, outbox event, or external publication. A stale guard or preview hash aborts the transaction. Replaying the same request with the same idempotency key returns the recorded result without another write.

For a read-only operator preview against the configured database, run:

```sh
npx ts-node src/scripts/preview_published_channel_repair.ts \
  --project 10 \
  --actor user:2 \
  --task 753 \
  --expected-channel 139 \
  --target-channel 116 \
  --expected-fact 175 \
  --expected-public-url https://dzen.ru/a/aoAqgw3vfB2MGNqS \
  --expected-snapshots 349:139,350:139
```

The script has no apply mode. Production apply remains available only through the owner MCP capability.
