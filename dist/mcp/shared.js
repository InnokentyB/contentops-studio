"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.asToolResult = asToolResult;
exports.createPlannerMcpServer = createPlannerMcpServer;
exports.registerPlannerTools = registerPlannerTools;
exports.shutdownMcpResources = shutdownMcpResources;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const db_1 = __importStar(require("../db"));
const mcp_publication_service_1 = __importDefault(require("../services/mcp_publication.service"));
const work_queue_service_1 = __importDefault(require("../services/work_queue.service"));
const initiative_service_1 = __importDefault(require("../services/initiative.service"));
const task_tracker_service_1 = __importDefault(require("../services/task_tracker.service"));
const delivery_service_1 = __importDefault(require("../services/delivery.service"));
const image_asset_service_1 = __importDefault(require("../services/image_asset.service"));
const metrics_service_1 = __importDefault(require("../services/metrics.service"));
const capabilities_1 = require("./capabilities");
function asToolResult(payload) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2)
            }
        ],
        structuredContent: payload
    };
}
function createPlannerMcpServer(options = {}) {
    const server = new mcp_js_1.McpServer({
        name: 'ba-post-planner-publication',
        version: '1.0.0'
    });
    registerPlannerTools(server);
    return (0, capabilities_1.filterMcpServerTools)(server, options.profile || 'owner');
}
function registerPlannerTools(server) {
    server.registerTool('ba_get_publication_plan_format', {
        description: 'Return the preferred machine-readable publication-plan contract for chat/MCP authoring.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {}
    }, async () => {
        const format = mcp_publication_service_1.default.getPublicationPlanFormat();
        return asToolResult({ format });
    });
    server.registerTool('ba_get_publication_plan_template', {
        description: 'Return a ready-to-fill publication-plan JSON template for chat-based authoring.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            planId: zod_1.z.string().optional(),
            projectName: zod_1.z.string().optional(),
            owner: zod_1.z.string().optional(),
            timezone: zod_1.z.string().optional(),
            channelRef: zod_1.z.string().optional(),
            channelPlatform: zod_1.z.string().optional()
        }
    }, async (input) => {
        const template = mcp_publication_service_1.default.getPublicationPlanTemplate(input);
        return asToolResult({ template });
    });
    server.registerTool('ba_normalize_publication_plan_json', {
        description: 'Validate and normalize a publication-plan JSON payload produced by chat before import.',
        inputSchema: {
            planJson: zod_1.z.string().min(2)
        }
    }, async ({ planJson }) => {
        const result = mcp_publication_service_1.default.normalizePublicationPlan(planJson);
        return asToolResult(result);
    });
    server.registerTool('ba_list_users', {
        description: 'List planner users with their IDs and linked umbrella projects.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            includeArchivedProjects: zod_1.z.boolean().optional()
        }
    }, async ({ includeArchivedProjects }) => {
        const users = await mcp_publication_service_1.default.listUsers({ includeArchivedProjects });
        return asToolResult({ users });
    });
    server.registerTool('ba_get_user', {
        description: 'Fetch one planner user by ID, including linked projects and roles.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            includeArchivedProjects: zod_1.z.boolean().optional()
        }
    }, async ({ userId, includeArchivedProjects }) => {
        const user = await mcp_publication_service_1.default.getUser(userId, { includeArchivedProjects });
        return asToolResult({ user });
    });
    server.registerTool('ba_list_projects', {
        description: 'List planner projects that can be used for publication workflows.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive().optional(),
            includeArchived: zod_1.z.boolean().optional()
        }
    }, async ({ userId, includeArchived }) => {
        const projects = await mcp_publication_service_1.default.listProjects({ userId, includeArchived });
        return asToolResult({ projects });
    });
    server.registerTool('ba_create_project', {
        description: 'Create a new umbrella project that can hold multiple channels, content items, parser results, and publication tasks.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1),
            slug: zod_1.z.string().optional(),
            description: zod_1.z.string().optional(),
            kind: zod_1.z.string().optional().describe('Optional project kind. Defaults to content_network.')
        }
    }, async ({ userId, name, slug, description, kind }) => {
        const result = await mcp_publication_service_1.default.createProject({ userId, name, slug, description, kind });
        return asToolResult(result);
    });
    server.registerTool('ba_update_project', {
        description: 'Update umbrella project metadata such as name, slug, description, or kind.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().optional(),
            slug: zod_1.z.string().optional(),
            description: zod_1.z.string().nullable().optional(),
            kind: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, name, slug, description, kind }) => {
        const result = await mcp_publication_service_1.default.updateProject({ userId, projectId, name, slug, description, kind });
        return asToolResult(result);
    });
    server.registerTool('ba_archive_project', {
        description: 'Archive or unarchive a project while keeping its channels and content network intact.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            archived: zod_1.z.boolean().optional().describe('Defaults to true. Pass false to unarchive a project.')
        }
    }, async ({ userId, projectId, archived }) => {
        const result = await mcp_publication_service_1.default.archiveProject({ userId, projectId, archived });
        return asToolResult(result);
    });
    server.registerTool('ba_parser_health', {
        description: 'Check parser connectivity from the planner context for a specific project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcp_publication_service_1.default.getParserHealth(projectId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_create_search_job', {
        description: 'Create and queue a parser search job for a planner project.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            source: zod_1.z.enum(['reddit', 'indie_hackers']).optional(),
            query: zod_1.z.string().min(1),
            subreddit: zod_1.z.string().optional(),
            subreddits: zod_1.z.array(zod_1.z.string()).optional(),
            queryDefinitionId: zod_1.z.string().optional(),
            intent: zod_1.z.string().optional(),
            cluster: zod_1.z.string().optional(),
            priority: zod_1.z.number().int().optional(),
            matchMustIncludeAny: zod_1.z.array(zod_1.z.string()).optional(),
            excludeIfContains: zod_1.z.array(zod_1.z.string()).optional(),
            excludeRegexes: zod_1.z.array(zod_1.z.string()).optional(),
            limit: zod_1.z.number().int().positive().optional(),
            minScore: zod_1.z.number().int().optional(),
            dateFrom: zod_1.z.string().optional(),
            dateTo: zod_1.z.string().optional(),
            includeComments: zod_1.z.boolean().optional(),
            enrich: zod_1.z.boolean().optional(),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async (input) => {
        const result = await mcp_publication_service_1.default.createParserSearchJob(input);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_get_search_job', {
        description: 'Fetch one parser search job and its latest run state for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            jobId: zod_1.z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcp_publication_service_1.default.getParserSearchJob(projectId, jobId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_refresh_search_job', {
        description: 'Queue a refresh run for an existing parser search job.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            jobId: zod_1.z.string().min(1),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, jobId, idempotencyKey }) => {
        const result = await mcp_publication_service_1.default.refreshParserSearchJob(projectId, jobId, userId, idempotencyKey);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_list_posts', {
        description: 'List parser-normalized posts available to a planner project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            limit: zod_1.z.number().int().positive().optional(),
            offset: zod_1.z.number().int().nonnegative().optional()
        }
    }, async ({ userId, projectId, limit, offset }) => {
        const result = await mcp_publication_service_1.default.listParserPosts(projectId, userId, limit, offset);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_get_insights', {
        description: 'List planner-friendly parser insights for a project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            limit: zod_1.z.number().int().positive().optional(),
            offset: zod_1.z.number().int().nonnegative().optional(),
            jobId: zod_1.z.string().optional(),
            type: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, limit, offset, jobId, type }) => {
        const result = await mcp_publication_service_1.default.getParserInsights(projectId, userId, {
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
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            jobId: zod_1.z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcp_publication_service_1.default.getParserSummary(projectId, jobId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_list_templates', {
        description: 'List saved parser search templates for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcp_publication_service_1.default.listParserTemplates(projectId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_import_templates', {
        description: 'Import parser search templates from YAML content or a structured query bank.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            yamlContent: zod_1.z.string().optional(),
            queryBank: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
            scheduleDaily: zod_1.z.boolean().optional(),
            limit: zod_1.z.number().int().positive().optional(),
            minScore: zod_1.z.number().int().optional(),
            dateFrom: zod_1.z.string().optional(),
            dateTo: zod_1.z.string().optional(),
            includeComments: zod_1.z.boolean().optional(),
            enrich: zod_1.z.boolean().optional(),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async (input) => {
        const result = await mcp_publication_service_1.default.importParserTemplates(input);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_run_template', {
        description: 'Queue an immediate parser run for a saved template.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            templateId: zod_1.z.string().min(1),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, templateId, idempotencyKey }) => {
        const result = await mcp_publication_service_1.default.runParserTemplate(projectId, templateId, userId, idempotencyKey);
        return asToolResult(result);
    });
    server.registerTool('ba_import_publication_plan_json', {
        description: 'Import a publication plan JSON payload into the planner. Default mode is delta_safe: add/update only the incoming delta and preserve existing runtime content. Use full_sync only when you explicitly want missing imported tasks to be removed.',
        inputSchema: {
            userId: zod_1.z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planJson: zod_1.z.string().min(2).describe('Full publication plan JSON string with meta.plan_id, accounts, assets, and actions[].'),
            workspaceRoots: zod_1.z.array(zod_1.z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.'),
            importMode: zod_1.z.enum(['delta_safe', 'full_sync']).optional().describe('delta_safe preserves existing tasks/assets and only applies the incoming delta. full_sync also deletes missing imported tasks.')
        }
    }, async ({ userId, planJson, workspaceRoots, importMode }) => {
        const result = await mcp_publication_service_1.default.importPublicationPlanJson(planJson, userId, workspaceRoots, importMode || 'delta_safe');
        return asToolResult(result);
    });
    server.registerTool('ba_import_publication_plan_delta_json', {
        description: 'Safely import only the incoming publication-plan delta from a JSON payload. Existing tasks stay in place, missing tasks are not removed, and published/completed runtime content is preserved.',
        inputSchema: {
            userId: zod_1.z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planJson: zod_1.z.string().min(2).describe('Partial or full publication plan JSON string with meta.plan_id, accounts, assets, and actions[].'),
            workspaceRoots: zod_1.z.array(zod_1.z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.')
        }
    }, async ({ userId, planJson, workspaceRoots }) => {
        const result = await mcp_publication_service_1.default.importPublicationPlanJson(planJson, userId, workspaceRoots, 'delta_safe');
        return asToolResult(result);
    });
    server.registerTool('ba_import_publication_plan_file', {
        description: 'Import a publication plan from a local JSON file path. Default mode is delta_safe: add/update only the incoming delta and preserve existing runtime content. Use full_sync only when you explicitly want missing imported tasks to be removed.',
        inputSchema: {
            userId: zod_1.z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planPath: zod_1.z.string().min(1).describe('Absolute or local filesystem path to a publication plan JSON file.'),
            workspaceRoots: zod_1.z.array(zod_1.z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.'),
            importMode: zod_1.z.enum(['delta_safe', 'full_sync']).optional().describe('delta_safe preserves existing tasks/assets and only applies the incoming delta. full_sync also deletes missing imported tasks.')
        }
    }, async ({ userId, planPath, workspaceRoots, importMode }) => {
        const result = await mcp_publication_service_1.default.importPublicationPlanFile(planPath, userId, workspaceRoots, importMode || 'delta_safe');
        return asToolResult(result);
    });
    server.registerTool('ba_import_publication_plan_delta_file', {
        description: 'Safely import only the incoming publication-plan delta from a local JSON file. Existing tasks stay in place, missing tasks are not removed, and published/completed runtime content is preserved.',
        inputSchema: {
            userId: zod_1.z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planPath: zod_1.z.string().min(1).describe('Absolute or local filesystem path to a publication plan JSON file.'),
            workspaceRoots: zod_1.z.array(zod_1.z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.')
        }
    }, async ({ userId, planPath, workspaceRoots }) => {
        const result = await mcp_publication_service_1.default.importPublicationPlanFile(planPath, userId, workspaceRoots, 'delta_safe');
        return asToolResult(result);
    });
    server.registerTool('ba_list_publication_plan_assets', {
        description: 'List file-backed assets from an imported publication plan for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const result = await mcp_publication_service_1.default.listPublicationPlanAssets(projectId);
        return asToolResult(result);
    });
    server.registerTool('ba_read_publication_plan_asset', {
        description: 'Read the content of a file-backed asset from an imported publication plan.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            assetRef: zod_1.z.string().min(1),
            maxChars: zod_1.z.number().int().positive().optional().describe('Optional maximum characters to return, default 20000.')
        }
    }, async ({ projectId, assetRef, maxChars }) => {
        const result = await mcp_publication_service_1.default.readPublicationPlanAsset(projectId, assetRef, maxChars);
        return asToolResult(result);
    });
    server.registerTool('ba_refresh_publication_plan_asset_snapshots', {
        description: 'Refresh stored publication-plan asset snapshots from the runtime filesystem and optional inline content or URL overrides. Use url for large binary/image assets that should be shown in the UI without embedding the full file body.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            assetContents: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
                content: zod_1.z.string().optional(),
                contentType: zod_1.z.string().optional(),
                url: zod_1.z.string().optional()
            })).optional().describe('Optional assetRef -> { content?, contentType?, url? } map used when files are not available in the current runtime. For big images/files prefer url + contentType.')
        }
    }, async ({ projectId, assetContents }) => {
        const result = await mcp_publication_service_1.default.refreshPublicationPlanAssetSnapshots(projectId, assetContents || {});
        return asToolResult(result);
    });
    server.registerTool('ba_read_publication_plan_ref', {
        description: 'Resolve a publication plan reference such as article_knowledge.target_url or an asset ref and return its value.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            ref: zod_1.z.string().min(1),
            maxChars: zod_1.z.number().int().positive().optional().describe('Optional maximum characters to return when the ref resolves to file-backed content.')
        }
    }, async ({ projectId, ref, maxChars }) => {
        const result = await mcp_publication_service_1.default.readPublicationPlanRef(projectId, ref, maxChars);
        return asToolResult(result);
    });
    server.registerTool('ba_list_project_channels', {
        description: 'List active and inactive social channels for a planner project. Sensitive config values are redacted.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const channels = await mcp_publication_service_1.default.listChannels(projectId);
        return asToolResult({ project_id: projectId, channels });
    });
    server.registerTool('ba_list_publication_tasks', {
        description: 'List ContentItem-based publication tasks for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            status: zod_1.z.string().optional().describe("Optional task status, or use 'active' for the main queue view."),
            manualOnly: zod_1.z.boolean().optional()
        }
    }, async ({ projectId, status, manualOnly }) => {
        const tasks = await mcp_publication_service_1.default.listPublicationTasks(projectId, status, manualOnly);
        return asToolResult({ project_id: projectId, tasks });
    });
    server.registerTool('ba_get_publication_task', {
        description: 'Fetch the full details of a single publication task.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const task = await mcp_publication_service_1.default.getPublicationTask(projectId, taskId);
        return asToolResult({ project_id: projectId, task });
    });
    server.registerTool('ba_get_publication_task_resources', {
        description: 'Read the resolved resource files for a publication task, including action content files and asset-backed content.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive(),
            maxChars: zod_1.z.number().int().positive().optional().describe('Optional maximum characters per resource, default 12000.')
        }
    }, async ({ projectId, taskId, maxChars }) => {
        const result = await mcp_publication_service_1.default.getPublicationTaskResources(projectId, taskId, maxChars);
        return asToolResult(result);
    });
    server.registerTool('ba_prepare_publication_task', {
        description: 'Prepare or reuse a handoff bundle for a publication task before manual publication. Already published tasks are read-only and cannot be modified via MCP.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const result = await mcp_publication_service_1.default.preparePublicationTask(projectId, taskId);
        return asToolResult(result);
    });
    server.registerTool('ba_update_publication_content', {
        description: 'Replace only the editable publication body for an existing slot. Slot topic, channel, schedule and lifecycle status remain unchanged.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive(),
            body: zod_1.z.string().max(200000),
            expectedRevision: zod_1.z.number().int().nonnegative()
        }
    }, async ({ projectId, taskId, body, expectedRevision }) => {
        const task = await mcp_publication_service_1.default.updatePublicationContent({ projectId, taskId, body, expectedRevision });
        return asToolResult({ project_id: projectId, task });
    });
    server.registerTool('ba_confirm_publication', {
        description: 'Mark a publication task as published after a manual handoff or an external publish step. Already published tasks are read-only and cannot be modified via MCP.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive(),
            publishedLink: zod_1.z.string().url(),
            note: zod_1.z.string().optional(),
            outcome: zod_1.z.enum(['published', 'blocked', 'removed', 'restricted']).optional()
        }
    }, async ({ projectId, taskId, publishedLink, note, outcome }) => {
        const task = await mcp_publication_service_1.default.confirmPublication(projectId, taskId, publishedLink, note, outcome);
        return asToolResult({ project_id: projectId, task });
    });
    server.registerTool('ba_publish_direct', {
        description: 'Publish content directly to a configured project channel. Supports reddit, telegram, vk, and linkedin.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            channelId: zod_1.z.number().int().positive().optional(),
            channelType: zod_1.z.enum(['reddit', 'telegram', 'vk', 'linkedin']).optional(),
            title: zod_1.z.string().optional().describe('Required for reddit publication.'),
            text: zod_1.z.string().min(1),
            subreddit: zod_1.z.string().optional().describe('Required for reddit publication. Example: artificial or r/artificial'),
            imageUrl: zod_1.z.string().optional().describe('Optional remote URL, data URI, or /uploads/... path supported by the channel adapter.'),
            dryRun: zod_1.z.boolean().optional().describe('When true, validate channel resolution and preview the payload without publishing.')
        }
    }, async ({ projectId, channelId, channelType, title, text, subreddit, imageUrl, dryRun }) => {
        const result = await mcp_publication_service_1.default.publishDirect({
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
    server.registerTool('ba_bind_service_identity', {
        description: 'Allow a registered service identity to access one project. Project owner only.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            serviceActorId: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.bindServiceIdentity(args);
        return asToolResult(result);
    });
    server.registerTool('ba_unbind_service_identity', {
        description: 'Revoke a service identity project binding immediately. Project owner only.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            serviceActorId: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.unbindServiceIdentity(args);
        return asToolResult(result);
    });
    server.registerTool('ba_list_service_bindings', {
        description: 'List active and revoked service identity bindings for a project. Project owner only.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.listServiceBindings(args);
        return asToolResult(result);
    });
    server.registerTool('ba_decide_week_plan', {
        description: 'Approve or reject a weekly publication plan package. Unlocks content_write work items upon approval.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            weekPackageId: zod_1.z.number().int().positive(),
            planVersion: zod_1.z.string(),
            decision: zod_1.z.enum(['approved', 'rejected']),
            comment: zod_1.z.string().optional(),
            idempotencyKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.decideWeekPlan(args);
        return asToolResult(result);
    });
    server.registerTool('ba_get_week_execution_summary', {
        description: 'Get material stats and work item stage counts for a weekly publication plan.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            weekPackageId: zod_1.z.number().int().positive(),
            asOf: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.getWeekExecutionSummary(args);
        return asToolResult(result);
    });
    server.registerTool('ba_list_work_items', {
        description: 'List pending or available work items for a project sorted by schedule urgency.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            asOf: zod_1.z.string().optional(),
            filter: zod_1.z.object({
                state: zod_1.z.string().optional(),
                kind: zod_1.z.string().optional()
            }).optional()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.listWorkItems(args);
        return asToolResult(result);
    });
    server.registerTool('ba_get_work_item', {
        description: 'Get details of a specific work item including latest approval decision.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.getWorkItem(args);
        return asToolResult(result);
    });
    server.registerTool('ba_get_work_item_context', {
        description: 'Get full execution context for a work item including week frame, thesis, and resolved source resources.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            maxChars: zod_1.z.number().int().positive().optional()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.getWorkItemContext(args);
        return asToolResult(result);
    });
    server.registerTool('ba_claim_work_item', {
        description: 'Atomically claim a work item for execution with a timed lease token.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            leaseSeconds: zod_1.z.number().int().positive().optional(),
            idempotencyKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.claimWorkItem(args);
        return asToolResult(result);
    });
    server.registerTool('ba_complete_work_item', {
        description: 'Complete execution of a work item and submit the result payload, unlocking content review.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            leaseToken: zod_1.z.string(),
            result: zod_1.z.object({
                body: zod_1.z.string().optional(),
                text: zod_1.z.string().optional(),
                format: zod_1.z.string().optional()
            }).passthrough(),
            idempotencyKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.completeWorkItem(args);
        return asToolResult(result);
    });
    server.registerTool('ba_decide_approval', {
        description: 'Approve or reject a content review work item result version.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            resultVersion: zod_1.z.number().int(),
            decision: zod_1.z.enum(['approved', 'rejected']),
            comment: zod_1.z.string().optional(),
            idempotencyKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.decideApproval(args);
        return asToolResult(result);
    });
    server.registerTool('ba_list_schedule_exceptions', {
        description: 'List schedule exceptions (overdue content, missed publication slots, unavailable sources).',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            asOf: zod_1.z.string().optional(),
            includeBlocked: zod_1.z.boolean().optional()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.listScheduleExceptions(args);
        return asToolResult(result);
    });
    server.registerTool('ba_block_work_item', {
        description: 'Manually block a work item with an explicit reason code.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            leaseToken: zod_1.z.string(),
            reasonCode: zod_1.z.string(),
            note: zod_1.z.string().optional(),
            idempotencyKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.blockWorkItem(args);
        return asToolResult(result);
    });
    server.registerTool('ba_release_work_item', {
        description: 'Release a claimed work item lease back to the available queue.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            leaseToken: zod_1.z.string(),
            idempotencyKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.releaseWorkItem(args);
        return asToolResult(result);
    });
    server.registerTool('ba_reschedule_work_item', {
        description: 'Reschedule a work item due date with an explicit audit reason.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            dueAt: zod_1.z.string(),
            reason: zod_1.z.string(),
            idempotencyKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await work_queue_service_1.default.rescheduleWorkItem(args);
        return asToolResult(result);
    });
    server.registerTool('ba_upsert_initiative', {
        description: 'Upsert an initiative by project_id and external_key.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            externalKey: zod_1.z.string(),
            kind: zod_1.z.enum(['publication', 'event', 'campaign', 'infrastructure']),
            subtype: zod_1.z.string().optional(),
            title: zod_1.z.string(),
            description: zod_1.z.string().optional(),
            status: zod_1.z.enum(['planned', 'in_progress', 'completed', 'blocked', 'cancelled']).optional(),
            ownerRole: zod_1.z.string().optional(),
            dueAt: zod_1.z.string().datetime({ offset: true }).nullable().optional(),
            startAt: zod_1.z.string().datetime({ offset: true }).nullable().optional(),
            endAt: zod_1.z.string().datetime({ offset: true }).nullable().optional(),
            decisionAt: zod_1.z.string().datetime({ offset: true }).nullable().optional(),
            eventAt: zod_1.z.string().datetime({ offset: true }).nullable().optional(),
            measurementAt: zod_1.z.string().datetime({ offset: true }).nullable().optional()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.upsertInitiative(args);
        return asToolResult(result);
    });
    server.registerTool('ba_link_initiatives', {
        description: 'Link two initiatives with a dependency relationship and cycle detection.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            fromKey: zod_1.z.string(),
            toKey: zod_1.z.string(),
            type: zod_1.z.enum(['blocks', 'requires', 'not_before', 'informs']).optional(),
            condition: zod_1.z.string().optional(),
            source: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.linkInitiatives(args);
        return asToolResult(result);
    });
    server.registerTool('ba_import_operational_plan', {
        description: 'Import an operational plan containing initiatives and dependency linkages.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            externalPlan: zod_1.z.object({
                initiatives: zod_1.z.array(zod_1.z.object({
                    external_key: zod_1.z.string(),
                    kind: zod_1.z.enum(['publication', 'event', 'campaign', 'infrastructure']),
                    subtype: zod_1.z.string().optional(),
                    title: zod_1.z.string(),
                    description: zod_1.z.string().optional(),
                    status: zod_1.z.enum(['planned', 'in_progress', 'completed', 'blocked', 'cancelled']).optional(),
                    due_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    start_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    end_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    decision_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    event_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    measurement_at: zod_1.z.string().datetime({ offset: true }).optional()
                })).optional(),
                dependencies: zod_1.z.array(zod_1.z.object({
                    from: zod_1.z.string(),
                    to: zod_1.z.string(),
                    type: zod_1.z.enum(['blocks', 'requires', 'not_before', 'informs']).optional(),
                    condition: zod_1.z.string().optional()
                })).optional()
            }),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.importOperationalPlan(args);
        return asToolResult(result);
    });
    server.registerTool('ba_materialize_publication_task', {
        description: 'Create or update the execution workspace linked to one publication initiative. Safe to retry with the same idempotency key and payload.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            initiativeKey: zod_1.z.string().min(1),
            draftText: zod_1.z.string().optional(),
            brief: zod_1.z.string().optional(),
            channelId: zod_1.z.number().int().positive().optional(),
            publicationMode: zod_1.z.enum(['manual_handoff', 'approval_required', 'automatic']),
            scheduleAt: zod_1.z.string().datetime({ offset: true }).optional(),
            idempotencyKey: zod_1.z.string().min(1)
        }
    }, async (args) => {
        const result = await initiative_service_1.default.materializePublicationTask(args);
        return asToolResult(result);
    });
    server.registerTool('ba_get_initiative', {
        description: 'Retrieve an initiative by project_id and external_key.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            externalKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.getInitiative(args);
        return asToolResult(result);
    });
    server.registerTool('ba_list_initiatives', {
        description: 'List initiatives for a project with optional filtering.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            filter: zod_1.z.object({
                kind: zod_1.z.string().optional(),
                status: zod_1.z.string().optional()
            }).optional()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.listInitiatives(args);
        return asToolResult(result);
    });
    server.registerTool('ba_audit_plan_coverage', {
        description: 'Audit external plan coverage against current database initiatives.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            externalPlan: zod_1.z.object({
                initiatives: zod_1.z.array(zod_1.z.object({
                    external_key: zod_1.z.string(),
                    kind: zod_1.z.enum(['publication', 'event', 'campaign', 'infrastructure']),
                    due_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    start_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    end_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    decision_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    event_at: zod_1.z.string().datetime({ offset: true }).optional(),
                    measurement_at: zod_1.z.string().datetime({ offset: true }).optional()
                })).optional()
            })
        }
    }, async (args) => {
        const result = await initiative_service_1.default.auditPlanCoverage(args);
        return asToolResult(result);
    });
    server.registerTool('ba_get_release_readiness', {
        description: 'Evaluate release readiness for a target initiative based on incoming blocker states.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            initiativeKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.getReleaseReadiness(args);
        return asToolResult(result);
    });
    server.registerTool('ba_list_release_blockers', {
        description: 'List release blockers and downstream impact for overdue initiatives.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            asOf: zod_1.z.string().datetime({ offset: true }).optional()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.listReleaseBlockers(args);
        return asToolResult(result);
    });
    server.registerTool('ba_get_operational_calendar', {
        description: 'Returns one operational view with typed calendar dates, readiness, overdue initiatives, and layer summary.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            fromDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            toDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            asOf: zod_1.z.string().datetime({ offset: true }).optional()
        }
    }, async (args) => {
        const result = await initiative_service_1.default.getOperationalCalendarView(args);
        return asToolResult(result);
    });
    server.registerTool('ba_sync_task_tracker', {
        description: 'Synchronize a WorkItem projection with external task tracker (Plane).',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            workItemId: zod_1.z.number().int().positive(),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await task_tracker_service_1.default.syncTaskTracker(args);
        return asToolResult(result);
    });
    server.registerTool('ba_process_outbox', {
        description: 'Process outbox events for task tracker sync and retry delivery.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            simulateUnreachable: zod_1.z.boolean().optional(),
            staleOutboxItem: zod_1.z.object({
                workItemId: zod_1.z.number().int().positive(),
                syncVersion: zod_1.z.number().int(),
                lastSyncedVersion: zod_1.z.number().int()
            }).optional()
        }
    }, async (args) => {
        const result = await task_tracker_service_1.default.processOutbox(args);
        return asToolResult(result);
    });
    server.registerTool('ba_receive_webhook', {
        description: 'Process and deduplicate incoming webhook payloads from external task tracker.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            payload: zod_1.z.object({
                event_id: zod_1.z.string(),
                action: zod_1.z.string().optional(),
                issue_id: zod_1.z.string().optional(),
                state: zod_1.z.string().optional()
            }).passthrough()
        }
    }, async (args) => {
        const result = await task_tracker_service_1.default.receiveWebhook(args);
        return asToolResult(result);
    });
    server.registerTool('ba_reconcile_task_tracker', {
        description: 'Reconcile Planner WorkItem states with external task tracker states.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            autoRepair: zod_1.z.boolean().optional()
        }
    }, async (args) => {
        const result = await task_tracker_service_1.default.reconcileTaskTracker(args);
        return asToolResult(result);
    });
    server.registerTool('ba_execute_delivery', {
        description: 'Execute publication delivery attempt to a target channel.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            contentItemId: zod_1.z.number().int().positive(),
            channelId: zod_1.z.number().int().positive(),
            forceAutomatic: zod_1.z.boolean().optional(),
            unapproved: zod_1.z.boolean().optional(),
            simulateFailure: zod_1.z.boolean().optional(),
            idempotencyKey: zod_1.z.string().optional(),
            scheduledAt: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await delivery_service_1.default.executeDelivery(args);
        return asToolResult(result);
    });
    server.registerTool('ba_recover_delivery', {
        description: 'Recover a failed delivery attempt manually or via retry worker.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            deliveryAttemptId: zod_1.z.number().int().positive()
        }
    }, async (args) => {
        const result = await delivery_service_1.default.recoverDelivery(args);
        return asToolResult(result);
    });
    server.registerTool('ba_generate_image_asset', {
        description: 'Generate an image asset candidate for a content item.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            contentItemId: zod_1.z.number().int().positive(),
            prompt: zod_1.z.string(),
            provider: zod_1.z.string().optional(),
            model: zod_1.z.string().optional(),
            seed: zod_1.z.number().int().optional(),
            promptVersion: zod_1.z.number().int().optional(),
            altText: zod_1.z.string().optional(),
            aspectRatio: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await image_asset_service_1.default.generateImageAsset(args);
        return asToolResult(result);
    });
    server.registerTool('ba_review_image_asset', {
        description: 'Review an image asset candidate (approve or reject).',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            assetId: zod_1.z.number().int().positive(),
            decision: zod_1.z.enum(['approved', 'rejected']),
            reason: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await image_asset_service_1.default.reviewImageAsset(args);
        return asToolResult(result);
    });
    server.registerTool('ba_list_image_assets', {
        description: 'List all generated image asset versions for a content item.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            contentItemId: zod_1.z.number().int().positive()
        }
    }, async (args) => {
        const result = await image_asset_service_1.default.listImageAssets(args);
        return asToolResult(result);
    });
    server.registerTool('ba_record_metric_snapshot', {
        description: 'Record a metric snapshot at checkpoint (T+1, T+24, T+72) idempotently.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            contentItemId: zod_1.z.number().int().positive(),
            channelId: zod_1.z.number().int().positive(),
            checkpoint: zod_1.z.string(),
            metrics: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async (args) => {
        const result = await metrics_service_1.default.recordMetricSnapshot(args);
        return asToolResult(result);
    });
    server.registerTool('ba_get_content_metrics', {
        description: 'Get all recorded metric snapshots and consolidated metrics for a content item.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            contentItemId: zod_1.z.number().int().positive()
        }
    }, async (args) => {
        const result = await metrics_service_1.default.getContentMetrics(args);
        return asToolResult(result);
    });
    server.registerTool('ba_rollup_campaign_metrics', {
        description: 'Aggregate and rollup campaign metrics across channels and content items.',
        annotations: { readOnlyHint: true },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            actorId: zod_1.z.string(),
            initiativeKey: zod_1.z.string()
        }
    }, async (args) => {
        const result = await metrics_service_1.default.rollupCampaignMetrics(args);
        return asToolResult(result);
    });
}
async function shutdownMcpResources() {
    try {
        await db_1.default.$disconnect();
    }
    catch (_error) {
        // Ignore shutdown errors.
    }
    try {
        await db_1.pool.end();
    }
    catch (_error) {
        // Ignore shutdown errors.
    }
}
