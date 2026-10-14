import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { bindLinkedIn1128Identity, LINKEDIN1128, LinkedIn1128BindingTransaction } from './linkedin1128_identity.service';

const record = z.record(z.string(), z.json());
function jsonRecord(input: unknown) { return record.parse(input); }

/** No registry reader or provider is involved: this persists an explicit owner adoption only. */
export async function bindLinkedIn1128IdentityWithPrisma(input: unknown) {
    return bindLinkedIn1128Identity({
        hashBody: body => createHash('sha256').update(body).digest('hex'),
        getManifestChecksum: async (projectId, actorId) => {
            const match = /^user:([1-9]\d*)$/.exec(actorId);
            if (!match) throw new Error('[OWNER_REQUIRED]');
            return (await loadAgentWorkspaceManifest(projectId, Number(match[1]))).checksum;
        },
        transaction: callback => prisma.$transaction(async tx => {
            // All mutable reads and both writes share the serializable transaction.
            const ports: LinkedIn1128BindingTransaction = {
                owner: async (projectId, actorId) => {
                    const userId = Number(actorId.slice(5));
                    const member = await tx.projectMember.findUnique({ where: {
                        project_id_user_id: { project_id: projectId, user_id: userId }
                    } });
                    return member?.role === 'owner';
                },
                task: async () => {
                    const task = await tx.contentItem.findFirst({ where: { id: 1128, project_id: 7 },
                        include: { channel: true, project: true, publication_fact: true } });
                    if (!task) return null;
                    const decision = await tx.artDirectionDecision.findFirst({ where: {
                        id: 305, project_id: 7, content_item_id: 1128, status: 'active'
                    } });
                    const config = jsonRecord(task.channel?.config || {});
                    const raw = jsonRecord(config.raw_account || {});
                    // Explicit field selection: never expose/store the provider credential config.
                    return { id: task.id, project_id: task.project_id, project_slug: task.project.slug,
                        channel_id: task.channel_id, content_revision: task.content_revision,
                        accepted_revision: task.accepted_revision, text_state: task.text_state,
                        draft_text: task.draft_text, schedule_at: task.schedule_at?.toISOString(),
                        publish_at: task.publish_at?.toISOString(), status: task.status,
                        publication_mode: task.publication_mode, handoff_state: task.handoff_state,
                        visual_state: task.visual_state, visual_placement: task.visual_placement,
                        selected_asset_id: task.selected_asset_id, visual_decision_version: task.visual_decision_version,
                        decision_id: decision?.id, decision_version: decision?.decision_version,
                        decision_revision: decision?.source_content_revision, decision_status: decision?.status,
                        decision: decision?.decision, decision_channel: decision?.channel,
                        decision_placement: decision?.placement, channel_type: task.channel?.type,
                        channel_name: task.channel?.name, account_ref: config.account_ref,
                        account_type: config.account_type, channel_url: raw.url,
                        execution_modes: config.execution_modes, publication_fact: task.publication_fact,
                        published_link: task.published_link, quality_report: jsonRecord(task.quality_report || {}) };
                },
                prior: async (actorId, key) => {
                    const event = await tx.workflowEvent.findFirst({ where: { project_id: 7,
                        content_item_id: 1128, actor_id: actorId, command: LINKEDIN1128.command, idempotency_key: key } });
                    return event ? { before_state: jsonRecord(event.before_state), after_state: jsonRecord(event.after_state) } : null;
                },
                hasDelivery: async () => Boolean(await tx.deliveryAttempt.findFirst({
                    where: { project_id: 7, content_item_id: 1128 } })),
                hasBrowserWork: async () => Boolean(await tx.workItem.findFirst({ where: {
                    project_id: 7, content_item_id: 1128, kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] }
                } })),
                write: async (expected, binding) => {
                    const prior = z.object({ draft_text: z.string(), quality_report: record }).parse(expected);
                    const changed = await tx.contentItem.updateMany({ where: {
                        id: 1128, project_id: 7, channel_id: 6, content_revision: 1, accepted_revision: 1,
                        draft_text: prior.draft_text, text_state: 'accepted', status: 'ready_for_execution',
                        publication_mode: 'approval_required', handoff_state: 'ready', visual_state: 'NO_VISUAL_NEEDED',
                        visual_placement: 'feed', visual_decision_version: 1, selected_asset_id: null,
                        schedule_at: new Date(LINKEDIN1128.schedule), publish_at: new Date(LINKEDIN1128.schedule),
                        published_link: null, publication_fact: null
                    }, data: { quality_report: { ...prior.quality_report, identity_binding: jsonRecord(binding) } } });
                    return changed.count;
                },
                audit: async (actorId, key, event) => {
                    await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1128,
                        actor_id: actorId, command: LINKEDIN1128.command, idempotency_key: key,
                        before_state: jsonRecord(event.before_state), after_state: jsonRecord(event.after_state) } });
                }
            };
            return callback(ports);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    }, input);
}
