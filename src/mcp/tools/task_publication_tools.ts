import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import mcpPublicationService from '../../services/mcp_publication.service';
import publicationFactService from '../../services/publication_fact.service';
import weekPackageRepairService from '../../services/week_package_repair.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import threadsTaskPublicationService from '../../services/threads_task_publication.service';
import telegramTaskPublicationService from '../../services/telegram_task_publication.service';
import {
    INTERNAL_MUTATION_ANNOTATIONS,
    EXTERNAL_PUBLICATION_ANNOTATIONS,
    asToolResult,
    asTelegramRouteToolError
} from './common';

/**
 * Registers publication task management, direct publishing, VK story polls, and publication facts tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerTaskPublicationTools(server: McpServer): void {
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
        const result = await mcpPublicationService.preparePublicationTask(projectId, taskId);
        return asToolResult(result);
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
        try {
            const result = await mcpPublicationService.publishDirect({
                projectId,
                channelId,
                channelType,
                title,
                text,
                subreddit,
                imageUrl,
                dryRun
            });
            return asToolResult(result);
        } catch (error: unknown) {
            const toolError = asTelegramRouteToolError(error);
            if (!toolError) throw error;
            return toolError;
        }
    });

    server.registerTool('ba_publish_publication_task', {
        description: 'Dry-run any canonical publication task using accepted text and approved durable visual. Live Telegram feed tasks target their configured channel. Telegram and VK story tasks target the authorized personal profile; VK photo stories can include a revision-bound native poll configured through ba_configure_vk_story_poll. No browser fallback or silent visual downgrade is used.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            dryRun: z.boolean().optional().describe('Validate and return the exact normalized provider payload without sending.'),
            idempotencyKey: z.string().min(1).max(500).optional().describe('Required for live publication and reused to safely replay a confirmed result.')
        }
    }, async (args) => asToolResult(await (args.projectId === 10 && [958, 962].includes(args.taskId)
        ? dzenTaskPublicationService.execute(args)
        : args.projectId === 10 && args.taskId === 953
            ? threadsTaskPublicationService.execute(args)
            : telegramTaskPublicationService.execute(args))));
}
