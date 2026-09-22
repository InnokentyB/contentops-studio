# Connect an MCP agent

ContentOps Studio exposes project-scoped MCP endpoints for Claude, Codex, and other Streamable HTTP clients. Access is issued inside the product; adding a person or device does not require a Railway redeploy.

## Before you start

- The MCP gateway must be online.
- The person receiving access must already be a member of the target project.
- Only a project owner can issue or revoke MCP access.
- Use a separate token for every person, device, and capability profile. Never share one token between operators.

The hosted product gateway is:

```text
https://planner-mcp-production.up.railway.app
```

Self-hosted installations use their own `MCP_REMOTE_URL`.

## Choose a capability profile

| Profile | Endpoint | Intended work |
| --- | --- | --- |
| Strategist | `/mcp/strategist` | Initiatives, priorities, themes, and strategic constraints; no publication or deployment-owner model keys |
| Planner | `/mcp/planner` | Plans, schedule, initiatives, materialization, readiness, and controlled publication |
| Writer | `/mcp/writer` | Assigned copy work and exact publication-content revisions |
| Chief editor | `/mcp/editor` | Revision-bound editorial review and approval decisions |
| Art director | `/mcp/art-director` | Art direction, durable assets, visual QA, and visual readiness |
| Publisher | `/mcp/publisher` | Readiness-gated delivery and confirmed publication facts; no raw direct-publish tool |
| Growth analyst | `/mcp/growth-analyst` | Publication metrics, checkpoints, and campaign rollups |

Profiles are enforced by the server and bound to one project member and project. Operational roles never inherit platform-owner authority.

### Content-review work items

The Chief editor profile can claim only an `available` work item with `kind=content_review` and `assignee_role=content_reviewer` through `ba_claim_content_review`. Supply the current work-item `result_version` and publication `content_revision`; the response contains a reviewer-owned lease valid for 30 minutes. Submit the review with `ba_submit_content_review`, the same expected versions, that lease token, a nonempty summary, and an `approve` or `revise` recommendation. Submission changes the work item to `waiting_approval` and returns its new result version; it does not alter the copy or accept it. Only then may `ba_decide_approval` make the revision-bound approval decision using that returned version. A stale version, expired or foreign lease, or another work-item kind is rejected. Do not use the writer's generic claim/complete tools for review work.

### Owner-gated publication controls

The Planner profile exposes `ba_require_c20_publication_visuals` for one atomic, owner-authorized project-10 repair of exactly tasks 968, 969 and 971–974. Supply each task's current revision, accepted revision, status, visual state and ISO schedule. The transaction changes only `visual_mode` from `auto_assess` to `required`, audits every task, and rejects a publication fact, selected asset, or current `NO_VISUAL_NEEDED` decision. It does not accept text, approve art, or publish.

For the later rev-3 #971 state, use `ba_require_task971_publication_visual` instead: it is an owner-only CAS limited to project 10/`analystcraft-2`, channel 111, task 971, accepted revision 3, feed placement and approved selected asset 76. Supply the current status, visual state and ISO schedule; it changes only `visual_mode` and keeps `approval_required`. Do not use it as publication approval or send authorization.

The Publisher profile exposes `ba_release_approved_telegram_task` for an authenticated project owner after exact-copy approval. Supply the current task/channel, accepted and content revisions, visual mode/state/asset, ISO schedule, SHA-256 of the canonical draft body, approval reference and a fresh idempotency key. Successful release changes only `approval_required` to `owner_released` and records an audit event. This mode is excluded from scheduler discovery and generic delivery; only a separate explicit `ba_publish_publication_task` dry-run/live call can consume it. That call rechecks the audit proof and exact body. The release is not a send, and an accepted revision alone is not owner approval. Existing Codex sessions may need MCP capability refresh before new tools become callable.

For the one approved Dzen feed task #958, `ba_release_approved_dzen_task958` binds project 10/channel 116/accepted revision 1/body SHA-256/active NO_VISUAL_NEEDED decision #147 and records the owner approval reference without sending. Then `ba_verify_dzen_task958_connector` checks the authenticated channel editor and records a 15-minute proof for this task only; it does not enable the Dzen channel globally. `ba_publish_publication_task` routes only this exact task to the Dzen adapter. Dry-run must report `route_executable=true` before one live call with a stable idempotency key. An uncertain browser result freezes the task in `publishing` for manual reconciliation and must never be retried through the API. Only a provider-confirmed public Dzen URL creates the canonical publication fact.

## Deploy the complete workspace

For a new external user, use the complete workspace flow:

1. Add the user as a member of the project and ask them to sign in once.
2. Open **Project settings → MCP → Personal access** as a project owner.
3. Select that project member, add a device-specific label and expiry, then select **Deploy 7 roles**.
4. Copy both one-time blocks: the seven-connector configuration and the agent bootstrap prompt.
5. Add the connectors to the user's agent client. Give the bootstrap prompt to that agent. If the host can create persistent chats, it creates the seven named role chats; otherwise it should return seven copyable chat cards.

