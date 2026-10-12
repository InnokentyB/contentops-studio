import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { publicationPlacementAssetContract } from './publication_placement_contract';

export const DEVTO1118_MANIFEST = 'sha256:6ceb5c1c2199d8c1915beeb622a9791ff9c1b877d02649c8e69acd0d173e46d8';
const BODY_SHA = '363ef73df900415ff965a77b1a71577354676d95077edbe84cf37ad0fabf3c12';
const SCHEDULE = '2026-10-16T09:00:00.000Z';
const PROFILE_REF = 'profile_personal_innokenty_dev';
const PROFILE_URL = 'https://dev.to/innokentyb';
const HANDLE = 'innokentyb';
const COMMAND = 'ba_bind_devto_task1118';

type JsonRecord = Record<string, unknown>;
type ChannelRecord = { id: number; project_id: number; type: string; name: string; config: unknown;
    is_active: boolean; updated_at?: Date };
type TaskRecord = { id: number; project_id: number; week_package_id: number | null; channel_id: number | null;
    type: string; status: string; publication_mode: string | null; content_revision: number;
    accepted_revision: number | null; text_state: string; handoff_state: string; visual_state: string;
    visual_mode: string; visual_placement: string | null; visual_decision_version: number;
    selected_asset_id: number | null; draft_text: string | null; schedule_at: Date | null;
    publish_at: Date | null; published_link: string | null; publication_fact: unknown; quality_report: unknown };
type WorkRecord = { id: number; project_id: number; content_item_id: number | null; kind: string;
    state: string; input_context_version: number; dedupe_key: string | null };
type DbPort = {
    projectMember: { findUnique(args: unknown): Promise<{ role: string } | null> };
    socialChannel: { findFirst(args: unknown): Promise<ChannelRecord | null>;
        create(args: unknown): Promise<ChannelRecord> };
    contentItem: { findFirst(args: unknown): Promise<TaskRecord | null>;
        updateMany(args: unknown): Promise<{ count: number }> };
    deliveryAttempt: { findFirst(args: unknown): Promise<{ id: number } | null> };
    artDirectionDecision: { findFirst(args: unknown): Promise<{ id: number } | null> };
    imageAsset: { findFirst(args: unknown): Promise<{ id: number } | null> };
    workItem: { findFirst(args: unknown): Promise<WorkRecord | null>;
        updateMany(args: unknown): Promise<{ count: number }>;
        create(args: unknown): Promise<WorkRecord> };
    workflowEvent: { findFirst(args: unknown): Promise<{ before_state: unknown; after_state: unknown } | null>;
        create(args: unknown): Promise<unknown> };
    $transaction<T>(operation: (tx: DbPort) => Promise<T>, options?: unknown): Promise<T>;
};
type Args = { projectId: 10; taskId: 1118; actorId: string; expectedManifestChecksum: typeof DEVTO1118_MANIFEST;
    expectedAcceptedRevision: 1; expectedContentRevision: 1; expectedBodySha256: string;
    expectedScheduleAt: string; expectedProfileRef: typeof PROFILE_REF; expectedProfileUrl: typeof PROFILE_URL;
    expectedHandle: typeof HANDLE; idempotencyKey: string; confirm?: boolean };
type Dependencies = { hashBody(body: string): string; manifestLoader: typeof loadAgentWorkspaceManifest };
const defaults: Dependencies = { hashBody: body => createHash('sha256').update(body).digest('hex'),
    manifestLoader: loadAgentWorkspaceManifest };

