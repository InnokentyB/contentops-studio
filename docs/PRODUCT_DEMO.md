# ContentOps Studio product demo

## Access

- Product: <https://publishplanner-production.up.railway.app>
- Login and password: shared separately by the product owner
- Mode: read-only, synthetic data only

The server blocks changes, uploads, agent runs, connector tests, and live publishing for the demo account. You can navigate through every read surface without affecting production workspaces.

![ContentOps Studio project overview](assets/contentops-studio-overview.png)

## Suggested 5-minute walkthrough

1. **Project overview**
   Open **Overview** to see the channel network, current queue, status summary, and recently completed work.

2. **Publication plan**
   Open **Publication plan** and inspect tasks across published, ready, planned, and cancelled states. Select a task to review its accepted copy, execution context, handoff state, and publication evidence.

   ![ContentOps Studio publication workflow](assets/contentops-studio-publication-workflow.png)

3. **Operational plan**
   Open **Operational plan** to see dated initiatives, dependencies, and decision gates behind the editorial week.

4. **Metrics**
   Open **Metrics** to review synthetic publication facts and 24-hour/72-hour checkpoints across channels.

5. **Project settings**
   Open **Project settings** to inspect role boundaries, channel connector guidance, content rules, and MCP capability profiles. Secret values are never returned to the browser.

## What to evaluate

- Whether the information architecture connects planning, production, publishing, and measurement coherently
- Whether statuses and blockers explain what should happen next
- Whether human and agent responsibilities have clear boundaries
- Whether the audit trail is strong enough for production operations
- Whether the same model works across API connectors and manual browser handoffs

## Notes

- Published links in the demo point back to the public product repository because the content is synthetic.
- Channel connectors are intentionally unconfigured.
- The demo account cannot create projects or modify the fixture.
