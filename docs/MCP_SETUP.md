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

## Deploy the complete workspace

For a new external user, use the complete workspace flow:

1. Add the user as a member of the project and ask them to sign in once.
2. Open **Project settings → MCP → Personal access** as a project owner.
3. Select that project member, add a device-specific label, and select **Deploy 7 roles**.
4. Copy both one-time blocks: the seven-connector configuration and the agent bootstrap prompt.
5. Add the connectors to the user's agent client. Give the bootstrap prompt to that agent. If the host can create persistent chats, it creates the seven named role chats; otherwise it should return seven copyable chat cards.

The bundle is created atomically: either all seven hashed credentials are stored or none are. Plaintext tokens are returned only in this response and must not be pasted into chat messages or committed to a repository. Repeating the action creates a new set of credentials; revoke superseded tokens afterward.

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

## Revoke or rotate access

Open **Project settings → MCP → Personal access** and select **Revoke** next to the affected token. Issue a new device-specific token when a computer is replaced, a person leaves the project, or a token may have been exposed. Revocation is immediate and does not require a redeploy.

## Troubleshooting

- `401 Unauthorized`: the token is missing, malformed, expired, or revoked.
- `403 capability mismatch`: the token was used with a different profile endpoint.
- Expected project is missing: confirm that the selected user remains a project member, then issue a new token for the correct project.
- MCP status is offline: verify `MCP_REMOTE_URL`, Railway service health, and the gateway database connection.
- The hosted demo account cannot create tokens or run state-changing tools because it is server-enforced read-only.
