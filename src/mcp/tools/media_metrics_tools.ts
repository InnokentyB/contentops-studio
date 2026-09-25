import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import imageAssetService from '../../services/image_asset.service';
import artDirectionService from '../../services/art_direction.service';
import metricsService from '../../services/metrics.service';
import dzenEngagementService from '../../services/dzen_engagement.service';
import prisma from '../../db';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

/**
 * Registers media, art direction, metrics, and Dzen engagement tools on the given MCP server.
 *
 * @param server - MCP server instance.
 */
export function registerMediaMetricsTools(server: McpServer): void {
    server.registerTool('ba_generate_image_asset', {
        description: 'Register a generated image candidate only after the weekly plan and current text revision are accepted and an active GENERATE art-direction decision exists. Requires the stored image URL and alt text; the asset remains blocked until visual review.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
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
            aspectRatio: z.string().optional(),
            decisionId: z.number().int().positive(),
            contentRevision: z.number().int().positive().optional(),
            placement: z.string().optional(),
            fileUrl: z.string().min(1).optional(),
            fileDataBase64: z.string().min(1).optional(),
            fileName: z.string().min(1).optional(),
            mimeType: z.string().min(1).optional(),
            provenance: z.record(z.string(), z.unknown()).optional()
        }
    }, async (args) => {
        const result = await imageAssetService.generateImageAsset(args);
        return asToolResult(result);
    });

    server.registerTool('ba_review_image_asset', {
        description: 'Review an image asset candidate (approve or reject).',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            assetId: z.number().int().positive(),
            decision: z.enum(['approved', 'rejected']),
            reason: z.string().optional(),
            qaReport: z.record(z.string(), z.unknown()).optional()
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
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
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
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
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
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
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

    server.registerTool('ba_dzen_collect_post_metrics', {
        description: 'Collect current public Dzen counters for a published content item and save a daily metric snapshot.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            channelId: z.number().int().positive(),
            contentItemId: z.number().int().positive(),
            checkpoint: z.string().min(1).max(100).optional()
        }
    }, async (args) => asToolResult(await dzenEngagementService.collectPostMetrics(args)));

    server.registerTool('ba_dzen_search_relevant_posts', {
        description: 'Search public Dzen posts and rank candidates by relevance to a query. This does not publish or comment.',
        annotations: { readOnlyHint: true, openWorldHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            channelId: z.number().int().positive(),
            query: z.string().trim().min(3).max(300),
            limit: z.number().int().min(1).max(30).optional(),
            minScore: z.number().int().min(0).max(100).optional()
        }
    }, async (args) => asToolResult(await dzenEngagementService.searchRelevantPosts(args)));

    server.registerTool('ba_dzen_comment', {
        description: 'Preview or publish one Dzen comment. Defaults to preview; real publication requires confirm=true and an idempotency key.',
        annotations: { idempotentHint: true, openWorldHint: true },
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            channelId: z.number().int().positive(),
            postUrl: z.string().url().max(2000),
            text: z.string().trim().min(2).max(2000),
            idempotencyKey: z.string().min(8).max(200),
            confirm: z.boolean().optional()
        }
    }, async (args) => asToolResult(await dzenEngagementService.comment(args)));

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
