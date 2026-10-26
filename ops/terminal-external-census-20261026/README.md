# Local external exec census, version 1

Ownership was agreed with the main engineer in `/tmp/terminal-external-census-agreement-20261026.txt`. These three files are separate from the main service and producer. The main engineer owns integration and authority; this module never registers a source, writes a ledger, calls a provider or grants a send.

`classifyExternalExec(frame, targetBinding)` parses the original JavaScript `custom_tool_call` named `exec`, with its actually absent namespace preserved as **null**. It does not execute source. Supported effects are static awaited known Planner reads, awaited static `Promise.all`/`allSettled` groups, constant control output, and an exactly bound original `ba_start_browser_submission`. Unknown tools, provider-capable methods, shell/network calls, detached work, dynamic selectors/callbacks, malformed source and unknown execution wrappers return `DENIED`.

The result contains only `callId`, raw-input SHA256, observed status, classification, effect scope, static reason code and matched native call IDs. No input code, argument value, URL, token or lease is returned. A supported classification is **not authority**, native queue-drain proof, provider absence or authentication.

## Actual source contract

- Frame: `callId`, declaration `ordinal`, `namespace:null`, `toolName:'exec'`, private local `rawInput`, actual `completion:{callId,status,ordinal}`, and `nativeBindings` for this exact frame. Completion must genuinely be observed, never inferred solely from output presence.
- Each native binding: actual MCP `callId`, `ordinal`, `server`, `tool`, terminal `status:'completed'`, `argumentsSha256`, optional actual `parentCallId`. They must lie inside the frame. Duplicate, failed, unmatched and extra bindings refuse. Do not manufacture a parent ID or namespace. The producer must establish actual provenance/association from native records, not just copy a method spelling.
- The known callable form is `tools.mcp__SERVER__METHOD(...)`, matched against the Owner-established Planner service and actual native metadata/argument digest. Server characters are normalized to SDK identifier characters. An outer null namespace remains null. A misleading spelling without its genuine native binding refuses.
- Trusted target binding: `plannerServer`, positive `projectId/taskId/attemptId/workItemId`. Start additionally requires current original `keySha256`, `leaseSha256`, `snapshotSha256`, optionally expected `actorId`. These are validated data from the Owner control/current state; do not accept arbitrary caller-selected transport or identity as authenticated context.
- Start native binding additionally carries the actual parsed result `resultAttemptId`, `resultSubmissionPermitted:false`, `resultRetryAllowed:false`. This is checked alongside exact original work/key/lease/package, not used as a blanket permission flag. No other mutation is admitted by version 1.

`canonicalArgumentsSha256(plainJson)` computes recursively sorted JSON SHA256 without invoking accessors. Use the **same** function for actual native arguments and source-literal arguments. `targetBinding.snapshotSha256` uses this canonical projection of the already validated accepted snapshot; it is distinct from any legacy field-order-dependent snapshot digest. An integration adapter must explicitly compute the corresponding expected projection rather than weakening comparison or reusing a different digest by name.

## Verification and operation

RED was recorded before implementation. All **16** synthetic/adversarial cases pass in the existing reviewed linux/amd64 image; no dependency install, image build, network or database is required:

```sh
docker run --rm --network none --user 1000:1000 --read-only \
  --memory 512m --cpus 0.5 --pids-limit 64 --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --log-opt max-size=1m --log-opt max-file=2 \
  -e NODE_PATH=/opt/planner/node_modules \
  -v "$PWD/ops/terminal-external-census-20261026:/review:ro" \
  sha256:056cfb24c6683058f883ba948813aec36d1f622832fa1d213963ebd233c448a3 \
  node --test /review/census.test.cjs
```

CommonJS syntax/load is checked by the test run; there is no compilation output. The temporary container is removed on exit; no service, port or volume is created. Stdout is synthetic test output, not original data. Production quality/build checks belong to the reviewed integration candidate after the main engineer vendors the component.

For an actual Mac check, package this exact module with the already reviewed TypeScript dependency and call it only inside the local producer reading the original archive. Keep raw arguments local and pass only the bounded result plus independently verified code/run/control provenance. The main producer must verify whole-turn declaration/completion completeness and ensure **every** external call is represented exactly once. This helper cannot prove completeness from a supplied subset or authenticate editable archive files by itself. No real Mac conformance result is claimed here; all 26 actual exec calls still need that run. Any denial or unresolved association remains a denial, not an excuse to omit a call or create a new publication attempt.
