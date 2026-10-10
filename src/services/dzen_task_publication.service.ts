import { createHash } from 'crypto';
import prisma from '../db';
import dzenService, { isDzenPublishedUrl } from './dzen.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { publicDzenArticleTitle } from './dzen_public_title';

const TASKS = {
    1045: {
        bodySha256: '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1',
        decisionId: 267, releaseCommand: 'ba_release_approved_dzen_task',
        verifyCommand: 'ba_verify_dzen_task1045_connector', revision: 4, placement: 'article_cover',
        visualState: 'APPROVED', selectedAssetId: 129, publicationType: 'article' as const,
        allowedStatuses: ['ready_for_execution'],
        assetSha256: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b',
        decisionChannel: 'dzen'
    },
    1036: {
        bodySha256: '84f8f3ea79c4f252216e7568aa12a84eff08f685f33d4da360b94c8d8073e0fa',
        decisionId: 253, releaseCommand: 'ba_release_approved_dzen_task',
        verifyCommand: 'ba_verify_dzen_task1036_connector', revision: 2, placement: 'article_cover',
        visualState: 'APPROVED', selectedAssetId: 122, publicationType: 'article' as const,
        allowedStatuses: ['ready_for_execution'],
        assetSha256: '8cbe7cecab92124712292d4d2b6723cee113d6dadec6d0a3ac6d952aeec925ba',
        decisionChannel: 'dzen'
    },
    999: {
        bodySha256: '78ffd5316ab3ffc4679d67788ec57f39558760917e70522d8ba0647a1f68b130',
        decisionId: 241, releaseCommand: 'ba_release_approved_dzen_task',
        verifyCommand: 'ba_verify_dzen_task999_connector', revision: 2, placement: 'article_cover',
        visualState: 'APPROVED', selectedAssetId: 114, publicationType: 'article' as const,
        allowedStatuses: ['ready_for_execution'],
        assetSha256: 'd06c7ce1c3533dc1db76799bda8eff1395a9dde4e05684c593b16bd064479b1c',
        decisionChannel: 'dzen'
    },
    958: {
        bodySha256: '78081837cecace18c91c01af0253b21ca502e611b63a016f9d9035567587dfd3',
        decisionId: 147,
        releaseCommand: 'ba_release_approved_dzen_task958',
        verifyCommand: 'ba_verify_dzen_task958_connector', revision: 1, placement: 'feed',
        visualState: 'NO_VISUAL_NEEDED', selectedAssetId: null, publicationType: 'post' as const,
        allowedStatuses: ['ready_for_execution'], assetSha256: null, decisionChannel: 'analystcraft_dzen'
    },
    962: {
        bodySha256: '15c9b4a2e874439c4952900002ae5677fc3a6b6e8794dd34a0a4ae5f03dba798',
        decisionId: 146,
        releaseCommand: 'ba_release_approved_dzen_task962',
        verifyCommand: 'ba_verify_dzen_task962_connector', revision: 1, placement: 'feed',
        visualState: 'NO_VISUAL_NEEDED', selectedAssetId: null, publicationType: 'post' as const,
        allowedStatuses: ['ready_for_execution'], assetSha256: null, decisionChannel: 'analystcraft_dzen'
    },
    992: {
        bodySha256: '62af2b8e32d3aabb2b3d6f7029ee2b7ec64a7f9329eef01e52d6c4591e7eb150',
        decisionId: 186,
        releaseCommand: 'ba_release_approved_dzen_task992',
        verifyCommand: 'ba_verify_dzen_task992_connector', revision: 3, placement: 'article_cover',
        visualState: 'APPROVED', selectedAssetId: 102, publicationType: 'article' as const,
        allowedStatuses: ['awaiting_manual_publication', 'ready_for_execution'],
        assetSha256: 'b5eafee417e13a2f1becc14a4b66629f31f11cfd68b4b887a240d3e552b3b944',
        decisionChannel: 'dzen'
    },
    1031: {
        bodySha256: '077cee100dbd11648050febacc6f071a407998753855ae3b2e82551175990b6e',
        decisionId: null,
        releaseCommand: 'ba_release_approved_dzen_task',
        verifyCommand: 'ba_verify_dzen_task1031_connector', revision: 3, placement: 'article_cover',
        visualState: 'NO_VISUAL_NEEDED', selectedAssetId: null, publicationType: 'article' as const,
        allowedStatuses: ['ready_for_execution'], assetSha256: null, decisionChannel: 'dzen'
    }
} as const;

