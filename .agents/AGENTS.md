# Strategic Planner Environment Constraints

The repository-wide contract in `../AGENTS.md` and its linked portfolio quality
standard apply. The former `.agents/rules/code-quality-defaults.md` does not exist;
do not invent its contents.

- **Reusable production behavior:** Follow `../AGENTS.md` section "Reusable
  production behavior — no publication-specific code". Concrete business task,
  actor/account/channel/revision/release/hash/date bindings are validated data
  for common provider adapters and lifecycles, not new functions/modules/routes,
  MCP commands, schema literals or dispatch allowlists. Preserve all authorization,
  tenant, exact-package, audit and idempotency checks in data-driven form.
- **Classification:** Do not confuse protocol numbers or isolated fixtures,
  seeds, historical migrations and immutable audit records with executable
  production special cases. No broad numeric ban or blanket debt exemption.

- **Execution Context:** The strategic planner tool runs inside a Docker container with the root directory `/app` and does not have access to the local host's project files.
- **Content Files & Paths:** Because of this container isolation, referencing local file paths in `content_files` will hang/timeout. Always pass inline content/bodies in `assets` OR specify HTTP/HTTPS URLs (e.g. Supabase, S3, GitHub raw links) in `url` / `target_url`, which are automatically pre-fetched by the planner.
