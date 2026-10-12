import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    EXACT_BROWSER_PACKAGES,
    claimExactBrowserTask,
    confirmExactBrowserSubmission,
    diagnoseLinkedInTask1132,
    markExactBrowserSubmissionUncertain,
    releaseExactBrowserTask,
    startExactBrowserSubmission
} from '../../services/exact_browser_publication_1133_1132.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerExactBrowserPublication1133And1132Tools(server: McpServer): void {
    for (const platform of ['medium', 'linkedin', 'x'] as const) {
        const pkg = EXACT_BROWSER_PACKAGES[platform];
        const prefix = `${platform}_task${pkg.taskId}`;
        const boundary = {
            projectId: z.literal(pkg.projectId), taskId: z.literal(pkg.taskId),
            channelId: z.literal(pkg.channelId), actorId: z.string().regex(/^user:\d+$/),
            workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
            contentRevision: z.literal(pkg.revision), textSha256: z.literal(pkg.bodySha256),
            selectedAssetId: pkg.assetId === null ? z.null() : z.literal(pkg.assetId),
            imageSha256: pkg.assetSha256 === null ? z.null() : z.literal(pkg.assetSha256)
        };
        server.registerTool(`ba_release_${prefix}_browser`, {
            description: `Owner-only audited release of exact ${platform} task ${pkg.taskId}. Creates one browser work item; never contacts the provider.`,
            annotations: INTERNAL_MUTATION_ANNOTATIONS,
            inputSchema: { projectId: z.literal(pkg.projectId), taskId: z.literal(pkg.taskId),
                actorId: z.string().regex(/^user:\d+$/), expectedManifestChecksum: z.literal(pkg.manifest),
                expectedBodySha256: z.literal(pkg.bodySha256), expectedScheduleAt: z.literal(pkg.schedule),
                approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
                duplicateCheckReference: platform === 'x' ? z.string().min(10) : z.string().optional() }
        }, async args => asToolResult(await releaseExactBrowserTask(platform, args)));
        server.registerTool(`ba_claim_${prefix}_browser_publication`, {
            description: `Claims exact owner-released ${platform} task ${pkg.taskId}; never opens the provider.`,
            annotations: INTERNAL_MUTATION_ANNOTATIONS,
            inputSchema: { projectId: z.literal(pkg.projectId), actorId: z.string(),
                workItemId: z.number().int().positive(), leaseSeconds: z.number().int().positive().optional(),
                idempotencyKey: z.string().min(1) }
        }, async args => asToolResult(await claimExactBrowserTask(platform, args)));
        server.registerTool(`ba_start_${prefix}_browser_submission`, {
            description: `Durably starts ${platform} task ${pkg.taskId} immediately before provider mutation.`,
            annotations: INTERNAL_MUTATION_ANNOTATIONS,
            inputSchema: boundary
        }, async args => asToolResult(await startExactBrowserSubmission({ platform, ...args })));
        server.registerTool(`ba_confirm_${prefix}_browser_submission`, {
            description: `Confirms ${platform} task ${pkg.taskId} only from its exact public permalink and evidence.`,
            annotations: INTERNAL_MUTATION_ANNOTATIONS,
            inputSchema: { ...boundary, attemptId: z.number().int().positive(), publicUrl: z.string().url(),
                providerObjectId: platform === 'medium' ? z.string().regex(/^[a-f0-9]{12}$/)
                    : platform === 'linkedin' ? z.string().regex(/^urn:li:activity:\d+$/)
                        : z.string().regex(/^\d+$/),
                publishedAt: z.string().datetime({ offset: true }),
                evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }
        }, async args => asToolResult(await confirmExactBrowserSubmission({ platform, ...args })));
        server.registerTool(`ba_mark_${prefix}_browser_submission_uncertain`, {
            description: `Freezes an ambiguous ${platform} task ${pkg.taskId} submission; never authorizes retry.`,
            annotations: INTERNAL_MUTATION_ANNOTATIONS,
            inputSchema: { projectId: z.literal(pkg.projectId), taskId: z.literal(pkg.taskId),
                actorId: z.string(), workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
                attemptId: z.number().int().positive(), reasonCode: z.string().min(1),
                idempotencyKey: z.string().min(1) }
        }, async args => asToolResult(await markExactBrowserSubmissionUncertain({ platform, ...args })));
    }
    server.registerTool('ba_diagnose_linkedin_task1132_browser', {
        description: 'Read-only diagnosis of the exact LinkedIn task1132 language, fact, work item and attempt guards.',
        inputSchema: {}
    }, async () => asToolResult(await diagnoseLinkedInTask1132()));
}
