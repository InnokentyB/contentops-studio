import { z } from 'zod';
import { LINKEDIN1128 } from './linkedin1128_identity.service';
export const LINKEDIN1128R3 = { ...LINKEDIN1128,
    body: '31f5ec957c336d751fe0684b93bf5746d0b2863798273214c7c7f929876d2ddb',
    command: 'ba_release_linkedin_task1128_rev3_browser', oldAttemptKey: 'start-linkedin-p7-1128-wi1924-20261015-01' } as const;
export const rev3BaseSchema = z.object({ projectId: z.literal(7), taskId: z.literal(1128), channelId: z.literal(6),
    actorId: z.string().regex(/^user:[1-9]\d*$/), approvalReference: z.string().trim().min(10),
    expectedManifestChecksum: z.literal(LINKEDIN1128.manifest), idempotencyKey: z.string().min(1),
    contentRevision: z.literal(3), textSha256: z.literal(LINKEDIN1128R3.body), selectedAssetId: z.null(), imageSha256: z.null() });
export const rev3ReleaseSchema = rev3BaseSchema.extend({ apply: z.boolean().default(false),
    noSubmitEvidenceReference: z.string().min(10), expectedOldAttemptId: z.literal(38), expectedOldWorkItemId: z.literal(1924) });
export const linkedin1128Rev3SubmissionSchema = rev3BaseSchema.extend({
    workItemId: z.number().int().positive().refine(v => v !== 1924), leaseToken: z.string().min(1),
    releaseIdempotencyKey: z.string().min(1), observedCompanyId: z.literal('97416172'),
    authorEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/), duplicateCheckReference: z.string().min(10),
    actionTimeConfirmationReference: z.string().min(10).optional(), observedEditorText: z.string().min(1).max(10000).optional() });
export type LinkedIn1128Rev3Submission = z.infer<typeof linkedin1128Rev3SubmissionSchema>;
export type Rev3Base = z.infer<typeof rev3BaseSchema>;
export const rev3ClaimSchema = linkedin1128Rev3SubmissionSchema.omit({ leaseToken: true });
const PreProvider = z.object({ actor: z.string(),
    work: z.object({ id: z.literal(1924), state: z.literal('claimed'), input_context_version: z.literal(1), lease_actor_id: z.string() }),
    attempts: z.tuple([z.object({ id: z.literal(38), channel_id: z.literal(6), status: z.literal('pending'),
        actual_published_at: z.null(), requires_manual_confirmation: z.literal(true), idempotency_key: z.literal(LINKEDIN1128R3.oldAttemptKey) })]),
    events: z.array(z.object({ id: z.number().optional(), command: z.string(), actor_id: z.string().optional(),
        work_item_id: z.number().nullable().optional(), idempotency_key: z.string().nullable().optional(),
        after_state: z.record(z.string(), z.unknown()).nullable().optional() })) });
export function assertRev1PreProvider(input: unknown) {
    const result = PreProvider.safeParse(input);
    if (!result.success) throw new Error('[LINKEDIN1128_REV3_RECONCILIATION_REQUIRED]');
    const s = result.data;
    const start = s.events.filter(e => e.command === 'ba_start_linkedin_task1128_browser_submission');
    if (s.work.lease_actor_id !== s.actor || start.length !== 1 || start[0].id !== 3243 || start[0].actor_id !== s.actor
        || start[0].work_item_id !== 1924 || start[0].idempotency_key !== LINKEDIN1128R3.oldAttemptKey
        || start[0].after_state?.attempt_id !== 38 || s.events.some(e =>
            /pre_submit|confirm.*publication|confirm_linkedin|uncertain|reconcile.*linkedin/.test(e.command))) {
        throw new Error('[LINKEDIN1128_REV3_RECONCILIATION_REQUIRED]');
    }
}
