import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import prisma, { pool } from '../db';
import mcpPublicationService from '../services/mcp_publication.service';
import workQueueService from '../services/work_queue.service';
import initiativeService from '../services/initiative.service';
import taskTrackerService from '../services/task_tracker.service';
import deliveryService from '../services/delivery.service';
import imageAssetService from '../services/image_asset.service';
import artDirectionService from '../services/art_direction.service';
import metricsService from '../services/metrics.service';
import publicationFactService from '../services/publication_fact.service';
import weekPackageRepairService from '../services/week_package_repair.service';
import weeklyThemePipelineService from '../services/weekly_theme_pipeline.service';
import telegramTaskPublicationService from '../services/telegram_task_publication.service';
import { filterMcpServerTools, McpCapabilityProfile } from './capabilities';
import { getAgentChatBootstrap, getAgentWorkspaceUpdate, loadAgentWorkspaceManifest } from '../services/agent_workspace_manifest.service';






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

export function asTelegramRouteToolError(error: any) {
    if (!error?.routeTrace) return null;
    return {
        ...asToolResult({
            mode: 'failed',
            error: String(error?.message || error || 'Telegram publication failed'),
            route_trace: error.routeTrace
        }),
        isError: true
    };
}

export function createPlannerMcpServer(options: { profile?: McpCapabilityProfile } = {}) {
    const server = new McpServer({
        name: 'ba-post-planner-publication',
        version: '1.0.0'
    });

    registerPlannerTools(server);
    return filterMcpServerTools(server, options.profile || 'owner');
}

