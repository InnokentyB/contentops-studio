import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import mcpPublicationService from '../../services/mcp_publication.service';
import { asToolResult } from './common';

/**
 * Registers trend collection parser tools, job inspection, insights, and template runners.
 *
 * @param server - Target MCP server instance.
 */
export function registerParserTools(server: McpServer): void {
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
            queryBank: z.record(z.string(), z.unknown()).optional(),
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
}
