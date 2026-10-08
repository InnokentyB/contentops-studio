import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import telegramClientService from './telegram_client.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const PROJECT_RETIREMENT_TASKS = Object.freeze({
    7: Object.freeze([101, 109, 913, 916, 955]),
    10: Object.freeze([739, 774, 784, 850, 854, 862, 863, 883, 888, 907, 908, 909, 910, 911, 912,
        929, 930, 932, 934, 935, 937, 938, 939, 944, 948, 984, 1000, 1011, 1015, 1016, 1022, 1084])
});

const PROJECT_SLUGS = Object.freeze({ 7: 'seturon', 10: 'analystcraft-2' });
const COMMAND = 'ba_apply_publication_retirement';
const HISTORY_TASK_ID = 1011;
const UNCERTAIN_TASK_IDS = Object.freeze([854, 984, 1011]);
const UNCERTAINTY_COMMAND = 'ba_apply_retirement_uncertainty_projection';

export type RetirementTaskGuard = { taskId: number; expectedStatus: string; expectedPublicationMode: string | null };
export type PublicationRetirementParams = {
    projectId: 7 | 10;
    projectSlug: string;
    actorId: string;
    expectedManifestChecksum: string;
    expectedTasks: RetirementTaskGuard[];
    approvalReference: string;
};
export type ApplyPublicationRetirementParams = PublicationRetirementParams & {
    previewHash: string;
    reason: string;
    idempotencyKey: string;
};
export type RetirementUncertaintyParams = {
    projectId: 10;
    projectSlug: 'analystcraft-2';
    actorId: string;
    expectedManifestChecksum: string;
    expectedRetirementAuditId: number;
    approvalReference: string;
};
export type ApplyRetirementUncertaintyParams = RetirementUncertaintyParams & {
    previewHash: string;
    reason: string;
    idempotencyKey: string;
};
type HistoryResult = {
    status: 'found' | 'not_found' | 'ambiguous' | 'session_unavailable';
    reasonCode?: string;
    matches: Array<{ messageId: number; publicUrl: string; publishedAt: string; textSha256: string }>;
};
type Dependencies = {
    loadManifest(projectId: number, userId: number): Promise<{ checksum: string }>;
    checkTelegramHistory(params: { projectId: number; target: string; expectedText: string; limit: number }): Promise<HistoryResult>;
    now(): Date;
};

