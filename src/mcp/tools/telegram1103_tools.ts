import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rebindTelegram1103Asset, releaseTelegram1103, video1103RebindSchema, video1103ReleaseSchema } from '../../services/telegram1103/control';
import telegram1103Publication from '../../services/telegram1103/publication';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS, EXTERNAL_PUBLICATION_ANNOTATIONS } from './common';

/** Narrow owner-approved video recovery; never exposes generic raw provider execution. */
export function registerTelegram1103Tools(server: McpServer): void {
    server.registerTool('ba_rebind_telegram_video_task1103_asset', {
        description: 'Owner-only audited preview/apply of original MP4 asset142 to accepted task1103 revision2 after a current SOURCE_REQUIRED/MANUAL_ASSET_REQUIRED Art decision. Same R2 object and checksum, no upload/duplicate asset. Resets candidate and requires normal visual review; never accepts copy or publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: video1103RebindSchema.shape
    }, async args => asToolResult(await rebindTelegram1103Asset(args)));
    server.registerTool('ba_release_telegram_video_task1103', {
        description: 'Owner-only audited preview/apply for exact task1103/channel109/r2/asset142 MP4. Verifies current accepted text, Art/visual approval, body/media hashes, dates, manifest and absence of attempts/facts. Does not publish or enable scheduler discovery.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: video1103ReleaseSchema.shape
    }, async args => asToolResult(await releaseTelegram1103(args)));
    server.registerTool('ba_publish_telegram_video_task1103', {
        description: 'Exact canonical video task1103 dry-run or one-shot dispatch after audited release. Durable attempt before one MTProto native video call; independent provider readback before video fact. Existing/uncertain attempts never resend; no image/text/bot fallback.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1103), dryRun: z.boolean().optional(),
            idempotencyKey: z.string().min(1).max(160).optional() }
    }, async args => asToolResult(await telegram1103Publication.execute(args)));
}
