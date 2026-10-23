import {publishThreadsWithRelease,type SharedPublicationRequest} from '../../services/threads_publication_dispatch';
import { registerOwnerManualPublicationTools } from './owner_manual_publication_tools';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import mcpPublicationService from '../../services/mcp_publication.service';
import publicationFactService from '../../services/publication_fact.service';
import weekPackageRepairService from '../../services/week_package_repair.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import threadsTaskPublicationService from '../../services/threads_task_publication.service';
import genericThreadsReleaseService from '../../services/threads_generic_release.service';
import {threadsReconcileSchema} from '../../services/threads_api_contract';
import { threadsDiagnosticResult } from './threads_diagnostic_result';
import { publicationAdapterDiagnosticResult } from './publication_adapter_diagnostic_result';
import telegramTaskPublicationService from '../../services/telegram_task_publication.service';
import {
    INTERNAL_MUTATION_ANNOTATIONS,
    EXTERNAL_PUBLICATION_ANNOTATIONS,
    asToolResult
} from './common';

const TASK_NATIVE_DZEN_PUBLICATION_IDS = new Set([958, 962, 992, 999, 1031, 1036, 1045]);

export function isTaskNativeDzenPublication(projectId: number, taskId: number): boolean {
    return projectId === 10 && TASK_NATIVE_DZEN_PUBLICATION_IDS.has(taskId);
}

type PublicationTaskArgs = SharedPublicationRequest;

type TaskExecutor = { execute(args: PublicationTaskArgs): Promise<Record<string, unknown>> };
type ThreadsTaskExecutor = TaskExecutor & { isThreadsTask(args: Pick<PublicationTaskArgs, 'projectId' | 'taskId'>): Promise<boolean> };

type PublicationTaskRoutingDependencies = {
    owned?: (args: PublicationTaskArgs) => Promise<Record<string, unknown> | null>;
    isDzenTask(projectId: number, taskId: number): boolean;
    dzen: TaskExecutor;
    threads: ThreadsTaskExecutor;
    telegram: TaskExecutor;
};

export async function executePublicationTaskByChannel(
    args: PublicationTaskArgs,
    dependencies: PublicationTaskRoutingDependencies = {
        isDzenTask: () => false,
        owned: async args => (await import('../../services/publication_owned_route')).tryOwnedPublicationTask(args),
        dzen: dzenTaskPublicationService,
        threads: threadsTaskPublicationService,
        telegram: telegramTaskPublicationService
    },
    signal?:AbortSignal
): Promise<Record<string, unknown>> {
    if (await dependencies.threads.isThreadsTask(args)) return publishThreadsWithRelease(args,signal);
    if(args.releaseIdempotencyKey!==undefined||args.actorId!==undefined)throw new Error('[PROVIDER_OPERATION_UNSUPPORTED]');
    const owned = await dependencies.owned?.(args);
    if (owned) return owned;
    if (dependencies.isDzenTask(args.projectId, args.taskId)) return dependencies.dzen.execute(args);
    return dependencies.telegram.execute(args);
}

