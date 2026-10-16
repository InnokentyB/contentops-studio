import { z } from 'zod';

export const LINKEDIN1086 = {
    body: '52da1d66f2c06e3b953ac41f7e132a6a34ff6d83b4817edf9603fdcb8d9d865b',
    manifest: 'sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd',
    schedule: '2026-10-15T09:00:00.000Z',
    profile: 'https://www.linkedin.com/in/innokentyb/',
    command: 'ba_release_linkedin_task1086_browser'
} as const;
export const base1086Schema = z.object({
    projectId: z.literal(7), taskId: z.literal(1086), channelId: z.literal(5),
    actorId: z.string().regex(/^user:[1-9]\d*$/), approvalReference: z.string().trim().min(10),
    expectedManifestChecksum: z.literal(LINKEDIN1086.manifest), idempotencyKey: z.string().min(1),
    contentRevision: z.literal(1), textSha256: z.literal(LINKEDIN1086.body),
    selectedAssetId: z.null(), imageSha256: z.null()
});
export const release1086Schema = base1086Schema.extend({ apply: z.boolean().default(false) });
export const submission1086Schema = base1086Schema.extend({
    workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
    releaseIdempotencyKey: z.string().min(1), observedProfileUrl: z.literal(LINKEDIN1086.profile),
    authorEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/), duplicateCheckReference: z.string().min(10),
    actionTimeConfirmationReference: z.string().min(10).optional(),
    recoveryGeneration: z.literal(1).optional(),
    recoveryObservedAt: z.string().datetime({ offset: true }).optional(),
    observedEditorText: z.string().min(1).max(10000).optional()
});
export const claim1086Schema = submission1086Schema.omit({ leaseToken: true });
export type Base1086 = z.infer<typeof base1086Schema>;
export type Submission1086 = z.infer<typeof submission1086Schema>;
