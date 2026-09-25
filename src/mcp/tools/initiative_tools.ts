import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import initiativeService from '../../services/initiative.service';
import { asToolResult } from './common';

/**
 * Registers initiative planning, dependency graph, operational calendar, and blocker audit tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerInitiativeTools(server: McpServer): void {
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

    server.registerTool('ba_confirm_initiative_dependencies', {
        description: 'Planner-owned audited confirmation that an initiative has no unresolved release dependencies or that its stored dependency graph is complete.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().trim().min(1),
            initiativeKey: z.string().trim().min(1),
            state: z.enum(['none', 'confirmed']),
            evidence: z.string().trim().min(1).max(4000),
            source: z.string().trim().min(1).max(1000),
            idempotencyKey: z.string().trim().min(1).max(500)
        }
    }, async (args) => {
        const result = await initiativeService.confirmInitiativeDependencies(args);
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
}
