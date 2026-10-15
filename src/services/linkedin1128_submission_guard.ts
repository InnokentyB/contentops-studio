import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { LINKEDIN1128 as p } from './linkedin1128_identity.service';
import { assertLinkedIn1128ReleaseIdentity, linkedIn1128Binding } from './linkedin1128_release_policy';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const linkedin1128SubmissionSchema = z.object({ projectId: z.literal(7), taskId: z.literal(1128),
    channelId: z.literal(6), workItemId: z.literal(1924), actorId: z.string().regex(/^user:[1-9]\d*$/),
    leaseToken: z.string().min(1), approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
    expectedManifestChecksum: z.literal(p.manifest), contentRevision: z.literal(1),
    textSha256: z.literal(p.body), selectedAssetId: z.null(), imageSha256: z.null(),
    observedCompanyId: z.literal('97416172'), authorEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    duplicateCheckReference: z.string().min(10) });
export type LinkedIn1128Submission = z.infer<typeof linkedin1128SubmissionSchema>;
export function submissionObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function submissionHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function submissionRequestHash(a: LinkedIn1128Submission) {
    return submissionHash(JSON.stringify({ projectId: 7, taskId: 1128, channelId: 6, workItemId: 1924,
        actorId: a.actorId, approvalReference: a.approvalReference, idempotencyKey: a.idempotencyKey,
        manifest: a.expectedManifestChecksum, body: a.textSha256, revision: 1, asset: null }));
}
export async function check1128Owner(tx: Prisma.TransactionClient, a: LinkedIn1128Submission) {
    if (!linkedin1128SubmissionSchema.safeParse(a).success) throw new Error('[LINKEDIN1128_SCOPE_MISMATCH]');
    const uid = Number(a.actorId.slice(5));
    const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 7, user_id: uid } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const manifest = await loadAgentWorkspaceManifest(7, uid);
    if (manifest.checksum !== p.manifest || manifest.project.slug !== 'seturon') throw new Error('[STALE_MANIFEST]');
}
export async function check1128(tx: Prisma.TransactionClient, a: LinkedIn1128Submission) {
    await check1128Owner(tx, a);
    const [task, work, decision] = await Promise.all([
        tx.contentItem.findFirst({ where: { id: 1128, project_id: 7 }, include: { channel: true, publication_fact: true } }),
        tx.workItem.findFirst({ where: { id: 1924, project_id: 7, content_item_id: 1128 } }),
        tx.artDirectionDecision.findFirst({ where: { id: 305, project_id: 7, content_item_id: 1128,
            status: 'active', source_content_revision: 1, decision_version: 1, decision: 'NO_VISUAL_NEEDED', channel: 'linkedin', placement: 'feed' } })
    ]);
    if (!task || !work || !decision || task.channel?.is_active !== true || task.channel.type !== 'linkedin'
        || !['browser_required', 'publishing'].includes(task.status) || task.publication_mode !== 'browser_required'
        || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
        || task.handoff_state !== 'ready' || task.visual_state !== 'NO_VISUAL_NEEDED' || task.visual_placement !== 'feed'
        || task.selected_asset_id !== null || submissionHash(task.draft_text || '') !== p.body
        || task.schedule_at?.toISOString() !== p.schedule || task.publication_fact || task.published_link
        || work.kind !== 'browser_publish' || work.assignee_role !== 'browser_publisher' || work.state !== 'claimed'
        || work.input_context_version !== 1 || work.lease_actor_id !== a.actorId || work.lease_token !== a.leaseToken
        || !work.lease_expires_at || work.lease_expires_at.getTime() <= Date.now()) throw new Error('[LINKEDIN1128_ACTIVE_PACKAGE_LEASE_REQUIRED]');
    const binding = linkedIn1128Binding(task.quality_report);
    await assertLinkedIn1128ReleaseIdentity({ findFirst: async () => {
        const event = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: binding.actor_id, command: p.command, idempotency_key: binding.audit_idempotency_key } });
        return event ? { after_state: submissionObject(event.after_state) } : null;
    } }, task, { expectedManifestChecksum: p.manifest,
        expectedBodySha256: p.body, expectedSelectedAssetId: null, expectedScheduleAt: p.schedule, expectedVisualDecisionId: 305 });
    const proof = submissionObject(work.result_payload);
    const owner = submissionObject(submissionObject(task.quality_report).owner_release);
    if (proof.publication_authorized !== true || proof.body_sha256 !== p.body || proof.channel_id !== 6
        || proof.content_revision !== 1 || proof.selected_asset_id !== null || proof.asset_sha256 !== null
        || owner.publication_authorized !== true || owner.body_sha256 !== p.body || owner.content_revision !== 1
        || owner.approval_reference !== a.approvalReference || owner.selected_asset_id !== null || owner.asset_sha256 !== null) {
        throw new Error('[LINKEDIN1128_RELEASE_PROOF_INVALID]');
    }
    const release = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
        command: 'ba_release_approved_linkedin_browser_task' }, orderBy: { id: 'desc' } });
    const released = submissionObject(release?.after_state);
    if (released.browser_work_item_id !== 1924 || released.body_sha256 !== p.body || released.channel_id !== 6
        || submissionObject(release?.before_state).manifest_checksum !== p.manifest) throw new Error('[LINKEDIN1128_AUDITED_RELEASE_REQUIRED]');
    return { task, work };
}
