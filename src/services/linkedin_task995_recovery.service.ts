import { createHash } from 'crypto';
import prisma from '../db';
import linkedinService from './linkedin.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const TASK_ID = 995;
const PROJECT_ID = 7;
const CHANNEL_ID = 5;
const REVISION = 1;
const BODY_SHA256 = '807c2ee9d0815e55c2b94f7730ac35459d660a122e27b61b56b4e67ea66eb41e';
const IDEMPOTENCY_KEY = `linkedin:${PROJECT_ID}:${TASK_ID}:${REVISION}:${BODY_SHA256}:${CHANNEL_ID}`;

type Dependencies = {
    db: any;
    linkedin: { findRecentPublishedPosts(urn: string, token: string): Promise<{
        available: boolean; reason?: string; posts: Array<{ urn: string; permalink: string; text: string }>;
    }> };
    facts: { record(args: any): Promise<any> };
    hashBody?: (body: string) => string;
};

export class LinkedInTask995RecoveryService {
    constructor(private readonly deps: Dependencies) {}

    private hash(body: string) {
        return (this.deps.hashBody || ((value: string) => createHash('sha256').update(value).digest('hex')))(body);
    }

    private async loadTask() {
        const task = await this.deps.db.contentItem.findFirst({ where: { id: TASK_ID, project_id: PROJECT_ID },
            include: { channel: true, publication_fact: true } });
        if (!task || task.channel_id !== CHANNEL_ID || task.channel?.type !== 'linkedin'
            || task.content_revision !== REVISION || task.accepted_revision !== REVISION
            || task.text_state !== 'accepted' || task.visual_state !== 'NO_VISUAL_NEEDED'
            || task.selected_asset_id !== null || this.hash(task.draft_text || '') !== BODY_SHA256
            || task.publication_fact || task.published_link) {
            throw new Error('[LINKEDIN_995_GUARD_FAILED] Exact unconfirmed accepted task required');
        }
        return task;
    }

    async protectHistoricalAttempt() {
        const task = await this.loadTask();
        const existing = await this.deps.db.deliveryAttempt.findFirst({ where: {
            project_id: PROJECT_ID, content_item_id: TASK_ID, channel_id: CHANNEL_ID,
            idempotency_key: IDEMPOTENCY_KEY
        }, orderBy: { id: 'desc' } });
        if (existing) return { state: existing.status === 'delivered' ? 'confirmed' : 'UNKNOWN',
            attempt_id: existing.id, replayed: true, resend_allowed: false };

        const attempt = await this.deps.db.$transaction(async (tx: any) => {
            const claimed = await tx.contentItem.updateMany({ where: {
                id: TASK_ID, project_id: PROJECT_ID, channel_id: CHANNEL_ID,
                status: 'ready_for_execution', content_revision: REVISION, accepted_revision: REVISION
            }, data: { status: 'publishing', quality_report: {
                ...((task.quality_report as any) || {}),
                publication_task_delivery: { state: 'provider_result_unknown', idempotency_key: IDEMPOTENCY_KEY,
                    retry_via_api: false, incident: 'LINKEDIN-995-ADAPTER-UNCONFIRMED' }
            } } });
            if (claimed.count !== 1) {
                const replay = await tx.deliveryAttempt.findFirst({ where: { idempotency_key: IDEMPOTENCY_KEY }, orderBy: { id: 'desc' } });
                if (replay) return replay;
                throw new Error('[LINKEDIN_995_ALREADY_CLAIMED] Reconcile; do not resend');
            }
            const created = await tx.deliveryAttempt.create({ data: {
                project_id: PROJECT_ID, content_item_id: TASK_ID, channel_id: CHANNEL_ID,
                mode: 'automatic', status: 'verification_required', attempt_number: 1,
                idempotency_key: IDEMPOTENCY_KEY, requires_manual_confirmation: true,
                error_message: 'Historical provider call has no confirmed provider object or permalink; resend prohibited'
            } });
            await tx.workflowEvent.create({ data: {
                project_id: PROJECT_ID, content_item_id: TASK_ID, actor_id: 'system:incident-recovery',
                command: 'register_linkedin_995_unconfirmed_attempt', idempotency_key: IDEMPOTENCY_KEY,
                before_state: { status: task.status }, after_state: {
                    status: 'publishing', attempt_id: created.id, state: 'UNKNOWN', resend_allowed: false,
                    body_sha256: BODY_SHA256, content_revision: REVISION, channel_id: CHANNEL_ID
                }
            } });
            return created;
        });
        return { state: 'UNKNOWN', attempt_id: attempt.id, replayed: false, resend_allowed: false };
    }

    async reconcile() {
        const task = await this.loadTask();
        const attempt = await this.deps.db.deliveryAttempt.findFirst({ where: {
            project_id: PROJECT_ID, content_item_id: TASK_ID, idempotency_key: IDEMPOTENCY_KEY
        }, orderBy: { id: 'desc' } });
        if (!attempt || attempt.status !== 'verification_required') {
            throw new Error('[LINKEDIN_995_ATTEMPT_REQUIRED] Protect the historical attempt first');
        }
        const config = resolveEffectiveChannelConfig('linkedin', task.channel.config || {});
        if (!config.linkedin_urn || !config.access_token) throw new Error('[LINKEDIN_RECONCILIATION_UNAVAILABLE] Missing read credentials');
        const readback = await this.deps.linkedin.findRecentPublishedPosts(config.linkedin_urn, config.access_token);
        if (!readback.available) return { state: 'UNKNOWN', attempt_id: attempt.id, resend_allowed: false,
            reconciliation: 'unavailable', reason: readback.reason || 'read_scope_unavailable' };
        const exact = readback.posts.filter(post => this.hash(post.text || '') === BODY_SHA256
            && /^https:\/\/(www\.)?linkedin\.com\/feed\/update\/urn:li:(ugcPost|share):\d+\/?$/.test(post.permalink));
        if (exact.length !== 1) return { state: 'UNKNOWN', attempt_id: attempt.id, resend_allowed: false,
            reconciliation: exact.length === 0 ? 'not_found' : 'ambiguous' };
        const owner = await this.deps.db.projectMember.findFirst({ where: { project_id: PROJECT_ID, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED]');
        const match = exact[0];
        await this.deps.facts.record({ projectId: PROJECT_ID, taskId: TASK_ID, actorId: `user:${owner.user_id}`,
            artifactKind: 'post', outcome: 'published', publishedAt: new Date().toISOString(),
            publicUrl: match.permalink, providerObjectId: match.urn, confirmationMode: 'automatic',
            evidence: { type: 'provider_readback', ref: match.permalink },
            note: 'LinkedIn publication confirmed by read-only exact-body reconciliation' });
        await this.deps.db.deliveryAttempt.update({ where: { id: attempt.id }, data: {
            status: 'delivered', actual_published_at: new Date(), requires_manual_confirmation: false, error_message: null
        } });
        return { state: 'confirmed', attempt_id: attempt.id, permalink: match.permalink,
            provider_object_id: match.urn, resend_allowed: false };
    }
}

export default new LinkedInTask995RecoveryService({ db: prisma, linkedin: linkedinService, facts: publicationFactService });
