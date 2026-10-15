import { z } from 'zod';

export const THREADS1114 = {
    projectId: 10, taskId: 1114, channelId: 138, revision: 1,
    bodySha256: '466b5444832d0b0fdf326461cbe7e6c3a41aab5704b9bc42697f29676f938f5a',
    schedule: '2026-10-14T16:30:00.000Z',
    manifest: 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7',
    userId: '39421253764155091', username: 'innokentybo', decisionId: 309,
    releaseCommand: 'ba_release_threads_task1114_api', sendCommand: 'ba_publish_threads_task1114'
} as const;

const Snapshot = z.object({
    projectId: z.literal(10), taskId: z.literal(1114), channelId: z.literal(138),
    revision: z.literal(1), acceptedRevision: z.literal(1),
    bodySha256: z.literal(THREADS1114.bodySha256),
    scheduleAt: z.literal(THREADS1114.schedule), publishAt: z.literal(THREADS1114.schedule),
    manifest: z.literal(THREADS1114.manifest), owner: z.literal(true), activeChannel: z.literal(true),
    username: z.literal(THREADS1114.username), userId: z.literal(THREADS1114.userId),
    accepted: z.literal(true), handoffReady: z.literal(true), selectedAssetId: z.null(),
    visualState: z.literal('NO_VISUAL_NEEDED'), decisionId: z.literal(309), decisionVersion: z.literal(1),
    decisionRevision: z.literal(1), decisionActive: z.literal(true), decisionKind: z.literal('NO_VISUAL_NEEDED'),
    decisionChannel: z.literal('threads'), placement: z.literal('feed'),
    reviewComplete: z.literal(true), artComplete: z.literal(true), hasFact: z.literal(false),
    hasAttempt: z.literal(false), hasBrowserWork: z.literal(false),
    status: z.literal('ready_for_execution'), mode: z.enum(['approval_required', 'owner_released'])
});

/** Only authoritative server-derived snapshots may enter this boundary. */
export function assertThreads1114Snapshot(input: unknown, released: boolean) {
    const parsed = Snapshot.safeParse(input);
    if (!parsed.success || parsed.data.mode !== (released ? 'owner_released' : 'approval_required')) {
        throw new Error('[THREADS1114_PACKAGE_GUARD_FAILED]');
    }
    return parsed.data;
}

export const threads1114ArgsSchema = z.object({
    projectId: z.literal(10), taskId: z.literal(1114), actorId: z.string().regex(/^user:[1-9]\d*$/),
    expectedManifestChecksum: z.literal(THREADS1114.manifest),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1), releaseIdempotencyKey: z.string().min(1)
});
export type Threads1114Args = z.infer<typeof threads1114ArgsSchema>;
