import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RemotePrincipal } from '../remote-auth';
import { publicationPreviewSchema, publicationPreviewError } from '../../services/publication_preview_contract';
import { previewPublicationTask } from '../../services/publication_preview.service';
import { asToolResult } from './common';

/** Separate local-only preview with a trusted server-session principal; never calls a sender. */
export function registerPublicationPreviewTools(server: McpServer, principal?: Readonly<RemotePrincipal> | null): void {
    server.registerTool('ba_preview_publication_task', {
        description: 'Inspect local accepted revision, visual bindings and lifecycle blockers without writes, credentials or provider access. Provider readiness and send authority are not established.',
        annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
        inputSchema: publicationPreviewSchema.shape
    }, async input => {
        try {return {...asToolResult(await previewPublicationTask(input, principal)), isError: false};}
        catch (error: unknown) {return {...asToolResult(publicationPreviewError(error)), isError: true};}
    });
}