export function registerPlannerTools(server: McpServer) {
    server.registerTool('ba_get_agent_workspace_manifest', {
        description: 'Return the canonical, versioned and secret-free chat topology for a planner project.',
        annotations: { readOnlyHint: true },
        inputSchema: { projectId: z.number().int().positive(), userId: z.number().int().positive() }
    }, async ({ projectId, userId }) => asToolResult({ manifest: await loadAgentWorkspaceManifest(projectId, userId) }));

    server.registerTool('ba_get_agent_workspace_updates', {
        description: 'Compare a known workspace checksum with the current planner configuration and return a fresh snapshot only when it changed.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            userId: z.number().int().positive(),
            knownChecksum: z.string().optional()
        }
    }, async ({ projectId, userId, knownChecksum }) => asToolResult(getAgentWorkspaceUpdate(await loadAgentWorkspaceManifest(projectId, userId), knownChecksum)));

    server.registerTool('ba_get_agent_chat_bootstrap', {
        description: 'Return role-scoped startup instructions, permissions and handoffs for one chat in the canonical agent workspace.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            userId: z.number().int().positive(),
            chatId: z.string().min(1)
        }
    }, async ({ projectId, userId, chatId }) => asToolResult(await getAgentChatBootstrap(projectId, userId, chatId)));

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

    server.registerTool('ba_update_publication_content', {
        description: 'Replace only the editable publication body for an existing slot. Slot topic, channel, schedule and lifecycle status remain unchanged.',
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

    server.registerTool('ba_record_publication_fact', {
        description: 'Record or explicitly correct the canonical publication fact. Published posts/articles/comments require a permalink; stories require stable identity and evidence.',
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
        } catch (error: any) {
            const toolError = asTelegramRouteToolError(error);
            if (!toolError) throw error;
            return toolError;
        }
    });

    server.registerTool('ba_publish_publication_task', {
        description: 'Publish one canonical Telegram or VK task through its configured provider API. The server resolves accepted text and the selected approved durable visual; no browser fallback or silent visual downgrade is used.',
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            dryRun: z.boolean().optional().describe('Validate and return the exact normalized MTProto payload without sending.'),
            idempotencyKey: z.string().min(1).max(500).optional().describe('Required for live publication and reused to safely replay a confirmed result.')
        }
    }, async (args) => asToolResult(await telegramTaskPublicationService.execute(args)));

    // ============================================
    // TDPD-001 Work Queue MCP Tools
    // ============================================

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

    server.registerTool('ba_recover_content_review', {
        description: 'Owner-only audited recovery: expose an existing publication content revision as a separately approvable review result without changing its body, channel, schedule, CTA or UTM data.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            taskId: z.number().int().positive(),
            workItemId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            idempotencyKey: z.string(),
            evidence: z.string().optional()
        }
    }, async (args) => {
        const result = await workQueueService.recoverContentReview(args);
        return asToolResult(result);
    });

    server.registerTool('ba_recover_missing_content_review', {
        description: 'Owner-only audited recovery: create a missing content-review gate for an existing unaccepted revision without changing publication content, slot fields or accepting the revision.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            taskId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            idempotencyKey: z.string(),
            evidenceRequirement: z.string().optional()
        }
    }, async (args) => {
        const result = await workQueueService.recoverMissingContentReview(args);
        return asToolResult(result);
    });

    server.registerTool('ba_repair_publication_placement', {
        description: 'Owner-only audited metadata repair for an unpublished accepted publication: atomically change only channel and canonical visual placement and create a new revision-bound art-direction work item. The target placement must match the configured channel contract.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            taskId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedChannelId: z.number().int().positive(),
            expectedPlacement: z.string(),
            targetChannelId: z.number().int().positive(),
            targetPlacement: z.string(),
            blockedWorkItemId: z.number().int().positive(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.repairPublicationPlacement(args);
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
            kind: z.enum(['publication', 'event', 'campaign', 'infrastructure']),
            subtype: z.string().optional(),
            title: z.string(),
            description: z.string().optional(),
            status: z.enum(['planned', 'in_progress', 'completed', 'blocked', 'cancelled']).optional(),
            ownerRole: z.string().optional(),
            dueAt: z.string().datetime({ offset: true }).nullable().optional(),
            startAt: z.string().datetime({ offset: true }).nullable().optional(),
            endAt: z.string().datetime({ offset: true }).nullable().optional(),
            decisionAt: z.string().datetime({ offset: true }).nullable().optional(),
            eventAt: z.string().datetime({ offset: true }).nullable().optional(),
            measurementAt: z.string().datetime({ offset: true }).nullable().optional()
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
            type: z.enum(['blocks', 'requires', 'not_before', 'informs']).optional(),
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
                    kind: z.enum(['publication', 'event', 'campaign', 'infrastructure']),
                    subtype: z.string().optional(),
                    title: z.string(),
                    description: z.string().optional(),
                    status: z.enum(['planned', 'in_progress', 'completed', 'blocked', 'cancelled']).optional(),
                    due_at: z.string().datetime({ offset: true }).optional(),
                    start_at: z.string().datetime({ offset: true }).optional(),
                    end_at: z.string().datetime({ offset: true }).optional(),
                    decision_at: z.string().datetime({ offset: true }).optional(),
                    event_at: z.string().datetime({ offset: true }).optional(),
                    measurement_at: z.string().datetime({ offset: true }).optional()
                })).optional(),
                dependencies: z.array(z.object({
                    from: z.string(),
                    to: z.string(),
                    type: z.enum(['blocks', 'requires', 'not_before', 'informs']).optional(),
                    condition: z.string().optional()
                })).optional()
            }),
            idempotencyKey: z.string().optional()
        }
    }, async (args) => {
        const result = await initiativeService.importOperationalPlan(args);
        return asToolResult(result);
    });

    server.registerTool('ba_materialize_publication_task', {
        description: 'Create or update the execution workspace linked to one publication initiative. Safe to retry with the same idempotency key and payload.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            initiativeKey: z.string().min(1),
            draftText: z.string().optional(),
            brief: z.string().optional(),
            channelId: z.number().int().positive().optional(),
            publicationMode: z.enum(['manual_handoff', 'approval_required', 'automatic']),
            scheduleAt: z.string().datetime({ offset: true }).optional(),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => {
        const result = await initiativeService.materializePublicationTask(args);
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
                    kind: z.enum(['publication', 'event', 'campaign', 'infrastructure']),
                    due_at: z.string().datetime({ offset: true }).optional(),
                    start_at: z.string().datetime({ offset: true }).optional(),
                    end_at: z.string().datetime({ offset: true }).optional(),
                    decision_at: z.string().datetime({ offset: true }).optional(),
                    event_at: z.string().datetime({ offset: true }).optional(),
                    measurement_at: z.string().datetime({ offset: true }).optional()
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
            asOf: z.string().datetime({ offset: true }).optional()
        }
    }, async (args) => {
        const result = await initiativeService.listReleaseBlockers(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_operational_calendar', {
        description: 'Returns one operational view with typed calendar dates, readiness, overdue initiatives, and layer summary.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            asOf: z.string().datetime({ offset: true }).optional()
        }
    }, async (args) => {
        const result = await initiativeService.getOperationalCalendarView(args);
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
        description: 'Legacy recovery entrypoint. Unsafe status-only recovery is disabled; retry the canonical publication task instead.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            deliveryAttemptId: z.number().int().positive()
        }
    }, async (args) => {
        const result = await deliveryService.recoverDelivery(args);
        return asToolResult(result);
    });

    server.registerTool('ba_invalidate_false_deliveries', {
        description: 'Owner-only audited correction for legacy delivery attempts that claimed success without a canonical provider permalink or object identity. Does not modify publication content or facts.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            contentItemId: z.number().int().positive(),
            attemptIds: z.array(z.number().int().positive()).min(1),
            reason: z.string().min(1).max(1800),
            idempotencyKey: z.string().min(1).max(500)
        }
    }, async (args) => asToolResult(await deliveryService.invalidateFalseDeliveries(args)));

    server.registerTool('ba_generate_image_asset', {
        description: 'Register a generated image candidate only after the weekly plan and current text revision are accepted and an active GENERATE art-direction decision exists. Requires the stored image URL and alt text; the asset remains blocked until visual review.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            contentItemId: z.number().int().positive(),
            prompt: z.string(),
            provider: z.string().optional(),
            model: z.string().optional(),
            seed: z.number().int().optional(),
            promptVersion: z.number().int().optional(),
            altText: z.string().min(1),
            aspectRatio: z.string().optional()
            ,decisionId: z.number().int().positive()
            ,contentRevision: z.number().int().positive().optional()
            ,placement: z.string().optional()
            ,fileUrl: z.string().min(1).optional()
            ,fileDataBase64: z.string().min(1).optional()
            ,fileName: z.string().min(1).optional()
            ,mimeType: z.string().min(1).optional()
            ,provenance: z.record(z.string(), z.unknown()).optional()
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
            ,qaReport: z.record(z.string(), z.unknown()).optional()
        }
    }, async (args) => {
        const result = await imageAssetService.reviewImageAsset(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_art_direction_context', {
        description: 'Read accepted copy, placement, visual mode and recent assets for an art-direction work item.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive()
        }
    }, async (args) => asToolResult(await artDirectionService.getContext(args.projectId, args.workItemId)));

    server.registerTool('ba_submit_art_direction_decision', {
        description: 'Submit a revision-bound visual-fit decision. Generated visuals remain blocked until separate review approval.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), workItemId: z.number().int().positive(),
            leaseToken: z.string(), idempotencyKey: z.string(),
            decision: z.object({
                decision: z.enum(['NO_VISUAL_NEEDED', 'GENERATE', 'SOURCE_REQUIRED', 'MANUAL_ASSET_REQUIRED', 'BLOCKED']),
                source_content_revision: z.number().int().positive(), channel: z.string(), placement: z.string(),
                visual_function: z.string().nullable().optional(), reason: z.string(), post_owns: z.string().nullable().optional(),
                visual_adds: z.string().nullable().optional(), loss_without_visual: z.string().nullable().optional(),
                authenticity_class: z.enum(['ACTUAL_EVIDENCE', 'OWNER_DOCUMENTATION', 'CONCEPTUAL_EDITORIAL', 'SIMULATED_DOCUMENTATION']).nullable().optional(),
                evidence_refs: z.array(z.unknown()).optional(), visual_format: z.string().nullable().optional(),
                dimensions: z.object({ width: z.number().optional(), height: z.number().optional(), aspect_ratio: z.string().optional() }).nullable().optional(),
                required_text: z.array(z.string()).optional(), forbidden_text: z.array(z.string()).optional(),
                visible_copy_budget: z.number().int().nullable().optional(), prompt: z.string().nullable().optional(),
                alt_text: z.string().nullable().optional(), acceptance_criteria: z.array(z.string()).optional(), recent_asset_refs: z.array(z.unknown()).optional()
            })
        }
    }, async (args) => asToolResult(await artDirectionService.submitDecision(args) as Record<string, unknown>));

    server.registerTool('ba_get_visual_readiness', {
        description: 'Return the authoritative publication visual gate for a content item.',
        annotations: { readOnlyHint: true },
        inputSchema: { projectId: z.number().int().positive(), actorId: z.string(), contentItemId: z.number().int().positive() }
    }, async (args) => asToolResult(await artDirectionService.getReadiness(args.projectId, args.contentItemId)));

    server.registerTool('ba_set_art_direction_pipeline', {
        description: 'Enable or disable the revision-bound art-direction pipeline for a project. Owner profile only.',
        inputSchema: { projectId: z.number().int().positive(), actorId: z.string(), enabled: z.boolean() }
    }, async (args) => {
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: args.projectId, key: 'art_direction_pipeline_enabled' } },
            update: { value: String(args.enabled) },
            create: { project_id: args.projectId, key: 'art_direction_pipeline_enabled', value: String(args.enabled) }
        });
        return asToolResult({ project_id: args.projectId, enabled: args.enabled });
    });

    server.registerTool('ba_backfill_art_direction_pipeline', {
        description: 'Explicitly queue visual-fit assessment for existing unpublished content after the project feature is enabled. Published and terminal items are never changed.',
        inputSchema: { projectId: z.number().int().positive(), actorId: z.string() }
    }, async (args) => asToolResult(await artDirectionService.backfillProject(args.projectId, args.actorId)));

    server.registerTool('ba_attach_visual_source', {
        description: 'Attach a real source or owner-provided visual with provenance to the current accepted revision. Local files must be sent as base64 so Planner can ingest them into durable managed storage.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), contentItemId: z.number().int().positive(),
            fileUrl: z.string().url().optional(), fileDataBase64: z.string().min(1).optional(),
            fileName: z.string().min(1).optional(), mimeType: z.string().min(1).optional(),
            provenance: z.record(z.string(), z.unknown()), altText: z.string().optional()
        }
    }, async (args) => asToolResult(await artDirectionService.attachVisualSource(args)));

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

    server.registerTool('ba_record_metric_snapshot', {
        description: 'Record a T+24h/T+7d metric snapshot with per-field observed/unknown/not-supported semantics.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            contentItemId: z.number().int().positive(),
            channelId: z.number().int().positive(),
            checkpoint: z.string(),
            metrics: z.record(z.string(), z.unknown()),
            scheduledFor: z.string().datetime({ offset: true }).optional(),
            capturedAt: z.string().datetime({ offset: true }).optional(),
            collectionMode: z.enum(['automatic', 'manual', 'imported']).optional(),
            source: z.enum(['provider_api', 'public_page', 'yandex_metrika', 'manual']).optional(),
            collectionStatus: z.enum(['pending', 'collected', 'partial', 'unknown', 'not_supported', 'failed', 'overdue']).optional(),
            evidenceRef: z.string().max(2000).optional(),
            errorCode: z.string().max(200).optional(),
            errorMessage: z.string().max(500).optional(),
            windowStart: z.string().datetime({ offset: true }).optional(),
            windowEnd: z.string().datetime({ offset: true }).optional(),
            idempotencyKey: z.string().optional()
        }
    }, async (args) => {
        const result = await metricsService.recordMetricSnapshot(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_content_metrics', {
        description: 'Get all recorded metric snapshots and consolidated metrics for a content item.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            contentItemId: z.number().int().positive()
        }
    }, async (args) => {
        const result = await metricsService.getContentMetrics(args);
        return asToolResult(result);
    });

    server.registerTool('ba_rollup_campaign_metrics', {
        description: 'Aggregate and rollup campaign metrics across channels and content items.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            initiativeKey: z.string()
        }
    }, async (args) => {
        const result = await metricsService.rollupCampaignMetrics(args);
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
