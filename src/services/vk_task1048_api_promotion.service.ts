import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const MANIFEST = 'sha256:d5970e6b33d5f161a73f6ebc13fb5255f5a24be4f14251e57e5223ea03a2192f';
const BODY_SHA = '5cc11b6f7a5d8a2abf7a10ca2d005bf6cdd1c010a97ebedcd49e1092d5b874ab';
const ASSET_SHA = '1e7ef29ec003f18c242af5ca4d15d9f4990539ed905398a14df0d3071b4aa81e';
const SCHEDULE = '2026-10-10T12:00:00.000Z';
const COMMAND = 'ba_promote_vk_task1048_api';

type BaseArgs = { projectId: 10; taskId: 1048; actorId: string };
type ApplyArgs = BaseArgs & { expectedManifestChecksum: typeof MANIFEST; approvalReference: string; idempotencyKey: string };

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function assetSha(asset: any) {
    const provenance = record(asset?.provenance);
    const storage = record(provenance?.planner_storage);
    return typeof storage?.sha256 === 'string' ? storage.sha256 : typeof provenance?.sha256 === 'string' ? provenance.sha256 : null;
}

function connectorReadiness(channel: any) {
    const config = resolveEffectiveChannelConfig('vk', channel?.config || {});
    const raw = record(config.raw_account) || {};
    const vkId = raw.vk_id ?? config.vk_id;
    const community = raw.publish_access_token ?? raw.api_key ?? config.publish_access_token ?? config.api_key;
    const user = raw.user_access_token ?? config.user_access_token;
    return {
        ready: Boolean(vkId && community && user),
        vk_id_ready: Boolean(vkId),
        community_publish_token_ready: Boolean(community),
        user_media_token_ready: Boolean(user),
        blocker: !vkId || !community ? 'vk_credentials_missing' : !user ? 'vk_user_media_token_missing' : null
    };
}

type PromotionDependencies = {
    hashBody(body: string): string;
    manifestLoader: typeof loadAgentWorkspaceManifest;
};

const defaultDependencies: PromotionDependencies = {
    hashBody: body => createHash('sha256').update(body).digest('hex'),
    manifestLoader: loadAgentWorkspaceManifest
};

async function exactState(db: any, hashBody: (body: string) => string) {
    const [task, browserItem, attempt, decision] = await Promise.all([
        db.contentItem.findFirst({ where: { id: 1048, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        db.workItem.findFirst({ where: { id: 1699, project_id: 10, content_item_id: 1048,
            kind: 'browser_publish', state: 'available' } }),
        db.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1048 } }),
        db.artDirectionDecision.findFirst({ where: { id: 268, project_id: 10, content_item_id: 1048,
            source_content_revision: 1, decision_version: 1, decision: 'GENERATE', status: 'active' } })
    ]);
    const exact = task && task.channel_id === 117 && task.channel?.type === 'vk'
        && task.channel.name === 'analystcraft_vk_group' && task.channel.is_active === true
        && task.status === 'browser_required' && task.publication_mode === 'browser_required'
        && task.content_revision === 1 && task.accepted_revision === 1 && task.text_state === 'accepted'
        && task.handoff_state === 'ready' && task.visual_state === 'APPROVED'
        && task.visual_placement !== 'story' && !String(task.type || '').toLowerCase().includes('story')
        && task.visual_decision_version === 1
        && task.selected_asset_id === 130 && task.selected_asset?.id === 130
        && task.selected_asset.status === 'approved' && task.selected_asset.content_revision === 1
        && Boolean(task.selected_asset.file_url) && assetSha(task.selected_asset) === ASSET_SHA
        && hashBody(task.draft_text || '') === BODY_SHA
        && task.schedule_at?.toISOString() === SCHEDULE && task.publish_at?.toISOString() === SCHEDULE
        && !task.publication_fact && !task.published_link && !attempt && browserItem && decision;
    if (!exact) throw new Error('[VK1048_API_PROMOTION_GUARD_FAILED] Exact released browser package changed');
    return { task, browserItem, readiness: connectorReadiness(task.channel) };
}