const DZEN_992_RECOVERY_COMMAND = 'ba_confirm_dzen_task992_absent_and_authorize_retry';

function taskSpec(taskId: number) {
    const spec = TASKS[taskId as keyof typeof TASKS];
    if (!spec) throw new Error('[DZEN_TASK_SCOPE_MISMATCH] Exact released Dzen task required');
    return {
        ...spec,
        taskId,
        command: `ba_publish_dzen_task${taskId}`,
        claimCommand: `ba_publish_dzen_task${taskId}_claim`,
        actor: `system:planner-mcp:dzen-task${taskId}`
    };
}

type Args = { projectId: number; taskId: number; dryRun?: boolean; idempotencyKey?: string };
type DzenStudioPublicationReadback = {
    title: string | null;
    public_url: string | null;
    provider_object_id: string | null;
    published_at: string | null;
    state?: 'published' | 'draft' | 'unknown';
};
type Dependencies = {
    db: any;
    dzen: {
        publishPost(config: any, text: string, imageUrl?: string, title?: string, type?: 'article' | 'post'): Promise<string>;
        testConnection(config: any): Promise<any>;
        readStudioPublications(config: { cookies?: string; channel_id?: string; [key: string]: unknown }): Promise<{
            authenticated: boolean;
            editor_available: boolean;
            editor_url: string;
            publications_payload_received: boolean;
            title_readback_complete: boolean;
            publication_timestamp_readback_complete: boolean;
            state_readback_complete?: boolean;
            coverage_complete?: boolean;
            publications: DzenStudioPublicationReadback[];
            checked_at: string;
        }>;
    };
    facts: { record(args: any): Promise<any> };
    hashBody?: (body: string) => string;
};

export class DzenTaskPublicationService {
    constructor(private readonly dependencies: Dependencies) {}

