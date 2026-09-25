import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import workQueueService from '../../services/work_queue.service';
import weeklyThemePipelineService from '../../services/weekly_theme_pipeline.service';
import { asToolResult } from './common';

/**
 * Registers weekly theme pipeline, plan decision, and canvas visualization tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerWeeklyPipelineTools(server: McpServer): void {
    server.registerTool('ba_bind_service_identity', {
        description: 'Allow a registered service identity to access one project. Project owner only.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            serviceActorId: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.bindServiceIdentity(args);
        return asToolResult(result);
    });

    server.registerTool('ba_unbind_service_identity', {
        description: 'Revoke a service identity project binding immediately. Project owner only.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            serviceActorId: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.unbindServiceIdentity(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_service_bindings', {
        description: 'List active and revoked service identity bindings for a project. Project owner only.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.listServiceBindings(args);
        return asToolResult(result);
    });

    server.registerTool('ba_decide_week_plan', {
        description: 'Approve or reject a weekly publication plan package. Unlocks content_write work items upon approval.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            weekPackageId: z.number().int().positive(),
            planVersion: z.string(),
            decision: z.enum(['approved', 'rejected']),
            comment: z.string().optional(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.decideWeekPlan(args);
        return asToolResult(result);
    });

    server.registerTool('ba_upsert_week_theme', {
        description: 'Create or revise the planner-owned weekly theme for a channel and target week.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), channelId: z.number().int().positive(),
            targetWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            targetWeekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            timezone: z.string().min(1).max(100),
            title: z.string().min(1).max(300), body: z.string().min(1).max(20000),
            sourceRefs: z.array(z.object({ type: z.string().min(1).max(100), ref: z.string().min(1).max(2000) })).max(50),
            expectedRevision: z.number().int().nonnegative(), state: z.enum(['draft', 'accepted']),
            acceptedAt: z.string().nullable().optional(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await weeklyThemePipelineService.upsertWeekTheme(args)));

    server.registerTool('ba_start_week_autogeneration', {
        description: 'Headquarters entrypoint for the shared publication workflow: accept the weekly theme and create exactly seven dated publication tasks. The tasks immediately appear in ba_list_publication_tasks, stop for headquarters topic approval, then progress through writer, review, visual, connector/browser publication, permalink, and metrics.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), channelId: z.number().int().positive(),
            targetWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            targetWeekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            timezone: z.string().min(1).max(100),
            title: z.string().min(1).max(300), body: z.string().min(1).max(20000),
            sourceRefs: z.array(z.object({ type: z.string().min(1).max(100), ref: z.string().min(1).max(2000) })).max(50),
            expectedRevision: z.number().int().nonnegative(), state: z.literal('accepted'),
            acceptedAt: z.string(),
            scheduleTemplate: z.object({ localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), days: z.array(z.number().int().min(1).max(7)).length(7) }),
            idempotencyKey: z.string().min(1), previewIdempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await weeklyThemePipelineService.startWeekAutomation(args)));

    server.registerTool('ba_generate_week_topic_preview', {
        description: 'Generate an idempotent seven-day topic preview from the current accepted weekly theme.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), channelId: z.number().int().positive(),
            weekPackageId: z.number().int().positive(), themeContentItemId: z.number().int().positive(),
            themeRevision: z.number().int().positive(), timezone: z.string().min(1).max(100),
            scheduleTemplate: z.object({ localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), days: z.array(z.number().int().min(1).max(7)).length(7) }),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await weeklyThemePipelineService.generatePreview(args)));

    server.registerTool('ba_get_week_pipeline', {
        description: 'Read the synchronized weekly autogeneration canvas: current stage, next actor and command, seven daily topics, content work, review, and visual progress. Call this before acting instead of guessing the next step.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), weekPackageId: z.number().int().positive()
        }
    }, async (args) => asToolResult(await weeklyThemePipelineService.getPipeline(args)));

    server.registerTool('ba_get_week_autogeneration', {
        description: 'Canonical status for the shared weekly publication flow. Returns publication_task_id, generation stage, draft/visual readiness, publication mode, outcome and public URL for every day; use the same IDs with ba_get_publication_task and ba_list_publication_tasks.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), weekPackageId: z.number().int().positive()
        }
    }, async (args) => asToolResult(await weeklyThemePipelineService.getPipeline(args)));

    server.registerTool('ba_get_week_execution_summary', {
        description: 'Get material stats and work item stage counts for a weekly publication plan.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            weekPackageId: z.number().int().positive(),
            asOf: z.string().optional()
        }
    }, async (args) => {
        const result = await workQueueService.getWeekExecutionSummary(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_work_items', {
        description: 'List pending or available work items for a project sorted by schedule urgency.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            asOf: z.string().optional(),
            filter: z.object({
                state: z.string().optional(),
                kind: z.string().optional()
            }).optional()
        }
    }, async (args) => {
        const result = await workQueueService.listWorkItems(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_browser_publication_tasks', {
        description: 'List publication tasks that require browser execution because no direct API is available or connector publishing failed. Claim the returned work item before publishing, then confirm the public URL with ba_confirm_publication.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            asOf: z.string().optional()
        }
    }, async (args) => {
        const result = await workQueueService.listWorkItems({
            ...args,
            filter: { kind: 'browser_publish' }
        });
        return asToolResult(result);
    });
}
