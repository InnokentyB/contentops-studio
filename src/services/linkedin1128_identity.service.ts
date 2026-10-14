import { createHash } from 'crypto';
import { z } from 'zod';

export const LINKEDIN1128 = {
    manifest: 'sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd',
    body: '1bb16f09fc632f0ff18b062cd98b914acdbe849b3e8ea5ebd2483355a8a44452',
    schedule: '2026-10-14T10:00:00.000Z', command: 'ba_bind_linkedin_task1128_identity'
} as const;
export const linkedIn1128BindingArgs = z.object({ projectId: z.literal(7), taskId: z.literal(1128),
    actorId: z.string().regex(/^user:[1-9]\d*$/), expectedManifestChecksum: z.literal(LINKEDIN1128.manifest),
    approvalReference: z.string().trim().min(10), idempotencyKey: z.string().trim().min(1), apply: z.boolean() });
const Snapshot = z.object({ id: z.literal(1128), project_id: z.literal(7), project_slug: z.literal('seturon'),
    channel_id: z.literal(6), content_revision: z.literal(1), accepted_revision: z.literal(1),
    text_state: z.literal('accepted'), draft_text: z.string(), schedule_at: z.literal(LINKEDIN1128.schedule),
    publish_at: z.literal(LINKEDIN1128.schedule), status: z.literal('ready_for_execution'),
    publication_mode: z.literal('approval_required'), handoff_state: z.literal('ready'),
    visual_state: z.literal('NO_VISUAL_NEEDED'), visual_placement: z.literal('feed'),
    selected_asset_id: z.null(), visual_decision_version: z.literal(1), decision_id: z.literal(305),
    decision_version: z.literal(1), decision_revision: z.literal(1), decision_status: z.literal('active'),
    decision: z.literal('NO_VISUAL_NEEDED'), decision_channel: z.literal('linkedin'),
    decision_placement: z.literal('feed'), channel_type: z.literal('linkedin'),
    channel_name: z.literal('seturon_linkedin_page'), account_ref: z.literal('seturon_linkedin_page'),
    account_type: z.literal('company_page'), channel_url: z.literal('https://www.linkedin.com/company/seturon/'),
    execution_modes: z.tuple([z.literal('manual')]), publication_fact: z.null(), published_link: z.null(),
    quality_report: z.record(z.string(), z.unknown()) });
type Event = { before_state: Record<string, unknown>; after_state: Record<string, unknown> };
export type LinkedIn1128BindingTransaction = {
    owner(projectId: number, actorId: string): Promise<boolean>;
    task(): Promise<unknown>;
    prior(actorId: string, key: string): Promise<Event | null>;
    hasDelivery(): Promise<boolean>;
    hasBrowserWork(): Promise<boolean>;
    write(expected: unknown, binding: unknown): Promise<number>;
    audit(actorId: string, key: string, event: Event): Promise<void>;
};
export type LinkedIn1128BindingPorts = {
    transaction<T>(callback: (tx: LinkedIn1128BindingTransaction) => Promise<T>): Promise<T>;
    getManifestChecksum(projectId: number, actorId: string): Promise<string>;
    hashBody(body: string): string;
};

/** Owner adoption of supplied Registry evidence, never a provider verification or release. */
export async function bindLinkedIn1128Identity(ports: LinkedIn1128BindingPorts, input: unknown): Promise<Record<string, unknown>> {
    const parsed = linkedIn1128BindingArgs.safeParse(input);
    if (!parsed.success) throw new Error('[LINKEDIN1128_BINDING_SCOPE_MISMATCH]');
    const args = parsed.data;
    const hash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    return ports.transaction(async tx => {
        if (!await tx.owner(7, args.actorId)) throw new Error('[OWNER_REQUIRED]');
        if (await ports.getManifestChecksum(7, args.actorId) !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
        const prior = await tx.prior(args.actorId, args.idempotencyKey);
        if (prior) {
            if (prior.before_state.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...prior.after_state, replayed: true };
        }
        const snapshot = Snapshot.safeParse(await tx.task());
        if (!snapshot.success || ports.hashBody(snapshot.data.draft_text) !== LINKEDIN1128.body) {
            throw new Error('[LINKEDIN1128_BINDING_PACKAGE_MISMATCH]');
        }
        const task = snapshot.data;
        if (task.quality_report.publication_hold) throw new Error('[PUBLICATION_HOLD_ACTIVE]');
        if (task.quality_report.identity_binding !== undefined) throw new Error('[LINKEDIN1128_BINDING_CONFLICT]');
        if (await tx.hasDelivery()) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        if (await tx.hasBrowserWork()) throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');
        const binding = {
            binding_scope: 'task_1128_only', project_id: 7, task_id: 1128, channel_id: 6,
            content_revision: 1, accepted_revision: 1, body_sha256: LINKEDIN1128.body,
            schedule_at: LINKEDIN1128.schedule, publish_at: LINKEDIN1128.schedule,
            visual_decision_id: 305, visual_decision_version: 1, selected_asset_id: null,
            profile_ref: 'profile_seturon_linkedin_page', identity_ref: 'identity_seturon',
            linkedin_company_id: '97416172', account_ref: 'seturon_linkedin_page',
            canonical_url: 'https://www.linkedin.com/company/seturon/',
            registry_relationship_refs: ['seturon_linkedin_represents_identity', 'planner_7_publishes_seturon_linkedin'],
            registry_version: 36,
            registry_evidence_sha256: 'f46b588582ee781f3ab0e1f325be307a87cbff00b106106a9bb7eed6d0bc9670',
            registry_current_verified: false, verification_basis: 'owner_adopted_registry_binding',
            provider_identity_verified: false, manifest_checksum: args.expectedManifestChecksum,
            actor_id: args.actorId, approval_reference: args.approvalReference,
            audit_command: LINKEDIN1128.command, audit_idempotency_key: args.idempotencyKey
        };
        const result = { project_id: 7, task_id: 1128, identity_binding: binding,
            applied: args.apply, published: false, publication_authorized: false, replayed: false };
        if (!args.apply) return result;
        if (await ports.getManifestChecksum(7, args.actorId) !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
        if (await tx.write(task, binding) !== 1) throw new Error('[LINKEDIN1128_BINDING_CAS_CONFLICT]');
        await tx.audit(args.actorId, args.idempotencyKey, { before_state: { request_hash: hash,
            identity_binding: null, content_revision: 1, body_sha256: LINKEDIN1128.body }, after_state: result });
        return result;
    });
}
