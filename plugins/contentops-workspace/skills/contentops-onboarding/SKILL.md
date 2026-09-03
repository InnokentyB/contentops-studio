---
name: contentops-onboarding
description: Connect a ContentOps Studio Planner project and prepare its governed seven-role workspace when a user asks to onboard, connect Planner, or set up the project in Codex.
---

# ContentOps onboarding

Use the installed ContentOps MCP servers; never ask the user to paste bearer or OAuth tokens into chat.

1. If the MCP connection requests authorization, let the host open Planner sign-in and consent. The user chooses a project they own.
2. Call `ba_get_agent_workspace_manifest` through the strategist server. Treat its project identity, role map, permissions, and handoffs as authoritative.
3. Call `ba_get_agent_chat_bootstrap` for each manifest chat before starting work in that role.
4. When the host supports creating persistent tasks, create the seven tasks named by the manifest and give each the matching bootstrap instructions. When it does not, return the seven names and starter prompts so the user can create them without inventing configuration.
5. Keep strategy, planning, writing, editing, art direction, publishing, and growth analysis in their declared role boundaries. Use manifest handoffs instead of copying hidden credentials or assuming state.

Publishing is an external mutation. Do not publish merely because onboarding is requested. Use only the publisher server's governed delivery tools after explicit user direction, accepted content, approved visual state when required, and provider confirmation. Never report a publication without its recorded provider object ID or permalink.

If the host exposes all seven MCP servers in one task, still operate only through the server matching the active manifest role. Explain that this is an instructional boundary imposed by the current host, not a separate credential boundary.
