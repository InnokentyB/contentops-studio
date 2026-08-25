"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.artDirectionService = exports.ArtDirectionService = exports.ART_DIRECTION_DECISIONS = void 0;
exports.defaultVisualMode = defaultVisualMode;
exports.validateArtDirectionDecision = validateArtDirectionDecision;
exports.calculateVisualReadiness = calculateVisualReadiness;
const db_1 = __importDefault(require("../db"));
exports.ART_DIRECTION_DECISIONS = [
    'NO_VISUAL_NEEDED',
    'GENERATE',
    'SOURCE_REQUIRED',
    'MANUAL_ASSET_REQUIRED',
    'BLOCKED'
];
function defaultVisualMode(channel, placement) {
    const normalizedChannel = channel.toLowerCase();
    const normalizedPlacement = placement.toLowerCase();
    if (normalizedChannel === 'email')
        return 'forbidden';
    if (normalizedPlacement.includes('story') || normalizedPlacement.includes('reel'))
        return 'required';
    if (normalizedChannel === 'linkedin' && normalizedPlacement.includes('carousel'))
        return 'required';
    return 'auto_assess';
}
function validateArtDirectionDecision(input, visualMode) {
    if (!exports.ART_DIRECTION_DECISIONS.includes(input.decision))
        throw new Error('[INVALID_VISUAL_DECISION] Unsupported decision');
    if (!Number.isInteger(input.source_content_revision) || input.source_content_revision < 1) {
        throw new Error('[INVALID_CONTENT_REVISION] A positive accepted revision is required');
    }
    if (!input.reason?.trim())
        throw new Error('[VISUAL_REASON_REQUIRED] Decision reason is required');
    if (input.authenticity_class === 'SIMULATED_DOCUMENTATION') {
        throw new Error('[SIMULATED_DOCUMENTATION_FORBIDDEN] Simulated documentation cannot be accepted');
    }
    if (visualMode === 'forbidden' && input.decision !== 'NO_VISUAL_NEEDED') {
        throw new Error('[VISUAL_FORBIDDEN] Placement does not allow a visual');
    }
    if (visualMode === 'required' && input.decision === 'NO_VISUAL_NEEDED') {
        throw new Error('[VISUAL_REQUIRED] Placement requires an approved visual');
    }
    if (input.decision === 'NO_VISUAL_NEEDED') {
        if (input.loss_without_visual?.trim()) {
            throw new Error('[VISUAL_FUNCTION_CONFLICT] NO_VISUAL_NEEDED requires an empty loss_without_visual');
        }
        return input;
    }
    if (!input.loss_without_visual?.trim() && input.decision !== 'BLOCKED') {
        throw new Error('[LOSS_WITHOUT_VISUAL_REQUIRED] A functional loss must be stated');
    }
    if (['ACTUAL_EVIDENCE', 'OWNER_DOCUMENTATION'].includes(input.authenticity_class || '')
        && !(input.evidence_refs || []).length
        && !['SOURCE_REQUIRED', 'MANUAL_ASSET_REQUIRED'].includes(input.decision)) {
        throw new Error('[SOURCE_REQUIRED] Real evidence or owner documentation requires evidence_refs');
    }
    if (input.decision === 'GENERATE') {
        if (input.authenticity_class !== 'CONCEPTUAL_EDITORIAL') {
            throw new Error('[GENERATIVE_AUTHENTICITY_CONFLICT] Generation is allowed only for conceptual editorial visuals');
        }
        if (!input.visual_function || !input.visual_format || !input.dimensions?.aspect_ratio
            || !input.prompt?.trim() || !(input.acceptance_criteria || []).length) {
            throw new Error('[INCOMPLETE_VISUAL_BRIEF] Generation requires function, format, dimensions, prompt and acceptance criteria');
        }
    }
    return input;
}
function calculateVisualReadiness(input) {
    if (!input.enabled)
        return { ready: true, reason: null };
    if (input.textState !== 'accepted' || !input.acceptedRevision || input.acceptedRevision !== input.contentRevision) {
        return { ready: false, reason: 'text_not_accepted' };
    }
    if (input.visualMode === 'forbidden')
        return { ready: true, reason: null };
    if (input.visualState === 'NO_VISUAL_NEEDED')
        return { ready: true, reason: null };
    if (input.visualState === 'APPROVED') {
        if (input.selectedAssetRevision !== input.acceptedRevision)
            return { ready: false, reason: 'visual_stale' };
        return { ready: true, reason: null };
    }
    if (input.visualState === 'STALE')
        return { ready: false, reason: 'visual_stale' };
    if (['SOURCE_REQUIRED', 'MANUAL_ASSET_REQUIRED', 'BLOCKED'].includes(input.visualState || '')) {
        return { ready: false, reason: 'visual_blocked' };
    }
    return { ready: false, reason: 'visual_decision_missing' };
}
function settingEnabled(value) {
    return ['1', 'true', 'yes', 'enabled', 'on'].includes((value || '').trim().toLowerCase());
}
class ArtDirectionService {
    async isEnabled(projectId, client = db_1.default) {
        const setting = await client.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'art_direction_pipeline_enabled' } }
        });
        return settingEnabled(setting?.value);
    }
    async acceptContentRevision(client, contentItemId, actorId) {
        const item = await client.contentItem.findUnique({ where: { id: contentItemId }, include: { channel: true } });
        if (!item)
            throw new Error(`ContentItem ${contentItemId} not found`);
        if (['published', 'removed', 'cancelled'].includes(item.status) || !item.draft_text?.trim())
            return null;
        const enabled = await this.isEnabled(item.project_id, client);
        const placement = item.visual_placement || 'feed';
        const mode = item.visual_mode || defaultVisualMode(item.channel?.type || item.type, placement);
        await client.contentItem.update({
            where: { id: item.id },
            data: {
                status: !enabled || mode === 'forbidden' ? 'ready_for_execution' : 'approved',
                text_state: 'accepted',
                accepted_revision: item.content_revision,
                visual_mode: mode,
                visual_placement: placement,
                ...(enabled ? {
                    visual_state: mode === 'forbidden' ? 'NO_VISUAL_NEEDED' : 'PENDING_ASSESSMENT',
                    handoff_state: mode === 'forbidden' ? 'ready' : 'blocked'
                } : {})
            }
        });
        if (!enabled || mode === 'forbidden')
            return null;
        const dedupeKey = `art-direction:${item.id}:${item.content_revision}:${placement}`;
        return client.workItem.upsert({
            where: { dedupe_key: dedupeKey },
            update: {},
            create: {
                project_id: item.project_id,
                week_package_id: item.week_package_id,
                content_item_id: item.id,
                item_key: item.item_key || `content:${item.id}`,
                kind: 'art_direction',
                state: 'available',
                assignee_role: 'art_director',
                input_context_version: item.content_revision,
                dedupe_key: dedupeKey,
                note: `Assess visual fit for revision ${item.content_revision}, placement ${placement}`
            }
        });
    }
    async markRevisionStale(client, contentItemId) {
        const item = await client.contentItem.findUnique({ where: { id: contentItemId } });
        if (!item || !(await this.isEnabled(item.project_id, client)))
            return;
        await client.artDirectionDecision.updateMany({
            where: { content_item_id: item.id, status: 'active' },
            data: { status: 'stale' }
        });
        await client.contentItem.update({
            where: { id: item.id },
            data: { text_state: 'draft', accepted_revision: null, visual_state: 'STALE', handoff_state: 'blocked', selected_asset_id: null }
        });
    }
    async getContext(projectId, workItemId) {
        const workItem = await db_1.default.workItem.findFirst({
            where: { id: workItemId, project_id: projectId, kind: 'art_direction' },
            include: { content_item: { include: { channel: true, image_assets: { orderBy: { asset_version: 'desc' }, take: 10 } } } }
        });
        if (!workItem?.content_item)
            throw new Error('Art-direction work item not found');
        const item = workItem.content_item;
        return {
            work_item: workItem,
            content: {
                id: item.id,
                accepted_text: item.draft_text,
                source_content_revision: item.accepted_revision,
                channel: item.channel?.type || item.type,
                placement: item.visual_placement || 'feed',
                visual_mode: item.visual_mode
            },
            recent_assets: item.image_assets
        };
    }
    async submitDecision(params) {
        return db_1.default.$transaction(async (tx) => {
            const cached = await tx.workflowEvent.findUnique({
                where: { project_id_actor_id_command_idempotency_key: {
                        project_id: params.projectId,
                        actor_id: params.actorId,
                        command: 'ba_submit_art_direction_decision',
                        idempotency_key: params.idempotencyKey
                    } }
            });
            if (cached?.after_state)
                return cached.after_state;
            const workItem = await tx.workItem.findFirst({
                where: { id: params.workItemId, project_id: params.projectId },
                include: { content_item: true }
            });
            if (!workItem?.content_item || workItem.kind !== 'art_direction')
                throw new Error('Art-direction work item not found');
            if (workItem.state !== 'claimed' || workItem.lease_token !== params.leaseToken || workItem.lease_actor_id !== params.actorId) {
                throw new Error('[INVALID_LEASE_TOKEN] Active art-director lease is required');
            }
            if (workItem.lease_expires_at && workItem.lease_expires_at < new Date())
                throw new Error('[LEASE_EXPIRED] Art-direction lease expired');
            const item = workItem.content_item;
            if (item.accepted_revision !== params.decision.source_content_revision || item.content_revision !== item.accepted_revision) {
                throw new Error('[STALE_CONTENT_REVISION] Decision does not match the accepted content revision');
            }
            const validated = validateArtDirectionDecision(params.decision, item.visual_mode);
            const version = item.visual_decision_version + 1;
            await tx.artDirectionDecision.updateMany({ where: { content_item_id: item.id, status: 'active' }, data: { status: 'superseded' } });
            const stored = await tx.artDirectionDecision.create({
                data: {
                    project_id: params.projectId,
                    content_item_id: item.id,
                    work_item_id: workItem.id,
                    decision_version: version,
                    source_content_revision: validated.source_content_revision,
                    channel: validated.channel,
                    placement: validated.placement,
                    decision: validated.decision,
                    visual_function: validated.visual_function,
                    reason: validated.reason,
                    post_owns: validated.post_owns,
                    visual_adds: validated.visual_adds,
                    loss_without_visual: validated.loss_without_visual,
                    authenticity_class: validated.authenticity_class,
                    evidence_refs: (validated.evidence_refs || []),
                    visual_format: validated.visual_format,
                    dimensions: (validated.dimensions || {}),
                    required_text: (validated.required_text || []),
                    forbidden_text: (validated.forbidden_text || []),
                    visible_copy_budget: validated.visible_copy_budget,
                    prompt: validated.prompt,
                    alt_text: validated.alt_text,
                    acceptance_criteria: (validated.acceptance_criteria || []),
                    recent_asset_refs: (validated.recent_asset_refs || []),
                    actor_id: params.actorId
                }
            });
            const stateByDecision = {
                NO_VISUAL_NEEDED: 'NO_VISUAL_NEEDED', GENERATE: 'BRIEFED', SOURCE_REQUIRED: 'SOURCE_REQUIRED',
                MANUAL_ASSET_REQUIRED: 'MANUAL_ASSET_REQUIRED', BLOCKED: 'BLOCKED'
            };
            await tx.contentItem.update({
                where: { id: item.id },
                data: {
                    status: validated.decision === 'NO_VISUAL_NEEDED' ? 'ready_for_execution' : 'approved',
                    visual_state: stateByDecision[validated.decision],
                    visual_decision_version: version,
                    handoff_state: validated.decision === 'NO_VISUAL_NEEDED' ? 'ready' : 'blocked'
                }
            });
            await tx.workItem.update({ where: { id: workItem.id }, data: { state: 'completed', result_version: version, result_payload: validated, lease_token: null, lease_actor_id: null, lease_expires_at: null } });
            if (validated.decision === 'GENERATE') {
                const dedupeKey = `visual-generate:${item.id}:${item.content_revision}:${version}:1`;
                await tx.workItem.upsert({
                    where: { dedupe_key: dedupeKey }, update: {}, create: {
                        project_id: item.project_id, week_package_id: item.week_package_id, content_item_id: item.id,
                        item_key: item.item_key || `content:${item.id}`, kind: 'visual_generate', state: 'available',
                        assignee_role: 'system:image_provider', input_context_version: item.content_revision, dedupe_key: dedupeKey,
                        result_payload: { decision_id: stored.id, prompt: stored.prompt, placement: stored.placement }
                    }
                });
            }
            else if (['SOURCE_REQUIRED', 'MANUAL_ASSET_REQUIRED'].includes(validated.decision)) {
                const dedupeKey = `visual-source:${item.id}:${item.content_revision}:${version}`;
                await tx.workItem.upsert({
                    where: { dedupe_key: dedupeKey }, update: {}, create: {
                        project_id: item.project_id, week_package_id: item.week_package_id, content_item_id: item.id,
                        item_key: item.item_key || `content:${item.id}`, kind: 'visual_source_collect', state: 'blocked',
                        assignee_role: 'owner_or_smm', input_context_version: item.content_revision, dedupe_key: dedupeKey,
                        reason_code: validated.decision, missing_resource_refs: (validated.evidence_refs || [])
                    }
                });
            }
            const result = { decision_id: stored.id, decision_version: version, visual_state: stateByDecision[validated.decision] };
            await tx.workflowEvent.create({ data: { project_id: params.projectId, work_item_id: workItem.id, content_item_id: item.id, actor_id: params.actorId, command: 'ba_submit_art_direction_decision', idempotency_key: params.idempotencyKey, after_state: result } });
            return result;
        });
    }
    async getReadiness(projectId, contentItemId) {
        const item = await db_1.default.contentItem.findFirst({
            where: { id: contentItemId, project_id: projectId },
            include: { selected_asset: true, art_direction_decisions: { orderBy: { decision_version: 'desc' }, take: 1 } }
        });
        if (!item)
            throw new Error('Content item not found');
        const enabled = await this.isEnabled(projectId);
        return {
            ...calculateVisualReadiness({ enabled, textState: item.text_state, acceptedRevision: item.accepted_revision, contentRevision: item.content_revision, visualMode: item.visual_mode, visualState: item.visual_state, selectedAssetRevision: item.selected_asset?.content_revision }),
            enabled,
            content_item_id: item.id,
            text_state: item.text_state,
            accepted_revision: item.accepted_revision,
            content_revision: item.content_revision,
            visual_state: item.visual_state,
            handoff_state: item.handoff_state,
            visual_mode: item.visual_mode,
            placement: item.visual_placement,
            selected_asset: item.selected_asset,
            decision: item.art_direction_decisions[0] || null
        };
    }
    async attachVisualSource(params) {
        if (!Object.keys(params.provenance || {}).length)
            throw new Error('[PROVENANCE_REQUIRED] Visual source provenance is required');
        return db_1.default.$transaction(async (tx) => {
            const item = await tx.contentItem.findFirst({ where: { id: params.contentItemId, project_id: params.projectId }, include: { art_direction_decisions: { where: { status: 'active' }, orderBy: { decision_version: 'desc' }, take: 1 } } });
            if (!item || !item.accepted_revision || item.accepted_revision !== item.content_revision)
                throw new Error('[TEXT_NOT_ACCEPTED] Attach sources only to the current accepted revision');
            const decision = item.art_direction_decisions[0];
            if (!decision || !['SOURCE_REQUIRED', 'MANUAL_ASSET_REQUIRED'].includes(decision.decision))
                throw new Error('[SOURCE_NOT_REQUESTED] Active decision does not request a source');
            const latest = await tx.imageAsset.findFirst({ where: { content_item_id: item.id }, orderBy: { asset_version: 'desc' } });
            const asset = await tx.imageAsset.create({ data: {
                    project_id: item.project_id, content_item_id: item.id, decision_id: decision.id, content_revision: item.content_revision,
                    placement: decision.placement, asset_version: (latest?.asset_version || 0) + 1, prompt: 'Source-provided visual',
                    provider: 'source', alt_text: params.altText || decision.alt_text, file_url: params.fileUrl,
                    provenance: params.provenance, status: 'candidate'
                } });
            const dedupeKey = `visual-review:${asset.id}:${asset.asset_version}`;
            await tx.workItem.upsert({ where: { dedupe_key: dedupeKey }, update: {}, create: {
                    project_id: item.project_id, week_package_id: item.week_package_id, content_item_id: item.id,
                    item_key: item.item_key || `content:${item.id}`, kind: 'visual_review', state: 'available', assignee_role: 'visual_reviewer',
                    input_context_version: item.content_revision, dedupe_key: dedupeKey,
                    result_payload: { asset_id: asset.id, decision_id: decision.id }
                } });
            await tx.contentItem.update({ where: { id: item.id }, data: { visual_state: 'IN_REVIEW', handoff_state: 'blocked' } });
            return { asset_id: asset.id, visual_state: 'IN_REVIEW', content_revision: item.content_revision };
        });
    }
    async assertPublicationReady(projectId, contentItemId) {
        const readiness = await this.getReadiness(projectId, contentItemId);
        if (!readiness.ready)
            throw new Error(`[VISUAL_GATE_BLOCKED] ${readiness.reason}`);
        return readiness;
    }
    async backfillProject(projectId, actorId) {
        if (!(await this.isEnabled(projectId)))
            throw new Error('[ART_DIRECTION_DISABLED] Enable the project pipeline before backfill');
        const candidates = await db_1.default.contentItem.findMany({
            where: {
                project_id: projectId,
                status: { notIn: ['published', 'removed', 'cancelled', 'skipped'] },
                draft_text: { not: null }
            },
            select: { id: true, content_revision: true }
        });
        let queued = 0;
        for (const candidate of candidates) {
            await db_1.default.$transaction(async (tx) => {
                if (candidate.content_revision < 1) {
                    await tx.contentItem.update({ where: { id: candidate.id }, data: { content_revision: 1 } });
                }
                const workItem = await this.acceptContentRevision(tx, candidate.id, actorId);
                if (workItem)
                    queued += 1;
            });
        }
        return { project_id: projectId, candidates: candidates.length, art_direction_work_items: queued };
    }
}
exports.ArtDirectionService = ArtDirectionService;
exports.artDirectionService = new ArtDirectionService();
exports.default = exports.artDirectionService;