export async function previewVkTask1048Api(args: BaseArgs, db: any = prisma,
    dependencies: PromotionDependencies = defaultDependencies) {
    if (args.projectId !== 10 || args.taskId !== 1048) throw new Error('[VK1048_API_PROMOTION_SCOPE_MISMATCH]');
    const user = /^user:(\d+)$/.exec(args.actorId);
    if (!user) throw new Error('[OWNER_REQUIRED]');
    const member = await db.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: 10, user_id: Number(user[1])
    } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const { readiness } = await exactState(db, dependencies.hashBody);
    return { project_id: 10, task_id: 1048, channel_id: 117, from: {
        status: 'browser_required', publication_mode: 'browser_required', browser_work_item_id: 1699
    }, to: { status: 'ready_for_execution', publication_mode: 'connector_auto', delivery: 'vk_api' },
    connector_ready: readiness.ready, connector_reason: readiness.blocker,
    credential_readiness: { vk_id: readiness.vk_id_ready, community_publish_token: readiness.community_publish_token_ready,
        user_media_token: readiness.user_media_token_ready }, provider_called: false, publication_fact_created: false };
}

export async function promoteVkTask1048Api(args: ApplyArgs, db: any = prisma,
    dependencies: PromotionDependencies = defaultDependencies) {
    if (args.expectedManifestChecksum !== MANIFEST || !args.approvalReference.trim() || !args.idempotencyKey.trim()) {
        throw new Error('[VK1048_API_PROMOTION_SCOPE_MISMATCH]');
    }
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    const cached = await db.workflowEvent.findFirst({ where: { project_id: 10, actor_id: args.actorId,
        command: COMMAND, idempotency_key: args.idempotencyKey } });
    if (cached?.after_state) {
        if (record(cached.before_state)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
        return { ...cached.after_state, replayed: true };
    }
    const preview = await previewVkTask1048Api(args, db, dependencies);
    if (!preview.connector_ready) throw new Error(`[VK1048_CONNECTOR_NOT_READY] ${preview.connector_reason}`);
    const user = Number(/^user:(\d+)$/.exec(args.actorId)![1]);
    const manifest = await dependencies.manifestLoader(10, user);
    if (manifest.checksum !== MANIFEST) throw new Error('[STALE_MANIFEST]');
    return db.$transaction(async (tx: any) => {
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, actor_id: args.actorId,
            command: COMMAND, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (record(prior.before_state)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...prior.after_state, replayed: true };
        }
        const { readiness } = await exactState(tx, dependencies.hashBody);
        if (!readiness.ready) throw new Error(`[VK1048_CONNECTOR_NOT_READY] ${readiness.blocker}`);
        const cancelled = await tx.workItem.updateMany({ where: { id: 1699, project_id: 10,
            content_item_id: 1048, kind: 'browser_publish', state: 'available' }, data: {
            state: 'cancelled', reason_code: 'SUPERSEDED_BY_VERIFIED_VK_API_ROUTE',
            note: 'Owner promoted the exact package to the verified VK API route before any browser claim or provider call.'
        } });
        if (cancelled.count !== 1) throw new Error('[VK1048_BROWSER_ITEM_CAS_CONFLICT]');
        const changed = await tx.contentItem.updateMany({ where: { id: 1048, project_id: 10, channel_id: 117,
            status: 'browser_required', publication_mode: 'browser_required', content_revision: 1,
            accepted_revision: 1, selected_asset_id: 130, schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE) },
        data: { status: 'ready_for_execution', publication_mode: 'connector_auto' } });
        if (changed.count !== 1) throw new Error('[VK1048_TASK_CAS_CONFLICT]');
        const result = { ...preview, connector_ready: true, connector_reason: null,
            browser_work_item_cancelled: true, approval_reference: args.approvalReference,
            published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1048, work_item_id: 1699,
            actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, manifest_checksum: manifest.checksum,
                status: 'browser_required', publication_mode: 'browser_required' }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export const VK1048_MANIFEST = MANIFEST;
