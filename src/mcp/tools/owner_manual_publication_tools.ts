import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ownerManualPublicationService } from '../../services/owner_manual_publication_service';
import { ownerManualSafeFailure } from '../../services/owner_manual_publication_contract';
import { asToolResult } from './common';
export function registerOwnerManualPublicationTools(server: McpServer): void {
    const fields = { projectId: z.unknown().optional(), taskId: z.unknown().optional(), publicUrl: z.unknown().optional(), publishedAt: z.unknown().optional(), timeBasis: z.unknown().optional(), ownerConfirmationReference: z.unknown().optional(), publishedRevision: z.unknown().optional(), actorId: z.unknown().optional() };
    const tools = [{ name: 'ba_preview_owner_manual_publication_confirmation', commit: false }, { name: 'ba_confirm_owner_manual_publication', commit: true }];
    for (const tool of tools)
        server.registerTool(tool.name, { description: 'Owner-attested accounting for an already existing VK wall post or Dzen article. Never sends, reconciles or changes transport history.', annotations: { readOnlyHint: !tool.commit, openWorldHint: false, destructiveHint: false }, inputSchema: z.object({ ...fields, ...(tool.commit ? { previewHash: z.unknown().optional(), expectedManifestChecksum: z.unknown().optional(), expectedFactSha256: z.unknown().optional(), idempotencyKey: z.unknown().optional(), correctionReason: z.unknown().optional() } : {}) }).passthrough() }, async (args) => {
            try {
                return asToolResult(await (tool.commit ? ownerManualPublicationService.commit(args) : ownerManualPublicationService.preview(args)));
            }
            catch (error: unknown) {
                return { ...asToolResult(ownerManualSafeFailure(error)), isError: true };
            }
        });
}
