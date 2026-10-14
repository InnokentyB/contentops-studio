import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { linkedIn1128BindingArgs, LINKEDIN1128 } from '../../services/linkedin1128_identity.service';
import { bindLinkedIn1128IdentityWithPrisma } from '../../services/linkedin1128_identity_store';
import { releaseLinkedInBrowserTaskWithPrisma } from '../../services/linkedin_browser_owner_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerLinkedInTask1128IdentityTool(server: McpServer): void {
    server.registerTool('ba_bind_linkedin_task1128_identity', {
        description: 'Owner-only exact project7/task1128 task-only adoption of Registryv36 company97416172 evidence. apply=false previews without writes; apply=true CAS-writes identity_binding and audit only. Never changes the channel, credentials, content, date, visual decision, publication mode, work items, delivery attempts or facts; not provider identity verification and not send authority.',
        inputSchema: linkedIn1128BindingArgs.shape,
        annotations: INTERNAL_MUTATION_ANNOTATIONS
    }, async args => asToolResult(await bindLinkedIn1128IdentityWithPrisma(args)));
    server.registerTool('ba_release_linkedin_task1128_browser', {
        description: 'Owner-only exact task1128 rev1/company97416172 manual release. Requires matching audited task-only identity adoption, live manifest, body, both dates, active NO_VISUAL_NEEDED decision305v1, and no existing delivery/active browser work. Creates one revision-bound browser WI; never claims or sends. Provider identity/history checks remain the sole Publisher responsibility.',
        inputSchema: linkedIn1128BindingArgs.omit({ apply: true }).shape,
        annotations: INTERNAL_MUTATION_ANNOTATIONS
    }, async args => asToolResult(await releaseLinkedInBrowserTaskWithPrisma({ ...args,
        expectedChannelId: 6, expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedBodySha256: LINKEDIN1128.body, expectedSelectedAssetId: null, expectedAssetSha256: null,
        expectedVisualDecisionId: 305, expectedScheduleAt: LINKEDIN1128.schedule })));
}