function record(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function devtoConfig(): Prisma.InputJsonObject {
    return {
        platform: 'devto', role: 'technical_practitioner', profile_ref: PROFILE_REF,
        registry_profile_id: PROFILE_REF, identity_ref: 'personal_innokenty', account_ref: `@${HANDLE}`,
        handle: HANDLE, profile_url: PROFILE_URL, channel_url: PROFILE_URL, account_type: 'personal',
        content_language: 'en', workflow_mode: 'browser_required', connector_mode: 'browser_assisted',
        execution_modes: ['manual'], adapter_kind: 'publication_source', canonical_placements: ['article_cover'],
        allowed_content_types: ['devto:manual_article'], capability_flags: {
            api_publish: false, browser_publish: true, manual_handoff: true, analytics_supported: false
        },
        raw_account: { platform: 'devto', type: 'personal', role: 'technical_practitioner',
            handle: HANDLE, url: PROFILE_URL }
    };
}

function isExactChannel(channel: ChannelRecord) {
    const config = record(channel.config);
    return channel.project_id === 10 && channel.type === 'devto' && channel.name === 'innokenty_devto'
        && channel.is_active === true && config.profile_ref === PROFILE_REF && config.profile_url === PROFILE_URL
        && config.handle === HANDLE && config.identity_ref === 'personal_innokenty';
}

async function exactPackage(db: DbPort, hashBody: (body: string) => string) {
    const [task, attempt, decision, asset, artWork] = await Promise.all([
        db.contentItem.findFirst({ where: { id: 1118, project_id: 10 }, include: { publication_fact: true } }),
        db.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1118 } }),
        db.artDirectionDecision.findFirst({ where: { project_id: 10, content_item_id: 1118 } }),
        db.imageAsset.findFirst({ where: { project_id: 10, content_item_id: 1118 } }),
        db.workItem.findFirst({ where: { project_id: 10, content_item_id: 1118, kind: 'art_direction',
            state: { in: ['available', 'pending'] } }, orderBy: { id: 'desc' } })
    ]);
    if (!task || task.channel_id !== null || task.type !== 'publication' || task.status !== 'approved'
        || task.publication_mode !== 'approval_required' || task.content_revision !== 1 || task.accepted_revision !== 1
        || task.text_state !== 'accepted' || task.handoff_state !== 'blocked'
        || task.visual_state !== 'PENDING_ASSESSMENT' || task.visual_mode !== 'auto_assess'
        || task.visual_placement !== 'feed' || task.visual_decision_version !== 0 || task.selected_asset_id !== null
        || hashBody(task.draft_text || '') !== BODY_SHA || task.schedule_at?.toISOString() !== SCHEDULE
        || task.publish_at?.toISOString() !== SCHEDULE || task.publication_fact || task.published_link
        || attempt || decision || asset || !artWork || artWork.input_context_version !== 1) {
        throw new Error('[DEVTO1118_BINDING_GUARD_FAILED] Exact accepted package changed');
    }
    return { task, artWork };
}