The bundle is created atomically: either all seven hashed credentials are stored or none are. Plaintext tokens are returned only in this response and must not be pasted into chat messages or committed to a repository. Accidental duplicate issuance is rejected. Use **Rotate 7 roles** to revoke the previous bundle and create its replacement in one transaction, or **Revoke complete bundle** to disable all seven credentials together.

## Issue access

1. Sign in as the project owner.
2. Open **Project settings → MCP**.
3. Confirm that the MCP status is **Online**.
4. Under **Personal access**, select a project member and capability profile. Use this path when only one role is needed.
5. Add a device-specific label such as `Claude on work laptop`.
6. Select **Create access** and copy the token immediately. The plaintext token is shown once; only its hash is stored afterward.

## Configure Claude or another client

In Claude, open **Settings → Connectors → Add custom connector**. Use the endpoint for the selected profile and send the issued token as a Bearer authorization header.

```json
{
  "mcpServers": {
    "contentops-studio-writer": {
      "type": "http",
      "url": "https://planner-mcp-production.up.railway.app/mcp/writer",
      "headers": {
        "Authorization": "Bearer <TOKEN_SHOWN_ONCE_IN_SETTINGS>"
      }
    }
  }
}
```

The **MCP** settings screen can copy the matching safe configuration template. Replace only the token placeholder. Do not commit the completed configuration or paste the token into a shared chat.

## Start the first chat

Send this as the first message after the connector appears:

> Read the ContentOps Studio workspace bootstrap, list the tools available to this capability profile, summarize the active project and work queue, and propose the next safe step. Do not publish anything without an explicit instruction.

The agent should first use `ba_get_agent_chat_bootstrap` or `ba_get_agent_workspace_manifest`. These tools return the current project roles, handoff structure, and synchronization checksum. The server replaces any caller-supplied project or user identity with the identity bound to the token.

## Verify the connection

The connection is ready when:

1. The client lists ContentOps Studio tools without an authentication error.
2. The workspace bootstrap names the expected project.
3. The available tools match the selected profile.
4. A read-only request such as listing publication tasks returns project data.

Do not use a live publication as a connection test. Connector tests and publishing should follow the project's approval mode.

### Personal VK photo Stories

VK Stories use the same `ba_publish_publication_task` tool and canonical publication facts as other destinations. Configure the VK community ID, save the channel, and connect a personal administrator profile through VK OAuth in **Project settings → Channels**. Existing VK connections must be reconnected once so the token includes the `stories` permission.

A story task must use the `story` placement and have an approved, durable HTTPS image for its accepted revision. The recommended visual is 1080×1920 (9:16). Captions, links, video, and community Stories are not transmitted.

The owner or writer MCP profile can add a native poll with `ba_configure_vk_story_poll`. Pass the current `expectedRevision`, a question, 2–10 unique answers, and optional `anonymous` and `multiple` flags. Pass `remove: true` with the current revision to remove it. Either change creates a new content revision and reopens review. Accept that exact revision before publishing. The dry-run response includes `payload_preview.native_poll`; use it to verify the final question, answer order, and revision. Native poll delivery is experimental until the configured VK account passes a disposable live smoke test.

Run `ba_publish_publication_task` with `dryRun: true` before any live call and provide a unique `idempotencyKey` for the live publication. A started provider call is never retried automatically because VK may have created the poll or Story even if the response was interrupted.

## Revoke or rotate access

Open **Project settings → MCP → Personal access** and select **Revoke** next to the affected token. Issue a new device-specific token when a computer is replaced, a person leaves the project, or a token may have been exposed. Revocation is immediate and does not require a redeploy.

## Multiple Planner projects in Codex

Do not reuse one ContentOps Workspace plugin connection across several Codex projects. Plugin connections are shared by the host, so authorizing another Planner project replaces the effective connection for existing tasks.

For each Planner project, issue its own seven-role workspace bundle. The bundle returns a project-unique MCP namespace, a `.codex/config.toml` snippet, and project-specific environment variable names. Create a separate saved Codex project rooted in the directory named by the bundle and create all seven role tasks inside it. Projectless tasks do not inherit the project configuration. See [the Russian multi-project guide](CODEX_MULTI_PROJECT_MCP_RU.md) for the complete setup.

After all seven roles report the expected project manifest, revoke the legacy shared or individual tokens for that project. Existing projectless tasks keep their history but cannot be retrofitted with a project root, so continue the roles in new tasks inside the saved project.

## Troubleshooting

- `401 Unauthorized`: the token is missing, malformed, expired, or revoked.
- `403 capability mismatch`: the token was used with a different profile endpoint.
- Expected project is missing: confirm that the selected user remains a project member, then issue a new token for the correct project.
- MCP status is offline: verify `MCP_REMOTE_URL`, Railway service health, and the gateway database connection.
- The hosted demo account cannot create tokens or run state-changing tools because it is server-enforced read-only.
