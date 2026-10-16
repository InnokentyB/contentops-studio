import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releasePendingThreadsTask } from '../../services/threads_pending_release.service';
import threadsTaskPublicationService from '../../services/threads_task_publication.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import { DZEN1002_ROUTE, preflightDzenTask1002,
    releaseDzenTask1002 } from '../../services/dzen_task1002_route.service';
import { asToolResult, EXTERNAL_PUBLICATION_ANNOTATIONS, INTERNAL_MUTATION_ANNOTATIONS } from './common';

const MANIFEST = 'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b';

type Dzen1002Commands = {
    publish(input: unknown): Promise<Record<string, unknown>>;
    reconcile(input: unknown): Promise<Record<string, unknown>>;
};
/** Exact publication commands. Optional internal ports support boundary tests, never request overrides. */
export function registerTomorrowPublicationTools(server: McpServer, dzen1002Commands: Dzen1002Commands = {
    publish: async input => dzenTaskPublicationService.execute(z.object({
        projectId: z.literal(10), taskId: z.literal(1002), actorId: z.string(),
        expectedManifestChecksum: z.string(), dryRun: z.boolean().optional().default(true),
        idempotencyKey: z.string().optional()
    }).strict().parse(input)),
    reconcile: async input => {
        const { reconcileExactDzen1002 } = await import('../../services/dzen1002_runtime_production');
        return { ...await reconcileExactDzen1002(input) };
    }
}): void {
    const dzen1002 = {
        projectId: z.literal(DZEN1002_ROUTE.projectId), taskId: z.literal(DZEN1002_ROUTE.taskId),
        actorId: z.string().regex(/^user:\d+$/),
        expectedManifestChecksum: z.literal(DZEN1002_ROUTE.manifest),
        expectedBodySha256: z.literal(DZEN1002_ROUTE.bodySha256),
        expectedScheduleAt: z.literal(DZEN1002_ROUTE.schedule),
        approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
    };
    server.registerTool('ba_release_dzen_task1002', {
        description: 'Owner-only audited release of exact p10 Dzen task1002 revision3/decision300/asset151. Verifies hashes, schedule, manifest, fact and attempt state; never contacts Dzen.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: dzen1002
    }, async args => asToolResult(await releaseDzenTask1002(args)));
    server.registerTool('ba_preflight_dzen_task1002', {
        description: 'Authenticated provider-read-only inventory preflight for exact owner-released Dzen task1002. Requires complete Studio coverage and proves no exact-title duplicate; never creates, edits or submits.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: dzen1002
    }, async args => asToolResult(await preflightDzenTask1002(args)));
    server.registerTool('ba_publish_dzen_task1002', {
        description: 'Exact dry-run or one-shot create/edit/submit/confirm route for owner-released and freshly preflighted Dzen task1002. Provider ambiguity freezes retry and records no publication fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1002),
            actorId: z.string().regex(/^user:\d+$/), expectedManifestChecksum: z.literal(DZEN1002_ROUTE.manifest),
            dryRun: z.boolean().optional().default(true), idempotencyKey: z.string().min(1).optional() }
    }, async args => asToolResult(await dzen1002Commands.publish(args)));
    server.registerTool('ba_reconcile_dzen_task1002', {
        description: 'Complete the original task1002 attempt from its retained verified receipt only. Never creates, edits, uploads or sends; missing receipt stays reconciliation-required.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1002),
            actorId: z.string().regex(/^user:[1-9]\d*$/), expectedManifestChecksum: z.literal(DZEN1002_ROUTE.manifest),
            attemptId: z.number().int().positive(), idempotencyKey: z.string().min(1).max(200) }
    }, async args => asToolResult(await dzen1002Commands.reconcile(args)));

    server.registerTool('ba_release_threads_task1108_api', {
        description: 'Owner-only audited release of exact p10 Threads task1108 revision1/decision290. Verifies personal identity, provider history, manifest, native length and absence of facts or attempts. Never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1108),
            actorId: z.string().regex(/^user:\d+$/),
            expectedManifestChecksum: z.literal(MANIFEST),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async args => asToolResult(await releasePendingThreadsTask(args)));
    server.registerTool('ba_publish_threads_task1108', {
        description: 'Exact dry-run or one-shot task-native API publication for owner-released Threads task1108 revision1. An uncertain provider result freezes retry and records no publication fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1108),
            dryRun: z.boolean().optional().default(true), idempotencyKey: z.string().min(1).optional()
        }
    }, async args => asToolResult(await threadsTaskPublicationService.execute(args)));

    server.registerTool('ba_release_threads_task1110_api', {
        description: 'Owner-only audited release of exact p10 Threads task1110 revision2/decision299. Verifies personal identity, provider history, manifest, native length and absence of facts or attempts. Never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1110),
            actorId: z.string().regex(/^user:\d+$/),
            // The canonical release service verifies equality with the live manifest.
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async args => asToolResult(await releasePendingThreadsTask(args)));
    server.registerTool('ba_publish_threads_task1110', {
        description: 'Exact dry-run or one-shot task-native API publication for owner-released Threads task1110 revision2. An uncertain provider result freezes retry and records no publication fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1110),
            dryRun: z.boolean().optional().default(true), idempotencyKey: z.string().min(1).optional()
        }
    }, async args => asToolResult(await threadsTaskPublicationService.execute(args)));
}
