import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import prisma, { pool } from '../db';
import mcpPublicationService from '../services/mcp_publication.service';
import workQueueService from '../services/work_queue.service';
import initiativeService from '../services/initiative.service';
import taskTrackerService from '../services/task_tracker.service';
import deliveryService from '../services/delivery.service';
import imageAssetService from '../services/image_asset.service';





export function asToolResult<T extends Record<string, unknown>>(payload: T) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(payload, null, 2)
            }
        ],
        structuredContent: payload
    };
}

export function createPlannerMcpServer() {
    const server = new McpServer({
        name: 'ba-post-planner-publication',
        version: '1.0.0'
    });

    registerPlannerTools(server);
    return server;
}

export function registerPlannerTools(server: McpServer) {
    server.registerTool('ba_get_publication_plan_format', {
        description: 'Return the preferred machine-readable publication-plan contract for chat/MCP authoring.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {}
    }, async () => {
        const format = mcpPublicationService.getPublicationPlanFormat();
        return asToolResult({ format });
    });

    server.registerTool('ba_get_publication_plan_template', {
        description: 'Return a ready-to-fill publication-plan JSON template for chat-based authoring.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            planId: z.string().optional(),
            projectName: z.string().optional(),
            owner: z.string().optional(),
            timezone: z.string().optional(),
            channelRef: z.string().optional(),
            channelPlatform: z.string().optional()
        }
    }, async (input) => {
        const template = mcpPublicationService.getPublicationPlanTemplate(input);
        return asToolResult({ template });
    });

    server.registerTool('ba_normalize_publication_plan_json', {
        description: 'Validate and normalize a publication-plan JSON payload produced by chat before import.',
        inputSchema: {
            planJson: z.string().min(2)
        }
    }, async ({ planJson }) => {
        const result = mcpPublicationService.normalizePublicationPlan(planJson);
        return asToolResult(result);
    });

    server.registerTool('ba_list_users', {
        description: 'List planner users with their IDs and linked umbrella projects.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            includeArchivedProjects: z.boolean().optional()
        }
    }, async ({ includeArchivedProjects }) => {
        const users = await mcpPublicationService.listUsers({ includeArchivedProjects });
        return asToolResult({ users });
    });

    server.registerTool('ba_get_user', {
        description: 'Fetch one planner user by ID, including linked projects and roles.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            includeArchivedProjects: z.boolean().optional()
        }
    }, async ({ userId, includeArchivedProjects }) => {
        const user = await mcpPublicationService.getUser(userId, { includeArchivedProjects });
        return asToolResult({ user });
    });

    server.registerTool('ba_list_projects', {
        description: 'List planner projects that can be used for publication workflows.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive().optional(),
            includeArchived: z.boolean().optional()
        }
    }, async ({ userId, includeArchived }) => {
        const projects = await mcpPublicationService.listProjects({ userId, includeArchived });
        return asToolResult({ projects });
    });

    server.registerTool('ba_create_project', {
        description: 'Create a new umbrella project that can hold multiple channels, content items, parser results, and publication tasks.',
        inputSchema: {
            userId: z.number().int().positive(),
            name: z.string().min(1),
            slug: z.string().optional(),
            description: z.string().optional(),
            kind: z.string().optional().describe('Optional project kind. Defaults to content_network.')
        }
    }, async ({ userId, name, slug, description, kind }) => {
        const result = await mcpPublicationService.createProject({ userId, name, slug, description, kind });
        return asToolResult(result);
    });

    server.registerTool('ba_update_project', {
        description: 'Update umbrella project metadata such as name, slug, description, or kind.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            name: z.string().optional(),
            slug: z.string().optional(),
            description: z.string().nullable().optional(),
            kind: z.string().optional()
        }
    }, async ({ userId, projectId, name, slug, description, kind }) => {
        const result = await mcpPublicationService.updateProject({ userId, projectId, name, slug, description, kind });
        return asToolResult(result);
    });

    server.registerTool('ba_archive_project', {
        description: 'Archive or unarchive a project while keeping its channels and content network intact.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            archived: z.boolean().optional().describe('Defaults to true. Pass false to unarchive a project.')
        }
    }, async ({ userId, projectId, archived }) => {
        const result = await mcpPublicationService.archiveProject({ userId, projectId, archived });
        return asToolResult(result);
    });

    server.registerTool('ba_parser_health', {
        description: 'Check parser connectivity from the planner context for a specific project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcpPublicationService.getParserHealth(projectId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_create_search_job', {
        description: 'Create and queue a parser search job for a planner project.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            source: z.enum(['reddit', 'indie_hackers']).optional(),
            query: z.string().min(1),
            subreddit: z.string().optional(),
            subreddits: z.array(z.string()).optional(),
            queryDefinitionId: z.string().optional(),
            intent: z.string().optional(),
            cluster: z.string().optional(),
            priority: z.number().int().optional(),
            matchMustIncludeAny: z.array(z.string()).optional(),
            excludeIfContains: z.array(z.string()).optional(),
            excludeRegexes: z.array(z.string()).optional(),
            limit: z.number().int().positive().optional(),
            minScore: z.number().int().optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
            includeComments: z.boolean().optional(),
            enrich: z.boolean().optional(),
            idempotencyKey: z.string().optional()
        }
    }, async (input) => {
        const result = await mcpPublicationService.createParserSearchJob(input);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_get_search_job', {
        description: 'Fetch one parser search job and its latest run state for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            jobId: z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcpPublicationService.getParserSearchJob(projectId, jobId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_refresh_search_job', {
        description: 'Queue a refresh run for an existing parser search job.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            jobId: z.string().min(1),
            idempotencyKey: z.string().optional()
        }
    }, async ({ userId, projectId, jobId, idempotencyKey }) => {
        const result = await mcpPublicationService.refreshParserSearchJob(projectId, jobId, userId, idempotencyKey);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_list_posts', {
        description: 'List parser-normalized posts available to a planner project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            limit: z.number().int().positive().optional(),
            offset: z.number().int().nonnegative().optional()
        }
    }, async ({ userId, projectId, limit, offset }) => {
        const result = await mcpPublicationService.listParserPosts(projectId, userId, limit, offset);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_get_insights', {
        description: 'List planner-friendly parser insights for a project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            limit: z.number().int().positive().optional(),
            offset: z.number().int().nonnegative().optional(),
            jobId: z.string().optional(),
            type: z.string().optional()
        }
    }, async ({ userId, projectId, limit, offset, jobId, type }) => {
        const result = await mcpPublicationService.getParserInsights(projectId, userId, {
            limit,
            offset,
            jobId,
            type
        });
        return asToolResult(result);
    });

    server.registerTool('ba_parser_get_summary', {
        description: 'Fetch a planner-ready summary for one parser job.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            jobId: z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcpPublicationService.getParserSummary(projectId, jobId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_list_templates', {
        description: 'List saved parser search templates for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcpPublicationService.listParserTemplates(projectId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_import_templates', {
        description: 'Import parser search templates from YAML content or a structured query bank.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            yamlContent: z.string().optional(),
            queryBank: z.record(z.string(), z.any()).optional(),
            scheduleDaily: z.boolean().optional(),
            limit: z.number().int().positive().optional(),
            minScore: z.number().int().optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
            includeComments: z.boolean().optional(),
            enrich: z.boolean().optional(),
            idempotencyKey: z.string().optional()
        }
    }, async (input) => {
        const result = await mcpPublicationService.importParserTemplates(input);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_run_template', {
        description: 'Queue an immediate parser run for a saved template.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            templateId: z.string().min(1),
            idempotencyKey: z.string().optional()
        }
    }, async ({ userId, projectId, templateId, idempotencyKey }) => {
        const result = await mcpPublicationService.runParserTemplate(projectId, templateId, userId, idempotencyKey);
        return asToolResult(result);
    });

    server.registerTool('ba_import_publication_plan_json', {
        description: 'Import a publication plan JSON payload into the planner. Default mode is delta_safe: add/update only the incoming delta and preserve existing runtime content. Use full_sync only when you explicitly want missing imported tasks to be removed.',
        inputSchema: {
            userId: z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planJson: z.string().min(2).describe('Full publication plan JSON string with meta.plan_id, accounts, assets, and actions[].'),
            workspaceRoots: z.array(z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.'),
            importMode: z.enum(['delta_safe', 'full_sync']).optional().describe('delta_safe preserves existing tasks/assets and only applies the incoming delta. full_sync also deletes missing imported tasks.')
        }
    }, async ({ userId, planJson, workspaceRoots, importMode }) => {
        const result = await mcpPublicationService.importPublicationPlanJson(planJson, userId, workspaceRoots, importMode || 'delta_safe');
        return asToolResult(result);
    });

    server.registerTool('ba_import_publication_plan_delta_json', {
        description: 'Safely import only the incoming publication-plan delta from a JSON payload. Existing tasks stay in place, missing tasks are not removed, and published/completed runtime content is preserved.',
        inputSchema: {
            userId: z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planJson: z.string().min(2).describe('Partial or full publication plan JSON string with meta.plan_id, accounts, assets, and actions[].'),
            workspaceRoots: z.array(z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.')
        }
    }, async ({ userId, planJson, workspaceRoots }) => {
        const result = await mcpPublicationService.importPublicationPlanJson(planJson, userId, workspaceRoots, 'delta_safe');
        return asToolResult(result);
    });

    server.registerTool('ba_import_publication_plan_file', {
        description: 'Import a publication plan from a local JSON file path. Default mode is delta_safe: add/update only the incoming delta and preserve existing runtime content. Use full_sync only when you explicitly want missing imported tasks to be removed.',
        inputSchema: {
            userId: z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planPath: z.string().min(1).describe('Absolute or local filesystem path to a publication plan JSON file.'),
            workspaceRoots: z.array(z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.'),
            importMode: z.enum(['delta_safe', 'full_sync']).optional().describe('delta_safe preserves existing tasks/assets and only applies the incoming delta. full_sync also deletes missing imported tasks.')
        }
    }, async ({ userId, planPath, workspaceRoots, importMode }) => {
        const result = await mcpPublicationService.importPublicationPlanFile(planPath, userId, workspaceRoots, importMode || 'delta_safe');
        return asToolResult(result);
    });

    server.registerTool('ba_import_publication_plan_delta_file', {
        description: 'Safely import only the incoming publication-plan delta from a local JSON file. Existing tasks stay in place, missing tasks are not removed, and published/completed runtime content is preserved.',
        inputSchema: {
            userId: z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planPath: z.string().min(1).describe('Absolute or local filesystem path to a publication plan JSON file.'),
            workspaceRoots: z.array(z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.')
        }
    }, async ({ userId, planPath, workspaceRoots }) => {
        const result = await mcpPublicationService.importPublicationPlanFile(planPath, userId, workspaceRoots, 'delta_safe');
        return asToolResult(result);
    });

    server.registerTool('ba_list_publication_plan_assets', {
        description: 'List file-backed assets from an imported publication plan for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const result = await mcpPublicationService.listPublicationPlanAssets(projectId);
        return asToolResult(result);
    });

    server.registerTool('ba_read_publication_plan_asset', {
        description: 'Read the content of a file-backed asset from an imported publication plan.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            assetRef: z.string().min(1),
            maxChars: z.number().int().positive().optional().describe('Optional maximum characters to return, default 20000.')
        }
    }, async ({ projectId, assetRef, maxChars }) => {
        const result = await mcpPublicationService.readPublicationPlanAsset(projectId, assetRef, maxChars);
        return asToolResult(result);
    });

    server.registerTool('ba_refresh_publication_plan_asset_snapshots', {
        description: 'Refresh stored publication-plan asset snapshots from the runtime filesystem and optional inline content or URL overrides. Use url for large binary/image assets that should be shown in the UI without embedding the full file body.',
        inputSchema: {
            projectId: z.number().int().positive(),
            assetContents: z.record(z.string(), z.object({
                content: z.string().optional(),
                contentType: z.string().optional(),
                url: z.string().optional()
            })).optional().describe('Optional assetRef -> { content?, contentType?, url? } map used when files are not available in the current runtime. For big images/files prefer url + contentType.')
        }
    }, async ({ projectId, assetContents }) => {
        const result = await mcpPublicationService.refreshPublicationPlanAssetSnapshots(projectId, assetContents || {});
        return asToolResult(result);
    });

    server.registerTool('ba_read_publication_plan_ref', {
        description: 'Resolve a publication plan reference such as article_knowledge.target_url or an asset ref and return its value.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            ref: z.string().min(1),
            maxChars: z.number().int().positive().optional().describe('Optional maximum characters to return when the ref resolves to file-backed content.')
        }
    }, async ({ projectId, ref, maxChars }) => {
        const result = await mcpPublicationService.readPublicationPlanRef(projectId, ref, maxChars);
        return asToolResult(result);
    });

    server.registerTool('ba_list_project_channels', {
        description: 'List active and inactive social channels for a planner project. Sensitive config values are redacted.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const channels = await mcpPublicationService.listChannels(projectId);
        return asToolResult({ project_id: projectId, channels });
    });

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
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const result = await mcpPublicationService.preparePublicationTask(projectId, taskId);
        return asToolResult(result);
    });

    server.registerTool('ba_confirm_publication', {
        description: 'Mark a publication task as published after a manual handoff or an external publish step. Already published tasks are read-only and cannot be modified via MCP.',
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

    server.registerTool('ba_publish_direct', {
        description: 'Publish content directly to a configured project channel. Supports reddit, telegram, vk, and linkedin.',
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
    });

    // ============================================
    // TDPD-001 Work Queue MCP Tools
    // ============================================

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

    server.registerTool('ba_get_work_item', {
        description: 'Get details of a specific work item including latest approval decision.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive()
        }
    }, async (args) => {
        const result = await workQueueService.getWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_work_item_context', {
        description: 'Get full execution context for a work item including week frame, thesis, and resolved source resources.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            maxChars: z.number().int().positive().optional()
        }
    }, async (args) => {
        const result = await workQueueService.getWorkItemContext(args);
        return asToolResult(result);
    });

    server.registerTool('ba_claim_work_item', {
        description: 'Atomically claim a work item for execution with a timed lease token.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseSeconds: z.number().int().positive().optional(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.claimWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_complete_work_item', {
        description: 'Complete execution of a work item and submit the result payload, unlocking content review.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseToken: z.string(),
            result: z.object({
                body: z.string().optional(),
                text: z.string().optional(),
                format: z.string().optional()
            }).passthrough(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.completeWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_decide_approval', {
        description: 'Approve or reject a content review work item result version.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            resultVersion: z.number().int(),
            decision: z.enum(['approved', 'rejected']),
            comment: z.string().optional(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.decideApproval(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_schedule_exceptions', {
        description: 'List schedule exceptions (overdue content, missed publication slots, unavailable sources).',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            asOf: z.string().optional(),
            includeBlocked: z.boolean().optional()
        }
    }, async (args) => {
        const result = await workQueueService.listScheduleExceptions(args);
        return asToolResult(result);
    });

    server.registerTool('ba_block_work_item', {
        description: 'Manually block a work item with an explicit reason code.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseToken: z.string(),
            reasonCode: z.string(),
            note: z.string().optional(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.blockWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_release_work_item', {
        description: 'Release a claimed work item lease back to the available queue.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseToken: z.string(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.releaseWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_reschedule_work_item', {
        description: 'Reschedule a work item due date with an explicit audit reason.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            dueAt: z.string(),
            reason: z.string(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.rescheduleWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_upsert_initiative', {
        description: 'Upsert an initiative by project_id and external_key.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            externalKey: z.string(),
            kind: z.string(),
            subtype: z.string().optional(),
            title: z.string(),
            description: z.string().optional(),
            status: z.string().optional(),
            ownerRole: z.string().optional(),
            dueAt: z.string().nullable().optional(),
            startAt: z.string().nullable().optional(),
            endAt: z.string().nullable().optional(),
            decisionAt: z.string().nullable().optional(),
            eventAt: z.string().nullable().optional(),
            measurementAt: z.string().nullable().optional()
        }
    }, async (args) => {
        const result = await initiativeService.upsertInitiative(args);
        return asToolResult(result);
    });

    server.registerTool('ba_link_initiatives', {
        description: 'Link two initiatives with a dependency relationship and cycle detection.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            fromKey: z.string(),
            toKey: z.string(),
            type: z.string().optional(),
            condition: z.string().optional(),
            source: z.string().optional()
        }
    }, async (args) => {
        const result = await initiativeService.linkInitiatives(args);
        return asToolResult(result);
    });

    server.registerTool('ba_import_operational_plan', {
        description: 'Import an operational plan containing initiatives and dependency linkages.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            externalPlan: z.object({
                initiatives: z.array(z.object({
                    external_key: z.string(),
                    kind: z.string(),
                    subtype: z.string().optional(),
                    title: z.string(),
                    description: z.string().optional(),
                    status: z.string().optional(),
                    due_at: z.string().optional(),
                    start_at: z.string().optional(),
                    end_at: z.string().optional(),
                    decision_at: z.string().optional(),
                    event_at: z.string().optional(),
                    measurement_at: z.string().optional()
                })).optional(),
                dependencies: z.array(z.object({
                    from: z.string(),
                    to: z.string(),
                    type: z.string().optional(),
                    condition: z.string().optional()
                })).optional()
            }),
            idempotencyKey: z.string().optional()
        }
    }, async (args) => {
        const result = await initiativeService.importOperationalPlan(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_initiative', {
        description: 'Retrieve an initiative by project_id and external_key.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            externalKey: z.string()
        }
    }, async (args) => {
        const result = await initiativeService.getInitiative(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_initiatives', {
        description: 'List initiatives for a project with optional filtering.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            filter: z.object({
                kind: z.string().optional(),
                status: z.string().optional()
            }).optional()
        }
    }, async (args) => {
        const result = await initiativeService.listInitiatives(args);
        return asToolResult(result);
    });

    server.registerTool('ba_audit_plan_coverage', {
        description: 'Audit external plan coverage against current database initiatives.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            externalPlan: z.object({
                initiatives: z.array(z.object({
                    external_key: z.string(),
                    kind: z.string()
                })).optional()
            })
        }
    }, async (args) => {
        const result = await initiativeService.auditPlanCoverage(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_release_readiness', {
        description: 'Evaluate release readiness for a target initiative based on incoming blocker states.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            initiativeKey: z.string()
        }
    }, async (args) => {
        const result = await initiativeService.getReleaseReadiness(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_release_blockers', {
        description: 'List release blockers and downstream impact for overdue initiatives.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            asOf: z.string().optional()
        }
    }, async (args) => {
        const result = await initiativeService.listReleaseBlockers(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_operational_calendar', {
        description: 'Returns operational calendar items with explicit date_type preserved.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            fromDate: z.string(),
            toDate: z.string()
        }
    }, async (args) => {
        const result = await initiativeService.getOperationalCalendar(args);
        return asToolResult(result);
    });

    server.registerTool('ba_sync_task_tracker', {
        description: 'Synchronize a WorkItem projection with external task tracker (Plane).',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            idempotencyKey: z.string().optional()
        }
    }, async (args) => {
        const result = await taskTrackerService.syncTaskTracker(args);
        return asToolResult(result);
    });

    server.registerTool('ba_process_outbox', {
        description: 'Process outbox events for task tracker sync and retry delivery.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            simulateUnreachable: z.boolean().optional(),
            staleOutboxItem: z.object({
                workItemId: z.number().int().positive(),
                syncVersion: z.number().int(),
                lastSyncedVersion: z.number().int()
            }).optional()
        }
    }, async (args) => {
        const result = await taskTrackerService.processOutbox(args);
        return asToolResult(result);
    });

    server.registerTool('ba_receive_webhook', {
        description: 'Process and deduplicate incoming webhook payloads from external task tracker.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            payload: z.object({
                event_id: z.string(),
                action: z.string().optional(),
                issue_id: z.string().optional(),
                state: z.string().optional()
            }).passthrough()
        }
    }, async (args) => {
        const result = await taskTrackerService.receiveWebhook(args);
        return asToolResult(result);
    });

    server.registerTool('ba_reconcile_task_tracker', {
        description: 'Reconcile Planner WorkItem states with external task tracker states.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            autoRepair: z.boolean().optional()
        }
    }, async (args) => {
        const result = await taskTrackerService.reconcileTaskTracker(args);
        return asToolResult(result);
    });

    server.registerTool('ba_execute_delivery', {
        description: 'Execute publication delivery attempt to a target channel.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            contentItemId: z.number().int().positive(),
            channelId: z.number().int().positive(),
            forceAutomatic: z.boolean().optional(),
            unapproved: z.boolean().optional(),
            simulateFailure: z.boolean().optional(),
            idempotencyKey: z.string().optional(),
            scheduledAt: z.string().optional()
        }
    }, async (args) => {
        const result = await deliveryService.executeDelivery(args);
        return asToolResult(result);
    });

    server.registerTool('ba_recover_delivery', {
        description: 'Recover a failed delivery attempt manually or via retry worker.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            deliveryAttemptId: z.number().int().positive()
        }
    }, async (args) => {
        const result = await deliveryService.recoverDelivery(args);
        return asToolResult(result);
    });

    server.registerTool('ba_generate_image_asset', {
        description: 'Generate an image asset candidate for a content item.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            contentItemId: z.number().int().positive(),
            prompt: z.string(),
            provider: z.string().optional(),
            model: z.string().optional(),
            seed: z.number().int().optional(),
            promptVersion: z.number().int().optional(),
            altText: z.string().optional(),
            aspectRatio: z.string().optional()
        }
    }, async (args) => {
        const result = await imageAssetService.generateImageAsset(args);
        return asToolResult(result);
    });

    server.registerTool('ba_review_image_asset', {
        description: 'Review an image asset candidate (approve or reject).',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            assetId: z.number().int().positive(),
            decision: z.enum(['approved', 'rejected']),
            reason: z.string().optional()
        }
    }, async (args) => {
        const result = await imageAssetService.reviewImageAsset(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_image_assets', {
        description: 'List all generated image asset versions for a content item.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            contentItemId: z.number().int().positive()
        }
    }, async (args) => {
        const result = await imageAssetService.listImageAssets(args);
        return asToolResult(result);
    });




}

export async function shutdownMcpResources() {
    try {
        await prisma.$disconnect();
    } catch (_error) {
        // Ignore shutdown errors.
    }

    try {
        await pool.end();
    } catch (_error) {
        // Ignore shutdown errors.
    }
}
