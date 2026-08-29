# Agent Workspace Manifest

The Planner exposes a canonical, project-scoped description of its agent chats through MCP. The manifest is derived from the live project, active channels, agent models, prompts and governance settings; it is not a second workflow database.

## MCP tools

- `ba_get_agent_workspace_manifest(projectId, userId)` returns the complete secret-free topology.
- `ba_get_agent_workspace_updates(projectId, userId, knownChecksum)` returns `changed: false` when the client is current, or a fresh manifest when planner configuration changed.
- `ba_get_agent_chat_bootstrap(projectId, userId, chatId)` returns the role, responsibilities, permissions, startup instructions and adjacent handoffs for one chat.

Remote MCP replaces caller-supplied `projectId` and `userId` with the credential binding. The service then verifies project membership. Prompts are represented by checksums and are never copied into the manifest together with provider credentials.

Clients should fetch a chat bootstrap when creating a chat and call `ba_get_agent_workspace_updates` at the start of each session. MCP cannot universally create or rewrite chats inside every host application; the host or its agent must apply the returned bootstrap.

## Current chat IDs

- `planning_hq`
- `content_writer`
- `chief_editor`
- `art_director`
- `publisher`
- `growth_analyst`

The manifest checksum changes when the project, an active channel, a governed prompt/model, the content dictionary, policy matrix, ATOMA description or art-direction pipeline setting changes.
