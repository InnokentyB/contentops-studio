# Threads task 1046 exact release

Task 1046 has two governed Publisher MCP operations:

- `ba_release_threads_task1046_api` performs the owner-only audited release. It
  binds project 10, channel 138, accepted revision 4, decision 270/v1, managed
  approved asset 132, the exact body/asset hashes, schedule, workspace manifest
  and the verified `@innokentybo` Threads identity. It scans bounded owned-post
  history and refuses facts, delivery attempts, uncertain results, duplicates or
  incomplete history. It never sends.
- `ba_publish_threads_task1046` provides dry-run payload inspection and a separate
  one-shot task-native image API send. Live mode requires an idempotency key and
  the exact release proof. The provider receives the same text and managed image
  URL reported by dry-run. An uncertain provider result keeps the task frozen in
  `publishing`, disables automatic retry and records no publication fact.

Deployment of these tools does not release or publish the task. Owner release and
the later live call remain separate explicit actions. Task 1043 and publication
fact 441 are outside this route and must not be changed by either operation.
