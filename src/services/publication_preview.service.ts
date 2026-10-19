import type { RemotePrincipal } from '../mcp/remote-auth';
import { publicationPreviewSchema, PublicationPreviewError, previewHash, type PreviewBlocker } from './publication_preview_contract';
import { readPublicationPreview, type PublicationPreviewRecords } from './publication_preview_repository';

const providers = new Set(['telegram', 'telegram_chat', 'threads', 'linkedin', 'vk', 'dzen', 'zen', 'x', 'twitter', 'devto', 'setka']);
enum ArtDecisionProtocol { NoVisualNeeded = 'NO_VISUAL_NEEDED' }
function visualBlockers({task}: PublicationPreviewRecords): PreviewBlocker[] {
    const fail = (code: string, cause: string): PreviewBlocker[] => [{code, cause,
        action: 'Complete the current revision-bound art assessment and visual review through the normal pipeline.', role: 'art_director'}];
    if (task.visual_mode === 'forbidden') return task.selected_asset_id === null ? [] : fail('PREVIEW_VISUAL_CONTRACT_CONFLICT', 'This placement forbids a visual but an asset is selected.');
    const decisions = task.art_direction_decisions;
    if (decisions.length !== 1 || decisions[0]?.decision_version !== task.visual_decision_version
        || decisions[0]?.source_content_revision !== task.accepted_revision
        || decisions[0]?.channel !== task.channel?.type || decisions[0]?.placement !== task.visual_placement
        || decisions[0]?.project_id !== task.project_id || decisions[0]?.content_item_id !== task.id) {
        return fail('PREVIEW_CURRENT_ART_DECISION_REQUIRED', 'The active art decision does not uniquely match the accepted revision.');
    }
    const decision = decisions[0];
    if (task.visual_state === 'NO_VISUAL_NEEDED') return task.visual_mode !== 'required' && task.selected_asset_id === null
        && decision.decision === ArtDecisionProtocol.NoVisualNeeded ? [] : fail('PREVIEW_VISUAL_REQUIREMENT_UNSATISFIED', 'The current visual requirement conflicts with the no-visual decision.');
    const asset = task.selected_asset;
    if (task.visual_state !== 'APPROVED' || !asset || task.selected_asset_id !== asset.id || asset.status !== 'approved'
        || asset.project_id !== task.project_id || asset.content_item_id !== task.id
        || asset.content_revision !== task.accepted_revision || asset.decision_id !== decision.id
        || asset.placement !== task.visual_placement || decision.decision === ArtDecisionProtocol.NoVisualNeeded) {
        return fail('PREVIEW_CURRENT_APPROVED_VISUAL_REQUIRED', 'The selected visual is missing, pending or belongs to another revision/decision.');
    }
    return [];
}