    /** Audited provider readback for the single frozen Dzen #1045 attempt. Never sends or records a fact. */
    async reconcileTask1045(args: { projectId: 10; taskId: 1045; actorId: string;
        expectedAttemptIdempotencyKey: 'dzen-p10-1045-r4-asset129-recovery-20261010-01';
        idempotencyKey: string }) {
        const incidentKey = 'dzen-p10-1045-r4-asset129-recovery-20261010-01';
        if (args.projectId !== 10 || args.taskId !== 1045
            || args.expectedAttemptIdempotencyKey !== incidentKey || !args.idempotencyKey.trim()) {
            throw new Error('[DZEN_1045_RECONCILIATION_GUARD_FAILED]');
        }
        const match = /^user:(\d+)$/.exec(args.actorId);
        if (!match) throw new Error('[OWNER_REQUIRED]');
        const { db, dzen } = this.dependencies;
        const member = await db.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: 10, user_id: Number(match[1])
        } } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = 'ba_reconcile_dzen_task1045_uncertain_attempt';
        const prior = await db.workflowEvent.findUnique({ where: {
            project_id_actor_id_command_idempotency_key: { project_id: 10, actor_id: args.actorId,
                command, idempotency_key: args.idempotencyKey }
        } });
        if (prior?.after_state) return { ...prior.after_state, replayed: true };
        const task = await db.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const spec = taskSpec(1045);
        const bodyHash = (this.dependencies.hashBody
            || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
        const assetSha = task?.selected_asset?.provenance?.planner_storage?.sha256
            || task?.selected_asset?.provenance?.sha256 || null;
        const delivery = task?.quality_report?.publication_task_delivery;
        const claim = await db.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: spec.claimCommand, idempotency_key: incidentKey }, orderBy: { id: 'desc' } });
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
            || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
            || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
            || task.title !== 'W41 allocation #24 — Dzen'
            || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
            || task.visual_decision_version !== 1 || task.selected_asset_id !== 129
            || task.selected_asset?.status !== 'approved' || task.selected_asset?.content_revision !== 4
            || assetSha !== spec.assetSha256 || bodyHash !== spec.bodySha256
            || task.publication_fact || task.published_link
            || delivery?.state !== 'provider_result_uncertain' || delivery?.idempotency_key !== incidentKey
            || delivery?.retry_via_api !== false || claim?.after_state?.status !== 'publishing'
            || claim?.after_state?.channel_id !== 116) {
            throw new Error('[DZEN_1045_RECONCILIATION_GUARD_FAILED] Exact frozen attempt changed');
        }
        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        if (!config.cookies?.trim() || !config.channel_id) {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Missing authenticated session or channel ID');
        }
        let check: Awaited<ReturnType<Dependencies['dzen']['readStudioPublications']>> | null = null;
        let providerReadFailed = false;
        try {
            check = await dzen.readStudioPublications(config);
        } catch {
            providerReadFailed = true;
        }
        const normalizeTitle = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');
        const expectedTitle = normalizeTitle('W41 allocation #24 — Dzen');
        const publications = check?.authenticated === true && check?.editor_available === true
            && check.publications_payload_received === true && Array.isArray(check.publications)
            ? check.publications : [];
        const exactMatches = publications.filter((publication) => typeof publication.title === 'string'
            && normalizeTitle(publication.title) === expectedTitle);
        const publishedMatches = exactMatches.filter((publication) => publication.state === 'published'
            && Boolean(publication.public_url && publication.provider_object_id && publication.published_at));
        const draftMatches = exactMatches.filter((publication) => publication.state === 'draft');
        const completeAbsenceEvidence = !providerReadFailed && check?.authenticated === true
            && check?.editor_available === true && check.publications_payload_received === true
            && check.title_readback_complete === true && check.state_readback_complete === true
            && check.coverage_complete === true && exactMatches.length === 0;
        const classification = publishedMatches.length === 1 && exactMatches.length === 1
            ? 'exact_published_match'
            : draftMatches.length > 0 && publishedMatches.length === 0
                ? 'exact_draft_match'
                : completeAbsenceEvidence ? 'confirmed_absent' : 'inconclusive';
        const published = classification === 'exact_published_match' ? publishedMatches[0] : null;
        const result = { task_id: 1045, channel_id: 116, content_revision: 4, accepted_revision: 4,
            body_sha256: spec.bodySha256, selected_asset_id: 129, asset_sha256: spec.assetSha256,
            previous_idempotency_key: incidentKey, prior_claim_event_id: claim.id,
            classification, retry_safe: classification === 'confirmed_absent', resend_authorized: false,
            retry_via_api: false, public_url: published?.public_url || null,
            provider_object_id: published?.provider_object_id || null,
            published_at: published?.published_at || null,
            matching_draft_ids: draftMatches.map((item) => item.provider_object_id).filter(Boolean),
            exact_title_matches: exactMatches.length, publications_scanned: publications.length,
            studio_authenticated: check?.authenticated === true,
            publications_payload_received: check?.publications_payload_received === true,
            title_readback_complete: check?.title_readback_complete === true,
            state_readback_complete: check?.state_readback_complete === true,
            coverage_complete: check?.coverage_complete === true,
            provider_read_failed: providerReadFailed, publication_fact_id: null,
            checked_at: check?.checked_at || new Date().toISOString(), replayed: false };
        await db.$transaction(async (tx: typeof db) => {
            if (classification === 'confirmed_absent') {
                const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    status: 'publishing', publication_mode: 'owner_released', content_revision: 4,
                    accepted_revision: 4, selected_asset_id: 129 }, data: { quality_report: {
                    ...(task.quality_report || {}), publication_task_delivery: {
                        ...delivery, state: 'confirmed_absent_reconciliation', retry_safe: true,
                        retry_via_api: false, resend_authorized: false,
                        reconciliation_idempotency_key: args.idempotencyKey,
                        reconciled_at: result.checked_at
                    }
                } } });
                if (changed.count !== 1) throw new Error('[DZEN_1045_RECONCILIATION_CAS_CONFLICT]');
            }
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { status: task.status, publication_task_delivery: delivery,
                    claim_event_id: claim.id }, after_state: result } });
        });
        return result;
    }

    async confirmAbsentAndAuthorizeRetry(args: { projectId: number; taskId: 992; actorId: string;
        idempotencyKey: string; resendIdempotencyKey: string; evidenceReference: string }) {
        if (args.projectId !== 10 || args.taskId !== 992) throw new Error('[DZEN_TASK_SCOPE_MISMATCH]');
        const match = /^user:(\d+)$/.exec(args.actorId);
        if (!match) throw new Error('[OWNER_REQUIRED]');
        const { db } = this.dependencies;
        const member = await db.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: 10, user_id: Number(match[1]) }
        } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const prior = await db.workflowEvent.findUnique({ where: {
            project_id_actor_id_command_idempotency_key: {
                project_id: 10, actor_id: args.actorId, command: DZEN_992_RECOVERY_COMMAND,
                idempotency_key: args.idempotencyKey
            }
        } });
        if (prior?.after_state) return { ...prior.after_state, replayed: true };
        const task = await db.contentItem.findFirst({
            where: { id: 992, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        const spec = taskSpec(992);
        const bodyHash = (this.dependencies.hashBody
            || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
        const assetSha = task?.selected_asset?.provenance?.planner_storage?.sha256
            || task?.selected_asset?.provenance?.sha256 || null;
        const delivery = task?.quality_report?.publication_task_delivery;
        const priorIncidentKey = typeof delivery?.idempotency_key === 'string'
            ? delivery.idempotency_key.trim()
            : '';
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
            || !['publishing', 'ready_for_execution'].includes(task.status)
            || task.publication_mode !== 'owner_released'
            || task.content_revision !== spec.revision || task.accepted_revision !== spec.revision
            || task.text_state !== 'accepted' || task.visual_placement !== spec.placement
            || task.visual_state !== spec.visualState || task.selected_asset_id !== spec.selectedAssetId
            || task.selected_asset?.status !== 'approved' || task.selected_asset?.content_revision !== spec.revision
            || assetSha !== spec.assetSha256 || bodyHash !== spec.bodySha256
            || task.publication_fact || task.published_link
            || delivery?.state !== 'provider_result_uncertain'
            || !priorIncidentKey || delivery?.retry_via_api !== false) {
            throw new Error('[DZEN_992_CONFIRMED_ABSENT_GUARD_FAILED]');
        }
        const priorClaim = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: 992, command: spec.claimCommand,
            idempotency_key: priorIncidentKey
        }, orderBy: { id: 'desc' } });
        if (priorClaim?.after_state?.status !== 'publishing'
            || priorClaim?.after_state?.channel_id !== 116) {
            throw new Error('[DZEN_992_DURABLE_INCIDENT_CLAIM_REQUIRED]');
        }
        const reconciliation = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: 992, command: 'reconcile_dzen_task992_uncertain_attempt'
        }, orderBy: { id: 'desc' } });
        const readback = reconciliation?.after_state;
        if (readback?.classification !== 'not_confirmed' || readback?.exact_title_matches !== 0
            || readback?.publication_fact_id !== null || readback?.studio_authenticated !== true
            || readback?.publications_payload_received !== true || readback?.title_readback_complete !== true
            || readback?.previous_idempotency_key !== priorIncidentKey
            || readback?.prior_claim_event_id !== priorClaim.id
            || readback?.selected_asset_id !== spec.selectedAssetId
            || readback?.asset_sha256 !== spec.assetSha256) {
            throw new Error('[DZEN_992_PROVIDER_READBACK_REQUIRED]');
        }
        const resendKey = args.resendIdempotencyKey.trim();
        if (!resendKey || resendKey === priorIncidentKey) {
            throw new Error('[DZEN_992_RETRY_KEY_MUST_BE_NEW]');
        }
        const after = { task_id: 992, channel_id: 116, content_revision: 3, accepted_revision: 3,
            visual_decision_id: 186, selected_asset_id: spec.selectedAssetId,
            asset_sha256: spec.assetSha256, classification: 'confirmed_absent',
            previous_idempotency_key: priorIncidentKey,
            authorized_idempotency_key: resendKey,
            resend_safe: true, publication_fact_id: null, history_preserved: true };
        await db.$transaction(async (tx: typeof db) => {
            const changed = await tx.contentItem.updateMany({ where: {
                id: 992, project_id: 10, channel_id: 116, status: task.status,
                publication_mode: 'owner_released', content_revision: 3, accepted_revision: 3,
                selected_asset_id: spec.selectedAssetId
            }, data: { status: 'ready_for_execution', quality_report: {
                ...(task.quality_report || {}), publication_task_delivery: {
                    state: 'confirmed_absent_retry_authorized', channel_type: 'dzen',
                    previous_idempotency_key: priorIncidentKey,
                    authorized_idempotency_key: resendKey, retry_via_api: true,
                    owner_evidence: { type: 'owner_provider_readback', ref: args.evidenceReference },
                    prior_reconciliation_event_id: reconciliation.id,
                    authorized_at: new Date().toISOString()
                }
            } } });
            if (changed.count !== 1) throw new Error('[DZEN_992_CONFIRMED_ABSENT_CAS_CONFLICT]');
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: 992, actor_id: args.actorId,
                command: spec.releaseCommand, idempotency_key: args.idempotencyKey,
                before_state: { selected_asset_id: task.selected_asset_id, status: task.status },
                after_state: {
                    task_id: 992, channel_id: 116, content_revision: 3, accepted_revision: 3,
                    body_sha256: spec.bodySha256, visual_decision_id: spec.decisionId,
                    selected_asset_id: spec.selectedAssetId, asset_sha256: spec.assetSha256,
                    schedule_at: task.schedule_at ? task.schedule_at.toISOString() : null,
                    publication_mode: 'owner_released',
                    approval_reference: args.evidenceReference,
                    rebound_from_asset_id: 97
                }
            } });
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: 992, actor_id: args.actorId,
                command: DZEN_992_RECOVERY_COMMAND, idempotency_key: args.idempotencyKey,
                before_state: { status: task.status, publication_task_delivery: delivery,
                    reconciliation_event_id: reconciliation.id },
                after_state: { ...after, evidence_reference: args.evidenceReference }
            } });
        });
        return { ...after, replayed: false };
    }

    async verifyConnector(args: { projectId: number; taskId: number; actorId: string; idempotencyKey: string }) {
        if (args.projectId !== 10) throw new Error('[DZEN_TASK_SCOPE_MISMATCH]');
        const spec = taskSpec(args.taskId);
        const match = /^user:(\d+)$/.exec(args.actorId);
        if (!match) throw new Error('[OWNER_REQUIRED]');
        const { db, dzen } = this.dependencies;
        const member = await db.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: 10, user_id: Number(match[1]) }
        } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const project = await db.project.findUnique({ where: { id: 10 }, select: { slug: true } });
        if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
        const prior = await db.workflowEvent.findFirst({ where: {
            project_id: 10, actor_id: args.actorId,
            command: spec.verifyCommand, idempotency_key: args.idempotencyKey
        } });
        const task = await db.contentItem.findFirst({
            where: { id: spec.taskId, project_id: 10 }, include: { channel: true, selected_asset: true, publication_fact: true }
        });
        const hash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
        const assetSha = task?.selected_asset?.provenance?.planner_storage?.sha256
            || task?.selected_asset?.provenance?.sha256 || null;
        const delivery = task?.quality_report?.publication_task_delivery;
        const frozenIncidentKey = typeof delivery?.idempotency_key === 'string'
            ? delivery.idempotency_key.trim()
            : '';
        const frozen992Candidate = spec.taskId === 992
            && ['publishing', 'ready_for_execution'].includes(task?.status || '')
            && delivery?.state === 'provider_result_uncertain'
            && Boolean(frozenIncidentKey)
            && delivery?.retry_via_api === false;
        const frozenClaim = frozen992Candidate ? await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: 992, command: spec.claimCommand,
            idempotency_key: frozenIncidentKey
        }, orderBy: { id: 'desc' } }) : null;
        const frozen992 = frozen992Candidate
            && frozenClaim?.after_state?.status === 'publishing'
            && frozenClaim?.after_state?.channel_id === 116;
        if (prior?.after_state && (!frozen992 || prior.after_state.reconciliation)) return prior.after_state;
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
            || task.publication_mode !== 'owner_released'
            || (!spec.allowedStatuses.includes(task.status) && !frozen992)
            || task.content_revision !== spec.revision || task.accepted_revision !== spec.revision
            || task.visual_placement !== spec.placement || task.visual_state !== spec.visualState
            || task.selected_asset_id !== spec.selectedAssetId
            || (spec.selectedAssetId !== null && (task.selected_asset?.status !== 'approved'
                || task.selected_asset?.content_revision !== spec.revision
                || assetSha !== spec.assetSha256 || !/^https:\/\//.test(task.selected_asset?.file_url || '')))
            || hash !== spec.bodySha256 || task.publication_fact || task.published_link) {
            throw new Error('[DZEN_CONNECTOR_PREFLIGHT_GUARD_FAILED]');
        }
        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        if (!config.cookies?.trim() || !config.channel_id) throw new Error('[DZEN_CONNECTOR_NOT_READY] Missing authenticated session or channel ID');
        const check = frozen992
            ? await dzen.readStudioPublications(config)
            : await dzen.testConnection(config);
        if (check?.authenticated !== true || check?.editor_available !== true
            || !String(check?.editor_url || '').includes(`/id/${config.channel_id}`)) {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Authenticated channel editor was not verified');
        }
        let reconciliation: Record<string, unknown> | undefined;
        if (frozen992) {
            if (check?.publications_payload_received !== true || check?.title_readback_complete !== true
                || !Array.isArray(check?.publications) || !task.title?.trim()) {
                throw new Error('[DZEN_992_PROVIDER_READBACK_INCOMPLETE] Retry remains forbidden');
            }
            const normalizeTitle = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');
            const acceptedTitle = normalizeTitle(publicDzenArticleTitle(spec.taskId, task.draft_text, task.title) || '');
            const publications = check.publications as DzenStudioPublicationReadback[];
            const exactMatches = publications.filter((publication) =>
                typeof publication?.title === 'string' && normalizeTitle(publication.title) === acceptedTitle
            );
            if (exactMatches.some((publication) => !publication.published_at)) {
                throw new Error('[DZEN_992_PROVIDER_TIMESTAMP_READBACK_INCOMPLETE] Fact recording remains forbidden');
            }
            reconciliation = {
                task_id: 992, channel_id: 116, accepted_revision: 3,
                previous_idempotency_key: frozenIncidentKey,
                prior_claim_event_id: frozenClaim.id,
                selected_asset_id: spec.selectedAssetId,
                asset_sha256: spec.assetSha256,
                retry_via_api: false,
                classification: exactMatches.length === 0 ? 'not_confirmed' : 'exact_match_found',
                exact_title_matches: exactMatches.length,
                matching_public_urls: exactMatches.map((publication) => publication.public_url).filter(Boolean),
                matching_provider_object_ids: exactMatches.map((publication) => publication.provider_object_id).filter(Boolean),
                matching_published_at: exactMatches.map((publication) => publication.published_at).filter(Boolean),
                publications_scanned: check.publications.length,
                publication_fact_id: null,
                studio_authenticated: true,
                publications_payload_received: true,
                title_readback_complete: true,
                publication_timestamp_readback_complete: check.publication_timestamp_readback_complete === true,
                checked_at: check.checked_at || new Date().toISOString()
            };
        }
        const result = { task_id: spec.taskId, channel_id: 116, body_sha256: hash,
            ...(spec.selectedAssetId !== null ? {
                selected_asset_id: spec.selectedAssetId, asset_sha256: spec.assetSha256
            } : {}),
            authenticated: true, editor_available: true, checked_at: new Date().toISOString(),
            ...(reconciliation ? { reconciliation } : {}) };
        await db.$transaction(async (tx: typeof db) => {
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: spec.taskId, actor_id: args.actorId,
                command: spec.verifyCommand, idempotency_key: args.idempotencyKey,
                before_state: { task_id: spec.taskId, channel_id: 116, body_sha256: hash, status: task.status },
                after_state: result
            } });
            if (reconciliation) await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: 992, actor_id: args.actorId,
                command: 'reconcile_dzen_task992_uncertain_attempt',
                idempotency_key: args.idempotencyKey,
                before_state: { status: task.status, publication_task_delivery: delivery },
                after_state: reconciliation
            } });
        });
        return result;
    }

    async execute(args: Args) {
        if (args.projectId !== 10) throw new Error('[DZEN_TASK_SCOPE_MISMATCH]');
        const spec = taskSpec(args.taskId);
        const { db, dzen, facts } = this.dependencies;
        const key = args.idempotencyKey?.trim() || null;
        if (!args.dryRun && !key) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        if (key) {
            const cached = await db.workflowEvent.findUnique({ where: {
                project_id_actor_id_command_idempotency_key: {
                    project_id: 10, actor_id: spec.actor, command: spec.command, idempotency_key: key
                }
            } });
            if (cached?.after_state) return { ...cached.after_state, replayed: true };
        }
        const task = await db.contentItem.findFirst({
            where: { id: spec.taskId, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen') {
            throw new Error('[DZEN_TASK_MISMATCH]');
        }
        if (task.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return { mode: 'published', task_id: spec.taskId, published_link: task.publication_fact.public_url,
                external_id: task.publication_fact.provider_object_id || null, replayed: true };
        }
        const release = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: spec.taskId, command: spec.releaseCommand
        }, orderBy: { id: 'desc' } });
        const proof = release?.after_state as any;
        const bodyHash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task.draft_text || '');
        const decision = await db.artDirectionDecision.findFirst({ where: {
            ...(spec.decisionId !== null ? { id: spec.decisionId } : {}),
            project_id: 10, content_item_id: spec.taskId,
            source_content_revision: spec.revision, channel: spec.decisionChannel, placement: spec.placement,
            ...(spec.visualState === 'NO_VISUAL_NEEDED' ? { decision: 'NO_VISUAL_NEEDED' } : {}), status: 'active'
        }, orderBy: { decision_version: 'desc' } });
        const selectedAsset = task.selected_asset;
        const selectedAssetSha = selectedAsset?.provenance?.planner_storage?.sha256
            || selectedAsset?.provenance?.sha256 || null;
        const validSelectedAsset = spec.selectedAssetId === null
            ? task.selected_asset_id === null
            : task.selected_asset_id === spec.selectedAssetId && selectedAsset?.id === spec.selectedAssetId
                && selectedAsset.status === 'approved' && selectedAsset.content_revision === spec.revision
                && /^https:\/\//.test(selectedAsset.file_url || '')
                && selectedAssetSha === spec.assetSha256;
        if (!proof || proof.task_id !== spec.taskId || proof.channel_id !== 116
            || proof.content_revision !== spec.revision || proof.accepted_revision !== spec.revision
            || proof.body_sha256 !== spec.bodySha256 || proof.body_sha256 !== bodyHash
            || proof.visual_decision_id !== decision?.id
            || (spec.selectedAssetId !== null && proof.selected_asset_id !== spec.selectedAssetId)
            || (spec.assetSha256 !== null && proof.asset_sha256 !== spec.assetSha256)
            || proof.schedule_at !== (task.schedule_at ? task.schedule_at.toISOString() : null)
            || proof.publication_mode !== 'owner_released'
            || task.content_revision !== spec.revision || task.accepted_revision !== spec.revision
            || task.text_state !== 'accepted' || task.visual_placement !== spec.placement
            || task.visual_state !== spec.visualState || !validSelectedAsset
            || task.visual_decision_version !== decision?.decision_version
            || task.handoff_state !== 'ready' || task.publication_mode !== 'owner_released'
            || !decision || task.published_link) {
            throw new Error('[DZEN_OWNER_RELEASE_PROOF_MISMATCH]');
        }
        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        const connectorProof = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: spec.taskId,
            command: spec.verifyCommand
        }, orderBy: { id: 'desc' } });
        const verified = connectorProof?.after_state as any;
        const connectorReady = Boolean(config.cookies?.trim()) && Boolean(config.channel_id)
            && verified?.task_id === spec.taskId && verified?.channel_id === 116
            && verified?.body_sha256 === spec.bodySha256 && verified?.authenticated === true
            && (spec.selectedAssetId === null || (verified?.selected_asset_id === spec.selectedAssetId
                && verified?.asset_sha256 === spec.assetSha256))
            && verified?.editor_available === true
            && Date.now() - new Date(verified.checked_at || 0).getTime() < 15 * 60_000;
        const publicTitle = spec.publicationType === 'article'
            ? publicDzenArticleTitle(spec.taskId, task.draft_text, task.title) : null;
        const preview = { text: task.draft_text, ...(spec.publicationType === 'article' ? { title: publicTitle } : {}),
            has_image: Boolean(selectedAsset), ...(selectedAsset ? { image_url: selectedAsset.file_url } : {}),
            publication_type: spec.publicationType, channel_id: 116, accepted_revision: spec.revision,
            visual_decision_id: decision?.id, ...(selectedAsset ? { selected_asset_id: selectedAsset.id } : {}) };
        if (args.dryRun) return { mode: 'dry_run', task_id: spec.taskId, project_id: 10,
            route_executable: connectorReady && spec.allowedStatuses.includes(task.status),
            connector_ready: connectorReady,
            ...(!connectorReady ? { route_blocker: 'DZEN_CONNECTOR_NOT_READY' }
                : !spec.allowedStatuses.includes(task.status) ? { route_blocker: 'PUBLICATION_ROUTE_NOT_EXECUTABLE' } : {}),
            payload_preview: preview };
        if (!connectorReady) throw new Error('[DZEN_CONNECTOR_NOT_READY] Channel requires enabled API publication and authenticated session');
        if (!spec.allowedStatuses.includes(task.status)) throw new Error('[DZEN_PUBLICATION_STATE_CHANGED]');
        const delivery = task.quality_report?.publication_task_delivery;
        if (spec.taskId === 992 && delivery?.state === 'provider_result_uncertain') {
            throw new Error('[DZEN_RETRY_NOT_AUTHORIZED] Reconcile the frozen provider attempt before retry');
        }
        if (spec.taskId === 992 && delivery?.state === 'confirmed_absent_retry_authorized'
            && delivery?.authorized_idempotency_key !== key) {
            throw new Error('[DZEN_RETRY_NOT_AUTHORIZED] Use the single owner-authorized retry key');
        }
        if (task.schedule_at && new Date(task.schedule_at).getTime() > Date.now()) throw new Error('[PUBLICATION_NOT_DUE]');
        const owner = await db.projectMember.findFirst({ where: { project_id: 10, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED]');
        const claimed = await db.$transaction(async (tx: any) => {
            const changed = await tx.contentItem.updateMany({ where: {
                id: spec.taskId, project_id: 10, channel_id: 116,
                status: task.status, publication_mode: 'owner_released',
                content_revision: spec.revision, accepted_revision: spec.revision,
                visual_state: spec.visualState, selected_asset_id: spec.selectedAssetId,
                schedule_at: task.schedule_at
            }, data: {
                status: 'publishing', quality_report: {
                    ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_call_started', channel_type: 'dzen',
                        idempotency_key: key, started_at: new Date().toISOString() }
                }
            } });
            if (changed.count === 1) await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: spec.taskId, actor_id: spec.actor,
                command: spec.claimCommand, idempotency_key: key,
                before_state: { status: task.status },
                after_state: { status: 'publishing', channel_id: 116 }
            } });
            return changed.count;
        });
        if (claimed !== 1) throw new Error('[DZEN_PUBLICATION_ALREADY_CLAIMED] Reconcile before retry');
        let url: string;
        try {
            url = await dzen.publishPost(config, task.draft_text,
                selectedAsset?.file_url || undefined, publicTitle || undefined,
                spec.publicationType);
            if (!isDzenPublishedUrl(url)) throw new Error('Provider did not confirm a public Dzen URL');
        } catch (error: any) {
            await db.contentItem.update({ where: { id: spec.taskId }, data: {
                status: 'publishing', quality_report: {
                    ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_result_uncertain', channel_type: 'dzen',
                        idempotency_key: key, retry_via_api: false,
                        error: String(error?.message || error), failed_at: new Date().toISOString() }
                }
            } });
            throw new Error('[DZEN_PUBLICATION_UNCERTAIN] Provider result requires manual reconciliation; do not retry');
        }
        const providerId = new URL(url).pathname.split('/').filter(Boolean).pop()!;
        try {
            await facts.record({ projectId: 10, taskId: spec.taskId, actorId: `user:${owner.user_id}`,
                artifactKind: 'post', outcome: 'published', publishedAt: new Date().toISOString(),
                publicUrl: url, providerObjectId: providerId, confirmationMode: 'automatic',
                evidence: { type: 'public_url', ref: url }, note: 'Published from exact owner-released Dzen task' });
        } catch {
            await db.contentItem.update({ where: { id: spec.taskId }, data: {
                status: 'publishing', quality_report: {
                    ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_confirmed_fact_pending', channel_type: 'dzen',
                        idempotency_key: key, retry_via_api: false,
                        permalink: url, provider_object_id: providerId,
                        failed_at: new Date().toISOString() }
                }
            } });
            throw new Error('[DZEN_FACT_PENDING] Provider URL confirmed but fact write failed; reconcile without sending again');
        }
        const result = { mode: 'published', task_id: spec.taskId, project_id: 10, channel_id: 116,
            accepted_revision: spec.revision, published_link: url, external_id: providerId,
            delivery_method: 'dzen_browser', visual_decision_id: spec.decisionId,
            ...(selectedAsset ? { selected_asset_id: selectedAsset.id } : {}) };
        await db.$transaction(async (tx: any) => {
            await tx.contentItem.update({ where: { id: spec.taskId }, data: {
                status: 'published', publication_mode: 'owner_released', published_link: url,
                quality_report: { ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_confirmed', channel_type: 'dzen',
                        idempotency_key: key, provider_object_id: providerId,
                        permalink: url, completed_at: new Date().toISOString() } }
            } });
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: spec.taskId, actor_id: spec.actor,
                command: spec.command, idempotency_key: key,
                before_state: { status: task.status }, after_state: result
            } });
        });
        return result;
    }
}

export default new DzenTaskPublicationService({ db: prisma, dzen: dzenService, facts: publicationFactService });