/**
 * Registers publication task management, direct publishing, VK story polls, and publication facts tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerTaskPublicationTools(server: McpServer): void {
    registerOwnerManualPublicationTools(server);
    server.registerTool('ba_reconcile_threads_publication',{
        description:'Reconcile an existing versioned Threads API attempt using provider GETs only and atomically record its verified fact. No create, publish, reset or resend is permitted.',
        annotations:{...INTERNAL_MUTATION_ANNOTATIONS,openWorldHint:true},inputSchema:threadsReconcileSchema.shape
    },async(args,extra)=>threadsDiagnosticResult(()=>genericThreadsReleaseService.reconcile(args,extra.signal)));
    server.registerTool('ba_list_publication_tasks', {
        description: 'List ContentItem-based publication tasks for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            status: z.string().optional().describe("Optional task status, or use 'active' for the main queue view."),
            manualOnly: z.boolean().optional()
        }
    }, async ({ projectId, status, manualOnly }) => {
        const tasks = await mcpPublicationService.listPublicationTasks(projectId, status, manualOnly);
        return asToolResult({ project_id: projectId, tasks });
    });

    server.registerTool('ba_get_publication_task', {
        description: 'Fetch the full details of a single publication task.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const task = await mcpPublicationService.getPublicationTask(projectId, taskId);
        return asToolResult({ project_id: projectId, task });
    });

    server.registerTool('ba_get_publication_task_resources', {
        description: 'Read the resolved resource files for a publication task, including action content files and asset-backed content.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            maxChars: z.number().int().positive().optional().describe('Optional maximum characters per resource, default 12000.')
        }
    }, async ({ projectId, taskId, maxChars }) => {
        const result = await mcpPublicationService.getPublicationTaskResources(projectId, taskId, maxChars);
        return asToolResult(result);
    });

    server.registerTool('ba_prepare_publication_task', {
        description: 'Prepare or reuse a handoff bundle for a publication task before manual publication. Already published tasks are read-only and cannot be modified via MCP.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        return publicationAdapterDiagnosticResult(()=>mcpPublicationService.preparePublicationTask(projectId, taskId));
    });

    server.registerTool('ba_update_publication_content', {
        description: 'Replace only the editable publication body for an existing slot. Slot topic, channel, schedule and lifecycle status remain unchanged.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            body: z.string().max(200000),
            expectedRevision: z.number().int().nonnegative()
        }
    }, async ({ projectId, taskId, body, expectedRevision }) => {
        const task = await mcpPublicationService.updatePublicationContent({ projectId, taskId, body, expectedRevision });
        return asToolResult({ project_id: projectId, task });
    });

    server.registerTool('ba_configure_vk_story_poll', {
        description: 'Configure or remove a revision-bound native poll for a personal VK story. Any change creates a new content revision and reopens review.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            expectedRevision: z.number().int().nonnegative(),
            question: z.string().min(1).max(255).optional(),
            answers: z.array(z.string().min(1).max(100)).min(2).max(10).optional(),
            anonymous: z.boolean().optional(),
            multiple: z.boolean().optional(),
            remove: z.boolean().optional()
        }
    }, async (args) => asToolResult(await mcpPublicationService.configureVkStoryPoll(args)));

    server.registerTool('ba_confirm_publication', {
        description: 'Mark a publication task as published after a manual handoff or an external publish step. Already published tasks are read-only and cannot be modified via MCP.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            publishedLink: z.string().url(),
            note: z.string().optional(),
            outcome: z.enum(['published', 'blocked', 'removed', 'restricted']).optional()
        }
    }, async ({ projectId, taskId, publishedLink, note, outcome }) => {
        const task = await mcpPublicationService.confirmPublication(projectId, taskId, publishedLink, note, outcome);
        return asToolResult({ project_id: projectId, task });
    });

    server.registerTool('ba_record_publication_fact', {
        description: 'Record or explicitly correct the canonical publication fact. Published posts/articles/comments require a permalink; stories require stable identity and evidence.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            taskId: z.number().int().positive(),
            artifactKind: z.enum(['post', 'article', 'story', 'email', 'comment', 'other']),
            outcome: z.enum(['published', 'blocked', 'removed', 'restricted']),
            publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
            publicUrl: z.string().url().nullable().optional(),
            providerObjectId: z.string().max(500).nullable().optional(),
            confirmationMode: z.enum(['automatic', 'manual', 'imported', 'reconciled']),
            evidence: z.object({
                type: z.enum(['public_url', 'provider_id', 'screenshot', 'manual_note', 'api']),
                ref: z.string().min(1).max(2000)
            }).nullable().optional(),
            targetUrl: z.string().url().nullable().optional(),
            utmStatus: z.enum(['pass', 'not_applicable', 'missing', 'invalid', 'unknown']).optional(),
            note: z.string().max(2000).nullable().optional(),
            correctionReason: z.string().max(2000).nullable().optional()
        }
    }, async (args) => asToolResult(await publicationFactService.record(args)));

    server.registerTool('ba_get_publication_fact', {
        description: 'Read the canonical publication fact for one task.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            taskId: z.number().int().positive()
        }
    }, async ({ projectId, actorId, taskId }) => asToolResult({
        publication_fact: await publicationFactService.get(projectId, taskId, actorId)
    }));

    server.registerTool('ba_list_metric_checkpoints', {
        description: 'List due, overdue, partial, failed, or pending T+24h/T+7d metric checkpoints.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            status: z.enum(['pending', 'collected', 'partial', 'unknown', 'not_supported', 'failed', 'overdue']).optional(),
            dueBefore: z.string().datetime({ offset: true }).optional(),
            channelId: z.number().int().positive().optional()
        }
    }, async (args) => asToolResult({ checkpoints: await publicationFactService.listCheckpoints(args) }));

    const repairMoveSchema = z.object({
        contentItemId: z.number().int().positive(),
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    });

    server.registerTool('ba_preview_week_package_repair', {
        description: 'Owner-only dry run for explicitly moving tasks between exact weekly packages. Never changes publication runtime.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            moves: z.array(repairMoveSchema).min(1)
        }
    }, async (args) => asToolResult(await weekPackageRepairService.preview(args)));

    server.registerTool('ba_apply_week_package_repair', {
        description: 'Apply an owner-approved week-package repair atomically after preview.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            moves: z.array(repairMoveSchema).min(1),
            reason: z.string().min(1).max(2000),
            idempotencyKey: z.string().min(1).max(500)
        }
    }, async (args) => asToolResult(await weekPackageRepairService.apply(args)));

    server.registerTool('ba_rollback_week_package_repair', {
        description: 'Rollback one audited week-package repair when task bindings still match its applied state.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            applyIdempotencyKey: z.string().min(1).max(500),
            idempotencyKey: z.string().min(1).max(500)
        }
    }, async (args) => asToolResult(await weekPackageRepairService.rollback(args)));

    server.registerTool('ba_publish_direct', {
        description: 'Publish content directly to a configured project channel. Supports reddit, telegram, vk, and linkedin. Telegram uses the project MTProto session first and falls back to Bot API.',
        inputSchema: {
            projectId: z.number().int().positive(),
            channelId: z.number().int().positive().optional(),
            channelType: z.enum(['reddit', 'telegram', 'vk', 'linkedin']).optional(),
            title: z.string().optional().describe('Required for reddit publication.'),
            text: z.string().min(1),
            subreddit: z.string().optional().describe('Required for reddit publication. Example: artificial or r/artificial'),
            imageUrl: z.string().optional().describe('Optional remote URL, data URI, or /uploads/... path supported by the channel adapter.'),
            dryRun: z.boolean().optional().describe('When true, validate channel resolution and preview the payload without publishing.')
        }
    }, async ({ projectId, channelId, channelType, title, text, subreddit, imageUrl, dryRun }) => {
        return publicationAdapterDiagnosticResult(() => mcpPublicationService.publishDirect({
                projectId,
                channelId,
                channelType,
                title,
                text,
                subreddit,
                imageUrl,
                dryRun
            }));
    });

    server.registerTool('ba_publish_publication_task', {
        description: 'Governed Dzen uses the existing command with operation release/publish/reconcile and default stored-only dryRun; native actions remain held by policy. Threads uses its existing generic text-only API sender only with a complete exact generic release envelope; this command never switches browser transport. Other supported canonical task dry-runs use accepted text and approved durable visual. Live Telegram feed tasks target their configured channel. Telegram and VK story tasks target the authorized personal profile; VK photo stories can include a revision-bound native poll configured through ba_configure_vk_story_poll. No browser fallback or silent visual downgrade is used.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: z.object({
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            dryRun: z.boolean().optional().describe('Validate and return the exact normalized provider payload without sending.'),
            idempotencyKey: z.string().min(1).max(500).optional().describe('Required for live publication and reused to safely replay a confirmed result.'),
            operation: z.enum(['release', 'publish', 'reconcile']).optional(),
            expectedAcceptedRevision: z.number().int().positive().optional(),
            expectedPackageSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
            expectedManifestChecksum: z.string().min(1).max(200).optional(),
            approvalReference: z.string().min(1).max(1000).optional(),
            attemptId: z.number().int().positive().optional(),
            releaseIdempotencyKey: z.string().min(1).max(500).optional().describe('Existing generic Threads release key; never creates a release or changes transport.')
        }).strict()
    }, async (args,extra) => publicationAdapterDiagnosticResult(() => executePublicationTaskByChannel(args,undefined,extra.signal)));

    server.registerTool('ba_publish_threads_task', {
        description: 'Generic text-only Threads API preparation and sending require the complete existing audited release envelope. Live publication requires an exact audited generic release, creates a durable attempt before dispatch, verifies provider readback, and freezes uncertain outcomes.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            dryRun: z.boolean().optional(),
            idempotencyKey: z.string().min(1).max(500).optional(),
            actorId: z.string().regex(/^user:[1-9]\d*$/).optional(),
            approvalReference: z.string().min(10).optional(),
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
            releaseIdempotencyKey: z.string().min(1).max(500).optional()
        }
    }, async (args,extra) => {
        return threadsDiagnosticResult(() => publishThreadsWithRelease(args,extra.signal));
    });
}