export async function bindDevtoTask1118(args: Args, database: DbPort = prisma as unknown as DbPort,
    dependencies: Dependencies = defaults) {
    if (args.projectId !== 10 || args.taskId !== 1118 || args.expectedManifestChecksum !== DEVTO1118_MANIFEST
        || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
        || args.expectedBodySha256 !== BODY_SHA || args.expectedScheduleAt !== SCHEDULE
        || args.expectedProfileRef !== PROFILE_REF || args.expectedProfileUrl !== PROFILE_URL
        || args.expectedHandle !== HANDLE || !args.idempotencyKey.trim()) throw new Error('[DEVTO1118_SCOPE_MISMATCH]');
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor) throw new Error('[OWNER_REQUIRED]');
    const member = await database.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: 10, user_id: Number(actor[1])
    } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    const prior = await database.workflowEvent.findFirst({ where: { project_id: 10, actor_id: args.actorId,
        command: COMMAND, idempotency_key: args.idempotencyKey } });
    if (prior?.after_state) {
        if (record(prior.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
        return { ...record(prior.after_state), replayed: true };
    }
    await exactPackage(database, dependencies.hashBody);
    const existing = await database.socialChannel.findFirst({ where: { project_id: 10, name: 'innokenty_devto' } });
    if (existing && !isExactChannel(existing)) throw new Error('[DEVTO_CHANNEL_CONFLICT]');
    const preview = { project_id: 10, task_id: 1118, channel_id: existing?.id || null,
        channel_name: 'innokenty_devto', channel_type: 'devto', profile_ref: PROFILE_REF,
        profile_url: PROFILE_URL, handle: HANDLE, content_revision: 1, accepted_revision: 1,
        body_sha256: BODY_SHA, schedule_at: SCHEDULE, content_language: 'en' as const,
        placement: 'article_cover' as const, visual_mode: 'required' as const,
        route: 'browser_required' as const, release_created: false, provider_called: false,
        publication_fact_created: false, replayed: false };
    if (!args.confirm) return preview;
    const beforeManifest = await dependencies.manifestLoader(10, Number(actor[1]));
    if (beforeManifest.project.id !== 10 || beforeManifest.project.slug !== 'analystcraft-2') {
        throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
    }
    if (beforeManifest.checksum !== DEVTO1118_MANIFEST) throw new Error('[STALE_MANIFEST]');

    const result = await database.$transaction(async tx => {
        const current = await exactPackage(tx, dependencies.hashBody);
        let channel = await tx.socialChannel.findFirst({ where: { project_id: 10, name: 'innokenty_devto' } });
        if (channel && !isExactChannel(channel)) throw new Error('[DEVTO_CHANNEL_CONFLICT]');
        if (!channel) channel = await tx.socialChannel.create({ data: { project_id: 10, type: 'devto',
            name: 'innokenty_devto', is_active: true, config: devtoConfig() } });
        const quality = record(current.task.quality_report);
        const handoff = record(quality.handoff_bundle);
        const handoffTask = record(handoff.task);
        const placementContract = publicationPlacementAssetContract({ type: channel.type, config: channel.config }, 'article_cover');
        const nextQuality = { ...quality, content_language: 'en', publication_route: 'browser_required',
            target_identity: { profile_ref: PROFILE_REF, identity_ref: 'personal_innokenty',
                profile_url: PROFILE_URL, handle: HANDLE, project_channel_id: channel.id },
            handoff_bundle: { ...handoff, content_language: 'en', mode: 'manual',
                account: { ref: `@${HANDLE}`, details: { platform: 'devto', profile_url: PROFILE_URL } },
                task: { ...handoffTask, channel: 'devto', action_type: 'devto:manual_article',
                    placement: 'article_cover', account_ref: `@${HANDLE}` },
                placement_contract: placementContract, transport: placementContract.transport,
                manual_checklist: [`Post from account: @${HANDLE}`, 'Upload the approved article cover.',
                    'Keep the canonical public URL after publication for fact recording.'] } };
        const changed = await tx.contentItem.updateMany({ where: { id: 1118, project_id: 10, channel_id: null,
            status: 'approved', publication_mode: 'approval_required', content_revision: 1,
            accepted_revision: 1, selected_asset_id: null, schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE) },
        data: { channel_id: channel.id, visual_placement: 'article_cover', visual_mode: 'required',
            visual_state: 'PENDING_ASSESSMENT', handoff_state: 'blocked', quality_report: nextQuality } });
        if (changed.count !== 1) throw new Error('[DEVTO1118_BINDING_CAS_CONFLICT]');
        const cancelled = await tx.workItem.updateMany({ where: { id: current.artWork.id, project_id: 10,
            content_item_id: 1118, kind: 'art_direction', state: { in: ['available', 'pending'] } },
        data: { state: 'cancelled', reason_code: 'CHANNEL_BINDING_REPLACED',
            note: 'Replaced by the revision-bound DEV.to article-cover art-direction item.' } });
        if (cancelled.count !== 1) throw new Error('[DEVTO1118_ART_WORK_CAS_CONFLICT]');
        const artWork = await tx.workItem.create({ data: { project_id: 10, week_package_id: current.task.week_package_id,
            content_item_id: 1118, item_key: 'W42-ALLOC-2026-ROW-20', kind: 'art_direction', state: 'available',
            assignee_role: 'art_director', input_context_version: 1,
            dedupe_key: 'art-direction:1118:1:article_cover',
            note: 'Assess the required conceptual visual for accepted revision 1, DEV.to article_cover.' } });
        const baseResult = { ...preview, channel_id: channel.id, replaced_art_work_item_id: current.artWork.id,
            art_work_item_id: artWork.id };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1118, work_item_id: artWork.id,
            actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, manifest_checksum: DEVTO1118_MANIFEST,
                channel_id: null, visual_placement: 'feed', art_work_item_id: current.artWork.id },
            after_state: baseResult } });
        return baseResult;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const afterManifest = await dependencies.manifestLoader(10, Number(actor[1]));
    if (afterManifest.project.id !== 10 || afterManifest.project.slug !== 'analystcraft-2') {
        throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
    }
    if (!afterManifest.channels.some(channel => channel.id === result.channel_id && channel.name === 'innokenty_devto'
        && channel.type === 'devto')) throw new Error('[DEVTO1118_MANIFEST_RECONCILIATION_FAILED]');
    return { ...result, manifest_revision: afterManifest.revision, manifest_checksum: afterManifest.checksum };
}