/** Authenticated local preflight only; never obtains a permit, reads a provider or changes state. */
export async function previewPublicationTask(input: unknown, principal: Readonly<RemotePrincipal> | null | undefined): Promise<Record<string, unknown>> {
    const args = publicationPreviewSchema.parse(input);
    if (!principal || !Number.isInteger(principal.userId) || principal.userId <= 0 || principal.actorId !== `user:${principal.userId}`) {
        throw new PublicationPreviewError('PREVIEW_AUTHENTICATED_PRINCIPAL_REQUIRED');
    }
    if (principal.profile && !['owner', 'publisher'].includes(principal.profile)) throw new PublicationPreviewError('PREVIEW_PROFILE_NOT_ALLOWED');
    if (principal.projectId !== undefined && principal.projectId !== args.projectId) throw new PublicationPreviewError('PREVIEW_PROJECT_SCOPE_MISMATCH');
    const records = await readPublicationPreview(args, principal.userId);
    const {task, attemptCount, activeWork, publicationHold, visualReassessmentPending} = records;
    const blockers: PreviewBlocker[] = [];
    const block = (code: string, cause: string, action: string, role: PreviewBlocker['role'] = 'publisher'): void => {blockers.push({code, cause, action, role});};
    const provider = task.channel && providers.has(task.channel.type) ? task.channel.type : 'unsupported';
    const digest = previewHash(JSON.stringify({project: task.project_id, task: task.id, revision: task.accepted_revision,
        body: previewHash(task.draft_text || ''), channel: task.channel_id, provider, visualDecision: task.visual_decision_version,
        selectedAsset: task.selected_asset_id, schedule: task.schedule_at, publish: task.publish_at,
        visualMode: task.visual_mode, visualState: task.visual_state, handoff: task.handoff_state,
        state: task.status, mode: task.publication_mode, publicationHold, visualReassessmentPending}));
    if (task.handoff_state !== 'ready') block('PREVIEW_HANDOFF_NOT_READY', 'The current task handoff is blocked or stale.', 'Complete the pending review and refresh the normal handoff for the current accepted package.', 'owner');
    if (task.status !== 'ready_for_execution') block('PREVIEW_TASK_NOT_READY', 'The current task lifecycle is not ready for execution.', 'Inspect the current task lifecycle and complete its pending work through the normal workflow.', 'owner');
    if (publicationHold) block('PREVIEW_PUBLICATION_HOLD', 'The task has a publication hold or an invalid hold record.', 'Inspect and resolve the recorded publication hold through its owning workflow; an invalid record requires engineering repair.', 'owner');
    if (visualReassessmentPending) block('PREVIEW_VISUAL_REASSESSMENT_REQUIRED', 'The current Owner visual requirement has no matching approved independent review.', 'Complete the current art-direction input and its separate visual review before normal release.', 'art_director');
    if (!['manual_handoff', 'browser_required', 'connector_auto', 'owner_released'].includes(task.publication_mode || '')) {
        block('PREVIEW_PUBLICATION_MODE_HELD', 'The publication mode still requires approval or is unsupported.', 'Complete the normal owner release for the current package; an unknown mode requires configuration repair.', 'owner');
    }
    if (!task.accepted_revision || task.accepted_revision !== task.content_revision || task.text_state !== 'accepted' || !task.draft_text?.trim()) {
        block('PREVIEW_ACCEPTED_REVISION_REQUIRED', 'The current text is not a nonempty accepted revision.', 'Complete the current content review.', 'owner');
    }
    if (args.expectedAcceptedRevision !== undefined && args.expectedAcceptedRevision !== task.accepted_revision
        || args.expectedPackageSha256 !== undefined && args.expectedPackageSha256 !== digest) {
        block('PREVIEW_EXPECTED_PACKAGE_CHANGED', 'The expected revision or local snapshot digest changed.', 'Read the current accepted package before its ordinary release.', 'owner');
    }
    if (!task.channel || task.channel.project_id !== args.projectId || task.channel.id !== task.channel_id || !task.channel.is_active) {
        block('PREVIEW_CHANNEL_UNAVAILABLE', 'No active tenant-owned channel matches this task.', 'Restore the correct channel binding through project configuration.', 'owner');
    }
    if (provider === 'unsupported') block('PREVIEW_ROUTE_UNSUPPORTED', 'No supported local validator is available for this provider.', 'Ask engineering to implement the shared provider contract; do not select another sender.', 'engineering');
    if (['vk', 'dzen', 'zen'].includes(provider)) block('PREVIEW_INDEPENDENT_ADAPTER_NOT_CHECKED', 'The governed independent adapter was not checked by this local-only preview.', 'Use the documented Planner-to-registered-adapter status route. A denied or missing route requires repair, not fallback.', 'engineering');
    if (task.publication_fact || task.published_link || task.status === 'published') block('PREVIEW_ALREADY_PUBLISHED', 'The task already has delivery evidence.', 'Read the existing publication fact; do not submit again.');
    else if (attemptCount > 0 || task.status === 'publishing') block('PREVIEW_RECONCILIATION_REQUIRED', 'An existing publication attempt must be resolved before another operation.', 'Inspect and reconcile the original attempt through its supported lifecycle. Do not resend or change the key.');
    if (['removed', 'cancelled', 'skipped'].includes(task.status)) block('PREVIEW_TASK_TERMINAL', 'This task is in a terminal lifecycle state.', 'Ask the owner to inspect its lifecycle history; do not reset the state.', 'owner');
    if (activeWork > 0) block('PREVIEW_WORK_ALREADY_CLAIMED', 'An executor already owns work for this task.', 'Inspect the existing work owner and progress; do not launch a competing executor.');
    blockers.push(...visualBlockers(records));
    return {project_id: args.projectId, task_id: args.taskId, channel_id: task.channel_id, provider,
        accepted_revision: task.accepted_revision, package_sha256: digest, package_digest_kind: 'LOCAL_METADATA_V1',
        checked_at: new Date().toISOString(), validation: blockers.length ? 'BLOCKED' : 'LOCAL_VALID', blockers,
        provider_readiness: 'NOT_CHECKED', credential_readiness: 'NOT_CHECKED', release_readiness: 'NOT_CHECKED',
        asset_durability: task.selected_asset_id ? 'NOT_CHECKED' : 'NOT_APPLICABLE',
        next_action: blockers.length ? blockers[0].action : 'Use the normal release and execution checks for this package; local preview is not send authority.',
        mutates_state: false, provider_called: false, submission_permitted: false, retry_allowed: false};
}
