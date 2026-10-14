import { isDeepStrictEqual } from 'util';
import { z } from 'zod';
import { LINKEDIN1128 } from './linkedin1128_identity.service';

const Binding = z.object({ binding_scope: z.literal('task_1128_only'), project_id: z.literal(7),
    task_id: z.literal(1128), channel_id: z.literal(6), content_revision: z.literal(1), accepted_revision: z.literal(1),
    body_sha256: z.literal(LINKEDIN1128.body), schedule_at: z.literal(LINKEDIN1128.schedule),
    publish_at: z.literal(LINKEDIN1128.schedule), visual_decision_id: z.literal(305), visual_decision_version: z.literal(1),
    selected_asset_id: z.null(), profile_ref: z.literal('profile_seturon_linkedin_page'), identity_ref: z.literal('identity_seturon'),
    linkedin_company_id: z.literal('97416172'), account_ref: z.literal('seturon_linkedin_page'),
    canonical_url: z.literal('https://www.linkedin.com/company/seturon/'),
    verification_basis: z.literal('owner_adopted_registry_binding'), provider_identity_verified: z.literal(false),
    registry_current_verified: z.literal(false), manifest_checksum: z.literal(LINKEDIN1128.manifest),
    actor_id: z.string().regex(/^user:[1-9]\d*$/), approval_reference: z.string().min(10),
    audit_command: z.literal(LINKEDIN1128.command), audit_idempotency_key: z.string().min(1) }).passthrough();
function object(input: unknown): Record<string, unknown> {
    return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}
export function linkedIn1128Binding(quality: unknown) {
    const result = Binding.safeParse(object(quality).identity_binding);
    if (!result.success) throw new Error('[LINKEDIN1128_IDENTITY_BINDING_REQUIRED]');
    return result.data;
}
type EventReader = { findFirst(args: unknown): Promise<{ after_state?: Record<string, unknown> } | null> };
export async function assertLinkedIn1128ReleaseIdentity(events: EventReader, task: {
    project_id: number; channel_id: number | null; publish_at: Date | null; quality_report: unknown;
    visual_decision_version?: number;
    channel: { name: string; config?: unknown } | null;
}, args: { expectedManifestChecksum: string; expectedBodySha256: string; expectedSelectedAssetId: number | null;
    expectedScheduleAt: string; expectedVisualDecisionId?: number }) {
    const binding = linkedIn1128Binding(task.quality_report);
    if (object(task.quality_report).publication_hold) throw new Error('[PUBLICATION_HOLD_ACTIVE]');
    const config = object(task.channel?.config);
    if (task.project_id !== 7 || task.channel_id !== 6 || task.channel?.name !== 'seturon_linkedin_page'
        || config.account_ref !== 'seturon_linkedin_page' || config.account_type !== 'company_page'
        || object(config.raw_account).url !== binding.canonical_url
        || !isDeepStrictEqual(config.execution_modes, ['manual'])
        || args.expectedManifestChecksum !== LINKEDIN1128.manifest || args.expectedBodySha256 !== LINKEDIN1128.body
        || args.expectedScheduleAt !== LINKEDIN1128.schedule || task.publish_at?.toISOString() !== LINKEDIN1128.schedule
        || args.expectedSelectedAssetId !== null || args.expectedVisualDecisionId !== 305
        || task.visual_decision_version !== 1) {
        throw new Error('[LINKEDIN1128_EXACT_PACKAGE_REQUIRED]');
    }
    const audit = await events.findFirst({ where: { project_id: 7, content_item_id: 1128,
        actor_id: binding.actor_id, command: LINKEDIN1128.command, idempotency_key: binding.audit_idempotency_key } });
    if (audit?.after_state?.applied !== true || !isDeepStrictEqual(audit.after_state.identity_binding, binding)) {
        throw new Error('[LINKEDIN1128_AUDITED_BINDING_REQUIRED]');
    }
}

/** Keep prepare/readback manual; no inferred OAuth URN or provider verification. */
export function linkedIn1128ManualHandoff<T extends Record<string, unknown>>(bundle: T, quality: unknown) {
    const binding = linkedIn1128Binding(quality);
    return { ...bundle, mode: 'manual' as const,
        account: { ref: 'seturon_linkedin_page', details: {
            platform: 'linkedin', account_type: 'company_page', url: binding.canonical_url,
            linkedin_company_id: binding.linkedin_company_id, profile_ref: binding.profile_ref, identity_ref: binding.identity_ref } },
        task: { ...object(bundle.task), channel: 'linkedin', placement: 'feed', schedule_at: LINKEDIN1128.schedule },
        manual_checklist: [
            'Use Seturon company page https://www.linkedin.com/company/seturon/ (company 97416172), never a personal profile.',
            'Verify the actual provider company identity and duplicate history before Submit; Registry adoption is not provider proof.',
            'Publish only the accepted task1128 revision1 text, with no visual; preserve the scheduled date.',
            'Record the confirmed LinkedIn post identity and permalink through the governed publication lifecycle.'
        ] };
}
