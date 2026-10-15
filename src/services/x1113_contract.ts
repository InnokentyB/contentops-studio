import { z } from 'zod';
export const X1113 = { projectId: 10, taskId: 1113, channelId: 164, revision: 1,
    bodySha256: '0fa60a2b064bad760b251a12ab39cf38735987dabecc57dcad1d60a46dec12e3',
    schedule: '2026-10-14T15:00:00.000Z',
    manifest: 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7',
    account: '@naraHeTc', url: 'https://x.com/naraHeTc', browserProfile: 'Innokenty', decisionId: 308 } as const;
export const x1113ReleaseSchema = z.object({ projectId: z.literal(10), taskId: z.literal(1113),
    actorId: z.string().regex(/^user:[1-9]\d*$/), expectedManifestChecksum: z.literal(X1113.manifest),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
    duplicateCheckReference: z.string().min(10) });
export const x1113BoundarySchema = x1113ReleaseSchema.extend({ channelId: z.literal(164),
    workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
    contentRevision: z.literal(1), textSha256: z.literal(X1113.bodySha256),
    selectedAssetId: z.null(), imageSha256: z.null(), releaseIdempotencyKey: z.string().min(1),
    browserProfile: z.literal('Innokenty'), observedAccountRef: z.literal('@naraHeTc'),
    observedAt: z.string().datetime({ offset: true }), clientRuntimeGuardSha256: z.string().regex(/^[a-f0-9]{64}$/),
    contextSource: z.literal('owning_publisher_live_browser_info') });
export type X1113Release = z.infer<typeof x1113ReleaseSchema>;
export type X1113Boundary = z.infer<typeof x1113BoundarySchema>;