function normalizedText(value: string) {
    return value.replace(/\r/g, '').replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n\n').trim();
}
function sha256(value: unknown) {
    const stable = (entry: unknown): string => Array.isArray(entry) ? `[${entry.map(stable).join(',')}]`
        : entry && typeof entry === 'object' ? `{${Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${stable(child instanceof Date ? child.toISOString() : child)}`).join(',')}}`
            : JSON.stringify(entry ?? null);
    return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}
function actorUserId(actorId: string) {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}
function sortedGuards(guards: RetirementTaskGuard[]) {
    return [...guards].sort((a, b) => a.taskId - b.taskId);
}
function taskState(item: any) {
    return {
        id: item.id, status: item.status, publication_mode: item.publication_mode,
        content_revision: item.content_revision, accepted_revision: item.accepted_revision, text_state: item.text_state,
        body_sha256: sha256(item.draft_text || ''), channel_id: item.channel_id,
        selected_asset_id: item.selected_asset_id, assets_sha256: sha256(item.assets), quality_report_sha256: sha256(item.quality_report),
        published_link: item.published_link, telegram_message_id: item.telegram_message_id,
        publication_fact_id: item.publication_fact?.id || null,
        work_items: (item.work_items || []).map((work: any) => ({ id: work.id, kind: work.kind, state: work.state })).sort((a: any, b: any) => a.id - b.id)
    };
}
function requestFingerprint(params: ApplyPublicationRetirementParams) {
    return sha256({ projectId: params.projectId, projectSlug: params.projectSlug, actorId: params.actorId,
        expectedManifestChecksum: params.expectedManifestChecksum, expectedTasks: sortedGuards(params.expectedTasks),
        approvalReference: params.approvalReference, previewHash: params.previewHash, reason: params.reason.trim() });
}

export class PublicationRetirementService {
    constructor(private readonly db: any = prisma, private readonly dependencies: Dependencies = {
        loadManifest: loadAgentWorkspaceManifest,
        checkTelegramHistory: ({ projectId, target, expectedText, limit }) => telegramClientService.searchExactTextHistory({ projectId, target, expectedText, limit }),
        now: () => new Date()
    }) {}

    private assertScope(params: PublicationRetirementParams) {
        if (params.projectSlug !== PROJECT_SLUGS[params.projectId]) throw new Error('[PROJECT_SLUG_CONFLICT]');
        if (!/^sha256:[a-f0-9]{64}$/.test(params.expectedManifestChecksum)) throw new Error('[MANIFEST_CHECKSUM_INVALID]');
        if (!params.approvalReference?.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
        const expectedIds = [...PROJECT_RETIREMENT_TASKS[params.projectId]];
        const guards = sortedGuards(params.expectedTasks);
        if (guards.length !== expectedIds.length || new Set(guards.map((entry) => entry.taskId)).size !== expectedIds.length
            || guards.some((entry, index) => entry.taskId !== expectedIds[index] || !entry.expectedStatus
                || typeof entry.expectedPublicationMode !== 'string')) throw new Error('[RETIREMENT_TASK_SCOPE_MISMATCH]');
    }

    private async requireOwner(client: any, params: PublicationRetirementParams) {
        const userId = actorUserId(params.actorId);
        const membership = await client.projectMember.findUnique({
            where: { project_id_user_id: { project_id: params.projectId, user_id: userId } }, select: { role: true }
        });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const project = await client.project.findUnique({ where: { id: params.projectId }, select: { id: true, slug: true } });
        if (!project || project.slug !== params.projectSlug) throw new Error('[PROJECT_SLUG_CONFLICT]');
        const manifest = await this.dependencies.loadManifest(params.projectId, userId);
        if (manifest.checksum !== params.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
    }

    private async loadTasks(client: any, params: PublicationRetirementParams) {
        const expected = sortedGuards(params.expectedTasks);
        const tasks = await client.contentItem.findMany({
            where: { project_id: params.projectId, id: { in: expected.map((entry) => entry.taskId) } },
            include: { channel: true, publication_fact: true, work_items: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' }
        });
        if (tasks.length !== expected.length) throw new Error('[RETIREMENT_TASK_NOT_FOUND]');
        for (let index = 0; index < tasks.length; index += 1) {
            const task = tasks[index]; const guard = expected[index];
            if (task.id !== guard.taskId || task.status !== guard.expectedStatus || task.publication_mode !== guard.expectedPublicationMode) {
                throw new Error(`[RETIREMENT_TASK_STATE_CONFLICT] Task ${guard.taskId} changed`);
            }
            if (task.publication_fact || task.published_link || task.status === 'published') {
                throw new Error(`[RETIREMENT_PUBLICATION_FACT_PRESENT] Task ${guard.taskId} has publication evidence`);
            }
        }
        const attempts = client.deliveryAttempt?.findMany ? await client.deliveryAttempt.findMany({
            where: { project_id: params.projectId, content_item_id: { in: tasks.map((task: any) => task.id) } }, orderBy: { id: 'asc' }
        }) : tasks.flatMap((task: any) => task.delivery_attempts || []);
        return { tasks, attempts };
    }

    private async historyFor1011(params: PublicationRetirementParams, tasks: any[]): Promise<HistoryResult | null> {
        if (params.projectId !== 10) return null;
        const task = tasks.find((entry) => entry.id === HISTORY_TASK_ID);
        const config = task?.channel?.config && typeof task.channel.config === 'object' ? task.channel.config : {};
        const target = String(config.channel_username || config.username || config.handle || '').trim();
        if (!task || task.channel_id !== 111 || task.channel?.type !== 'telegram' || task.content_revision !== 1
            || task.accepted_revision !== 1 || task.text_state !== 'accepted' || target.toLowerCase() !== '@analysts_thinking') {
            throw new Error('[TELEGRAM_1011_HISTORY_GUARD_FAILED]');
        }
        const history = await this.dependencies.checkTelegramHistory({ projectId: 10, target, expectedText: task.draft_text || '', limit: 500 });
        if (history.status === 'ambiguous') throw new Error('[TELEGRAM_1011_HISTORY_AMBIGUOUS]');
        if (history.status === 'found') {
            if (history.matches.length !== 1 || history.matches[0].textSha256 !== sha256(normalizedText(task.draft_text || ''))
                || history.matches[0].publicUrl !== `https://t.me/analysts_thinking/${history.matches[0].messageId}`) {
                throw new Error('[TELEGRAM_1011_HISTORY_IDENTITY_INVALID]');
            }
        }
        return history;
    }

    private previewPayload(params: PublicationRetirementParams, loaded: { tasks: any[]; attempts: any[] }, history: HistoryResult | null) {
        const retiredTasks = loaded.tasks.filter((task) => task.id !== HISTORY_TASK_ID || history?.status !== 'found');
        const changes = retiredTasks.flatMap((task) => [
            { entity: 'content_item', id: task.id, path: 'status', from: task.status, to: 'cancelled' },
            { entity: 'content_item', id: task.id, path: 'publication_mode', from: task.publication_mode, to: 'retired' }
        ]);
        if (history?.status === 'found') changes.push(
            { entity: 'content_item', id: HISTORY_TASK_ID, path: 'status', from: 'publishing', to: 'published' },
            { entity: 'content_item', id: HISTORY_TASK_ID, path: 'published_link', from: null, to: history.matches[0].publicUrl }
        );
        const payload = {
            mode: 'preview' as const, dry_run: true as const, project_id: params.projectId, project_slug: params.projectSlug,
            manifest_checksum: params.expectedManifestChecksum, affected_task_ids: loaded.tasks.map((task) => task.id),
            retire_task_ids: retiredTasks.map((task) => task.id), history_readback: history, changes,
            protected_hashes: {
                task_state_sha256: sha256(loaded.tasks.map(taskState)),
                delivery_attempts_sha256: sha256(loaded.attempts.map((attempt: any) => ({ ...attempt, created_at: attempt.created_at?.toISOString?.() || attempt.created_at,
                    updated_at: attempt.updated_at?.toISOString?.() || attempt.updated_at }))),
                assets_sha256: sha256(loaded.tasks.map((task) => ({ id: task.id, selected_asset_id: task.selected_asset_id, assets: task.assets }))),
                quality_report_sha256: sha256(loaded.tasks.map((task) => ({ id: task.id, quality_report: task.quality_report }))),
                work_items_sha256: sha256(loaded.tasks.map((task) => ({ id: task.id, work_items: task.work_items || [] })))
            },
            unchanged_assertions: { publication_facts: history?.status !== 'found', delivery_attempts: true,
                assets_and_selected_asset: true, quality_report_and_provider_uncertainty: true, existing_work_items: true,
                new_reconciliation_blocker: history?.status === 'session_unavailable',
                no_publish_connector_browser_or_outbox: true }
        };
        return { ...payload, preview_hash: sha256(payload) };
    }

    async preview(params: PublicationRetirementParams) {
        this.assertScope(params);
        await this.requireOwner(this.db, params);
        const loaded = await this.loadTasks(this.db, params);
        return this.previewPayload(params, loaded, await this.historyFor1011(params, loaded.tasks));
    }

    async apply(params: ApplyPublicationRetirementParams) {
        if (!params.reason?.trim()) throw new Error('[RETIREMENT_REASON_REQUIRED]');
        if (!params.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        this.assertScope(params);
        const fingerprint = requestFingerprint(params);
        const replayWhere = { project_id: params.projectId, actor_id: params.actorId, command: COMMAND, idempotency_key: params.idempotencyKey };
        await this.requireOwner(this.db, params);
        const existing = await this.db.workflowEvent.findFirst({ where: replayWhere });
        if (existing) {
            const after = existing.after_state as { request_fingerprint?: string; result?: Record<string, unknown> } | null;
            if (after?.request_fingerprint !== fingerprint) throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
            return { ...after.result, audit_id: existing.id, replayed: true };
        }
        const before = await this.loadTasks(this.db, params);
        const history = await this.historyFor1011(params, before.tasks);
        const preview = this.previewPayload(params, before, history);
        if (preview.preview_hash !== params.previewHash) throw new Error('[PREVIEW_CONFLICT] State changed since preview');
        return this.db.$transaction(async (tx: any) => {
            await this.requireOwner(tx, params);
            const replay = await tx.workflowEvent.findFirst({ where: replayWhere });
            if (replay) {
                const after = replay.after_state as { request_fingerprint?: string; result?: Record<string, unknown> } | null;
                if (after?.request_fingerprint !== fingerprint) throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
                return { ...after.result, audit_id: replay.id, replayed: true };
            }
            if (typeof tx.$queryRaw === 'function') await tx.$queryRaw(Prisma.sql`SELECT id FROM planner.content_items
                WHERE project_id = ${params.projectId} AND id IN (${Prisma.join(params.expectedTasks.map((entry) => entry.taskId))}) ORDER BY id FOR UPDATE`);
            const loaded = await this.loadTasks(tx, params);
            const lockedPreview = this.previewPayload(params, loaded, history);
            if (lockedPreview.preview_hash !== params.previewHash) throw new Error('[PREVIEW_CONFLICT] State changed since preview');
            const retiredTaskIds: number[] = [];
            let reconciledPublicationFactId: number | null = null;
            for (const task of loaded.tasks) {
                if (task.id === HISTORY_TASK_ID && history?.status === 'found') {
                    const match = history.matches[0];
                    const fact = await tx.publicationFact.create({ data: { project_id: params.projectId, content_item_id: task.id,
                        channel_id: task.channel_id, artifact_kind: 'post', outcome: 'published', published_at: new Date(match.publishedAt),
                        public_url: match.publicUrl, provider_object_id: String(match.messageId), confirmation_mode: 'reconciled',
                        evidence_type: 'mtproto_history_exact_text', evidence_ref: `sha256:${match.textSha256}`,
                        target_url: `https://t.me/analysts_thinking`, utm_status: 'not_applicable', confirmed_by: params.actorId } });
                    const changed = await tx.contentItem.updateMany({ where: { id: task.id, project_id: params.projectId,
                        status: task.status, publication_mode: task.publication_mode, content_revision: 1, accepted_revision: 1,
                        publication_fact: null }, data: { status: 'published', published_link: match.publicUrl, telegram_message_id: match.messageId } });
                    if (changed.count !== 1) throw new Error('[RETIREMENT_TASK_CAS_CONFLICT]');
                    reconciledPublicationFactId = fact.id;
                    continue;
                }
                const changed = await tx.contentItem.updateMany({ where: { id: task.id, project_id: params.projectId,
                    status: task.status, publication_mode: task.publication_mode, publication_fact: null },
                data: { status: 'cancelled', publication_mode: 'retired' } });
                if (changed.count !== 1) throw new Error(`[RETIREMENT_TASK_CAS_CONFLICT] Task ${task.id}`);
                retiredTaskIds.push(task.id);
            }
            let blockerWorkItemId: number | null = null;
            if (history?.status === 'session_unavailable') {
                const task = loaded.tasks.find((entry: any) => entry.id === HISTORY_TASK_ID);
                const blocker = await tx.workItem.create({ data: { project_id: params.projectId, week_package_id: task.week_package_id,
                    content_item_id: HISTORY_TASK_ID, item_key: `telegram-history-reconciliation-${HISTORY_TASK_ID}`,
                    kind: 'telegram_history_reconciliation', state: 'blocked', assignee_role: 'publisher', due_at: this.dependencies.now(),
                    reason_code: history.reasonCode || 'MTPROTO_SESSION_UNAVAILABLE',
                    note: 'Release obligation retired; exact Telegram history reconciliation remains blocked. No resend is authorized.',
                    missing_resource_refs: [{ type: 'telegram_mtproto_session', project_id: params.projectId }],
                    input_context_version: task.content_revision, dedupe_key: `telegram_history_reconciliation:${params.projectId}:${HISTORY_TASK_ID}:r${task.content_revision}`,
                    result_payload: { provider_result_uncertain: true, resend_authorized: false, history_status: history.status } } });
                blockerWorkItemId = blocker.id;
            }
            const result = { project_id: params.projectId, project_slug: params.projectSlug,
                retired_count: retiredTaskIds.length, retired_task_ids: retiredTaskIds,
                reconciled_task_id: reconciledPublicationFactId ? HISTORY_TASK_ID : null,
                reconciled_publication_fact_id: reconciledPublicationFactId,
                reconciliation_blocker_work_item_id: blockerWorkItemId,
                publication_sent: false, connector_called: false, delivery_attempts_preserved: true,
                assets_preserved: true, work_items_preserved: blockerWorkItemId === null, replayed: false };
            const audit = await tx.workflowEvent.create({ data: { project_id: params.projectId, actor_id: params.actorId,
                command: COMMAND, idempotency_key: params.idempotencyKey,
                before_state: { request_fingerprint: fingerprint, reason: params.reason.trim(), approval_reference: params.approvalReference,
                    preview_hash: params.previewHash, manifest_checksum: params.expectedManifestChecksum,
                    task_state_sha256: preview.protected_hashes.task_state_sha256 },
                after_state: { request_fingerprint: fingerprint, result } } });
            return { ...result, audit_id: audit.id, replayed: false };
        });
    }

    private async loadUncertaintyProjection(client: any, params: RetirementUncertaintyParams) {
        if (params.projectId !== 10 || params.projectSlug !== 'analystcraft-2') throw new Error('[UNCERTAINTY_PROJECTION_SCOPE_MISMATCH]');
        if (!/^sha256:[a-f0-9]{64}$/.test(params.expectedManifestChecksum)) throw new Error('[MANIFEST_CHECKSUM_INVALID]');
        if (!params.approvalReference?.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
        await this.requireOwner(client, { ...params, expectedTasks: [], approvalReference: params.approvalReference });
        const retirementAudit = await client.workflowEvent.findFirst({ where: {
            id: params.expectedRetirementAuditId, project_id: 10, actor_id: params.actorId, command: COMMAND
        } });
        const retiredIds = (retirementAudit?.after_state as { result?: { retired_task_ids?: number[] } } | null)?.result?.retired_task_ids || [];
        if (!UNCERTAIN_TASK_IDS.every((id) => retiredIds.includes(id))) throw new Error('[RETIREMENT_AUDIT_GUARD_FAILED]');
        const tasks = await client.contentItem.findMany({ where: { project_id: 10, id: { in: [...UNCERTAIN_TASK_IDS] } },
            include: { publication_fact: true }, orderBy: { id: 'asc' } });
        if (tasks.length !== UNCERTAIN_TASK_IDS.length || tasks.some((task: any, index: number) => task.id !== UNCERTAIN_TASK_IDS[index]
            || task.status !== 'cancelled' || task.publication_mode !== 'retired' || task.publication_fact || task.published_link)) {
            throw new Error('[UNCERTAINTY_PROJECTION_TASK_GUARD_FAILED]');
        }
        return { tasks, retirementAudit };
    }

    private uncertaintyPreviewPayload(params: RetirementUncertaintyParams, loaded: { tasks: any[]; retirementAudit: any }) {
        const payload = {
            mode: 'preview' as const, dry_run: true as const, project_id: 10, project_slug: 'analystcraft-2',
            retirement_audit_id: loaded.retirementAudit.id,
            affected_task_ids: [...UNCERTAIN_TASK_IDS],
            changes: loaded.tasks.map((task) => ({ entity: 'content_item', id: task.id,
                path: 'quality_report.provider_result_uncertain', from: task.quality_report?.provider_result_uncertain ?? null, to: true })),
            protected_hashes: loaded.tasks.map((task) => ({ task_id: task.id,
                content_sha256: sha256({ draft_text: task.draft_text, content_revision: task.content_revision,
                    accepted_revision: task.accepted_revision, selected_asset_id: task.selected_asset_id, assets: task.assets }),
                quality_report_sha256: sha256(task.quality_report) })),
            unchanged_assertions: { status_and_publication_mode: true, publication_facts_and_links: true,
                content_revisions_assets_attempts_and_work_items: true, no_publish_connector_browser_or_outbox: true }
        };
        return { ...payload, preview_hash: sha256(payload) };
    }

    async previewUncertaintyProjection(params: RetirementUncertaintyParams) {
        return this.uncertaintyPreviewPayload(params, await this.loadUncertaintyProjection(this.db, params));
    }

    async applyUncertaintyProjection(params: ApplyRetirementUncertaintyParams) {
        if (!params.reason?.trim()) throw new Error('[RETIREMENT_REASON_REQUIRED]');
        if (!params.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        const fingerprint = sha256({ ...params, reason: params.reason.trim() });
        await this.requireOwner(this.db, { ...params, expectedTasks: [], approvalReference: params.approvalReference });
        const replayWhere = { project_id: 10, actor_id: params.actorId, command: UNCERTAINTY_COMMAND, idempotency_key: params.idempotencyKey };
        const existing = await this.db.workflowEvent.findFirst({ where: replayWhere });
        if (existing) {
            const after = existing.after_state as { request_fingerprint?: string; result?: Record<string, unknown> } | null;
            if (after?.request_fingerprint !== fingerprint) throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
            return { ...after.result, audit_id: existing.id, replayed: true };
        }
        const preview = await this.previewUncertaintyProjection(params);
        if (preview.preview_hash !== params.previewHash) throw new Error('[PREVIEW_CONFLICT] State changed since preview');
        return this.db.$transaction(async (tx: any) => {
            await this.requireOwner(tx, { ...params, expectedTasks: [], approvalReference: params.approvalReference });
            if (typeof tx.$queryRaw === 'function') await tx.$queryRaw(Prisma.sql`SELECT id FROM planner.content_items
                WHERE project_id = 10 AND id IN (${Prisma.join([...UNCERTAIN_TASK_IDS])}) ORDER BY id FOR UPDATE`);
            const loaded = await this.loadUncertaintyProjection(tx, params);
            const lockedPreview = this.uncertaintyPreviewPayload(params, loaded);
            if (lockedPreview.preview_hash !== params.previewHash) throw new Error('[PREVIEW_CONFLICT] State changed since preview');
            for (const task of loaded.tasks) {
                const changed = await tx.contentItem.updateMany({ where: { id: task.id, project_id: 10,
                    status: 'cancelled', publication_mode: 'retired', publication_fact: null },
                data: { quality_report: { ...((task.quality_report as Record<string, unknown> | null) || {}), provider_result_uncertain: true } } });
                if (changed.count !== 1) throw new Error(`[UNCERTAINTY_PROJECTION_CAS_CONFLICT] Task ${task.id}`);
            }
            const result = { project_id: 10, retirement_audit_id: params.expectedRetirementAuditId,
                updated_task_ids: [...UNCERTAIN_TASK_IDS], provider_result_uncertain: true,
                publication_sent: false, connector_called: false, protected_fields_preserved: true, replayed: false };
            const audit = await tx.workflowEvent.create({ data: { project_id: 10, actor_id: params.actorId,
                command: UNCERTAINTY_COMMAND, idempotency_key: params.idempotencyKey,
                before_state: { request_fingerprint: fingerprint, preview_hash: params.previewHash,
                    approval_reference: params.approvalReference, reason: params.reason.trim(), protected_hashes: preview.protected_hashes },
                after_state: { request_fingerprint: fingerprint, result } } });
            return { ...result, audit_id: audit.id, replayed: false };
        });
    }
}

export default new PublicationRetirementService();
