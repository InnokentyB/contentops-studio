# Exact October 8 review recovery

`ba_recover_oct08_content_review` is discoverable through the editor MCP profile.
The authenticated token still determines project and actor; project-owner membership
is checked by the canonical recovery transaction. Non-owner editors cannot recover.
Generic `ba_recover_content_review` remains owner-only and undiscoverable to editor.

Inputs: `projectId: 10`, `taskId: 1040` or `1089`, `actorId` (replaced by token identity
on remote MCP), a stable `idempotencyKey`, and an owner evidence description.

Exact packages are pinned to task1040/revision4/WI1605 and task1089/revision2/WI1614,
including current body SHA-256. Changed bodies or revisions fail closed.
Recovery never approves or publishes. Historical approval decisions and result payloads
remain immutable. Use the returned replacement work item, claim it for the current
revision, submit a fresh review and approve only its returned result version. Refresh
dependent visual readiness before owner release. Never approve the stale work item.

After deployment, refresh the editor MCP connection/tool inventory. If absent, verify
the `/mcp/editor` connection and its project10 token binding, not a different project.
Rollback: revert the tool registration and editor allowlist entry; recovery audit history
and replacement work items must not be deleted. No database migration is required.
