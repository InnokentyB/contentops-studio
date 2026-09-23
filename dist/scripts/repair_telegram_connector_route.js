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
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateRepairGuards = evaluateRepairGuards;
const node_crypto_1 = require("node:crypto");
const db_1 = __importStar(require("../db"));
function requiredArg(name) {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (!value)
        throw new Error(`Missing --${name}`);
    return value;
}
function evaluateRepairGuards(input) {
    const { task, decision, projectId, taskId, expectedRevision, expectedChannelId, expectedDecisionId, expectedAssetId, expectedBodySha, ownerApprovalRef } = input;
    const bodySha = (0, node_crypto_1.createHash)('sha256').update(task.draft_text || '', 'utf8').digest('hex');
    return {
        project: task.project_id === projectId,
        no_publication_fact: task.publication_fact === null,
        channel: task.channel_id === expectedChannelId && task.channel?.type === 'telegram',
        revision: task.content_revision === expectedRevision && task.accepted_revision === expectedRevision,
        text_accepted: task.text_state === 'accepted',
        body_sha: bodySha === expectedBodySha,
        visual_ready: task.handoff_state === 'ready' && ((task.visual_state === 'NO_VISUAL_NEEDED'
            && task.selected_asset_id === null
            && expectedAssetId === null
            && decision.decision === 'NO_VISUAL_NEEDED')
            || (task.visual_state === 'APPROVED'
                && Number.isSafeInteger(expectedAssetId)
                && task.selected_asset_id === expectedAssetId
                && task.selected_asset?.id === expectedAssetId
                && task.selected_asset?.status === 'approved'
                && task.selected_asset?.content_item_id === taskId
                && task.selected_asset?.project_id === projectId
                && task.selected_asset?.content_revision === expectedRevision
                && task.selected_asset?.decision_id === expectedDecisionId
                && /^https:\/\/[^\s]+$/i.test(task.selected_asset?.file_url || '')
                && decision.decision === 'GENERATE')),
        decision: decision.source_content_revision === expectedRevision && decision.status === 'active',
        route: task.status === 'browser_required'
            && ['browser_required', 'approval_required'].includes(task.publication_mode),
        owner_approval: task.publication_mode !== 'approval_required' || Boolean(ownerApprovalRef?.trim())
    };
}
async function main() {
    const projectId = Number(requiredArg('project'));
    const taskId = Number(requiredArg('task'));
    const expectedRevision = Number(requiredArg('revision'));
    const expectedChannelId = Number(requiredArg('channel'));
    const expectedDecisionId = Number(requiredArg('decision'));
    const assetArgIndex = process.argv.indexOf('--asset');
    const expectedAssetId = assetArgIndex >= 0 ? Number(process.argv[assetArgIndex + 1]) : null;
    const expectedBodySha = requiredArg('body-sha');
    const idempotencyKey = requiredArg('idempotency-key');
    const operator = requiredArg('operator');
    const ownerApprovalRef = requiredArg('owner-approval-ref');
    const apply = process.argv.includes('--apply');
    const owner = await db_1.default.projectMember.findFirst({
        where: { project_id: projectId, role: 'owner' },
        orderBy: { id: 'asc' },
        select: { user_id: true }
    });
    const task = await db_1.default.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        include: { publication_fact: true, channel: true, selected_asset: true }
    });
    const decision = await db_1.default.artDirectionDecision.findFirst({
        where: { id: expectedDecisionId, project_id: projectId, content_item_id: taskId }
    });
    if (!owner || !task || !decision)
        throw new Error('Repair target, owner, or art-direction decision not found');
    const prior = await db_1.default.workflowEvent.findFirst({
        where: { project_id: projectId, content_item_id: taskId,
            command: 'ba_repair_telegram_connector_route', idempotency_key: idempotencyKey }
    });
    if (prior) {
        const recorded = prior.after_state;
        if (recorded?.accepted_revision !== expectedRevision
            || recorded?.body_sha256 !== expectedBodySha
            || recorded?.art_direction_decision_id !== expectedDecisionId
            || recorded?.selected_asset_id !== task.selected_asset_id
            || task.status !== 'ready_for_execution'
            || task.publication_mode !== 'connector_auto') {
            throw new Error('[REPAIR_REPLAY_CONFLICT] Recorded repair does not match current task state');
        }
        console.log(JSON.stringify({ replayed: true, event_id: prior.id, task_id: taskId,
            status: task.status, publication_mode: task.publication_mode }, null, 2));
        return;
    }
    const guards = evaluateRepairGuards({ task, decision, projectId, taskId, expectedRevision,
        expectedChannelId, expectedDecisionId, expectedAssetId, expectedBodySha, ownerApprovalRef });
    if (Object.values(guards).some((value) => !value)) {
        throw new Error(`Repair guard failed: ${JSON.stringify(guards)}`);
    }
    const qualityReport = task.quality_report || {};
    const preview = {
        apply,
        project_id: projectId,
        task_id: taskId,
        guards,
        before: { status: task.status, publication_mode: task.publication_mode, publication_route: qualityReport.publication_route || null,
            selected_asset_id: task.selected_asset_id, accepted_revision: task.accepted_revision,
            owner_approval_ref: ownerApprovalRef, operator },
        after: { status: 'ready_for_execution', publication_mode: 'connector_auto', publication_route: 'connector_auto' }
    };
    if (!apply) {
        console.log(JSON.stringify(preview, null, 2));
        return;
    }
    const actorId = `operator:${operator}`;
    const result = await db_1.default.$transaction(async (tx) => {
        const existing = await tx.workflowEvent.findFirst({
            where: { project_id: projectId, command: 'ba_repair_telegram_connector_route', idempotency_key: idempotencyKey }
        });
        if (existing) {
            if (existing.content_item_id !== taskId)
                throw new Error('[REPAIR_REPLAY_CONFLICT] Key belongs to another task');
            throw new Error('[REPAIR_CONFLICT] Route was repaired concurrently; reload and verify before retrying');
        }
        const freshTask = await tx.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { publication_fact: true, channel: true, selected_asset: true }
        });
        const freshDecision = await tx.artDirectionDecision.findFirst({
            where: { id: expectedDecisionId, project_id: projectId, content_item_id: taskId }
        });
        if (!freshTask || !freshDecision)
            throw new Error('[REPAIR_CONFLICT] Repair target changed after preflight');
        const freshGuards = evaluateRepairGuards({ task: freshTask, decision: freshDecision,
            projectId, taskId, expectedRevision, expectedChannelId, expectedDecisionId,
            expectedAssetId, expectedBodySha, ownerApprovalRef });
        if (Object.values(freshGuards).some((value) => !value)) {
            throw new Error(`[REPAIR_CONFLICT] Fresh guard failed: ${JSON.stringify(freshGuards)}`);
        }
        const freshQualityReport = freshTask.quality_report || {};
        const freshHandoffBundle = freshQualityReport.handoff_bundle || null;
        const updated = await tx.contentItem.updateMany({
            where: {
                id: taskId,
                project_id: projectId,
                channel_id: expectedChannelId,
                content_revision: expectedRevision,
                accepted_revision: expectedRevision,
                draft_text: freshTask.draft_text,
                text_state: 'accepted',
                visual_state: freshTask.visual_state,
                selected_asset_id: freshTask.selected_asset_id,
                ...(expectedAssetId !== null ? { selected_asset: { is: {
                            id: expectedAssetId, project_id: projectId, content_item_id: taskId,
                            content_revision: expectedRevision, decision_id: expectedDecisionId,
                            status: 'approved'
                        } } } : {}),
                handoff_state: 'ready',
                status: 'browser_required',
                publication_mode: freshTask.publication_mode,
                publication_fact: null
            },
            data: {
                status: 'ready_for_execution',
                publication_mode: 'connector_auto',
                quality_report: {
                    ...freshQualityReport,
                    execution_mode: 'automatic',
                    publication_route: 'connector_auto',
                    ...(freshHandoffBundle ? { handoff_bundle: { ...freshHandoffBundle, mode: 'automated' } } : {}),
                    connector_route_repaired_at: new Date().toISOString(),
                    connector_route_repaired_by: actorId,
                    connector_route_owner_user_id: owner.user_id,
                    connector_route_repair_operator: operator,
                    connector_route_owner_approval_ref: ownerApprovalRef
                }
            }
        });
        if (updated.count !== 1)
            throw new Error('[REPAIR_CONFLICT] Task changed after preflight');
        const event = await tx.workflowEvent.create({
            data: {
                project_id: projectId,
                content_item_id: taskId,
                actor_id: actorId,
                command: 'ba_repair_telegram_connector_route',
                idempotency_key: idempotencyKey,
                before_state: preview.before,
                after_state: {
                    ...preview.after,
                    accepted_revision: expectedRevision,
                    body_sha256: expectedBodySha,
                    art_direction_decision_id: expectedDecisionId,
                    selected_asset_id: task.selected_asset_id,
                    owner_approval_ref: ownerApprovalRef,
                    owner_user_id: owner.user_id,
                    operator,
                    publication_fact: null
                }
            }
        });
        return { replayed: false, event_id: event.id };
    });
    console.log(JSON.stringify({ ...preview, result }, null, 2));
}
if (require.main === module) {
    main()
        .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
        .finally(async () => {
        await db_1.default.$disconnect();
        await db_1.pool.end();
    });
}
