import { assertDzen1002CurrentManifest, DZEN1002_MANIFEST } from './dzen_task1002_manifest';
import { requireDzen1002Action } from './dzen1002_action_restriction';
import { releaseDzenTaskWithPrisma } from './dzen_owner_release.service';
import dzenTaskPublicationService from './dzen_task_publication.service';

export const DZEN1002_ROUTE = {
    projectId: 10, taskId: 1002, channelId: 116, revision: 3,
    bodySha256: '570bf2c102911ae4fc678ad453bb0289e48cf4e6161e874d6e39811e2527e9bb',
    decisionId: 300, decisionVersion: 2, selectedAssetId: 151,
    assetSha256: '003dae64a6087ee456bb9af583b78955c6a6738de294ca7cf75c83b151d06a12',
    placement: 'article_cover', schedule: '2026-10-13T11:30:00.000Z',
    manifest: DZEN1002_MANIFEST,
    providerChannelId: '6a8029aba055ec36033bf81c'
} as const;

type RouteArgs = {
    projectId: 10; taskId: 1002; actorId: string;
    expectedManifestChecksum: typeof DZEN1002_ROUTE.manifest;
    expectedBodySha256: typeof DZEN1002_ROUTE.bodySha256;
    expectedScheduleAt: typeof DZEN1002_ROUTE.schedule;
    approvalReference: string; idempotencyKey: string;
};

function ownerUserId(actorId: string) {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}

function assertScope(args: RouteArgs) {
    if (args.projectId !== DZEN1002_ROUTE.projectId || args.taskId !== DZEN1002_ROUTE.taskId
        || args.expectedManifestChecksum !== DZEN1002_ROUTE.manifest
        || args.expectedBodySha256 !== DZEN1002_ROUTE.bodySha256
        || args.expectedScheduleAt !== DZEN1002_ROUTE.schedule) {
        throw new Error('[DZEN1002_ROUTE_SCOPE_MISMATCH]');
    }
}

/** Records exact owner authorization only; never contacts Dzen. */
export async function releaseDzenTask1002(args: RouteArgs) {
    assertScope(args);
    return releaseDzenTaskWithPrisma({
        ...args,
        expectedChannelId: DZEN1002_ROUTE.channelId,
        expectedContentRevision: DZEN1002_ROUTE.revision,
        expectedAcceptedRevision: DZEN1002_ROUTE.revision,
        expectedVisualState: 'APPROVED',
        expectedPlacement: DZEN1002_ROUTE.placement,
        expectedVisualDecisionVersion: DZEN1002_ROUTE.decisionVersion,
        expectedVisualDecisionId: DZEN1002_ROUTE.decisionId,
        expectedSelectedAssetId: DZEN1002_ROUTE.selectedAssetId,
        expectedAssetSha256: DZEN1002_ROUTE.assetSha256,
        expectedPublishAt: DZEN1002_ROUTE.schedule,
        releaseCommand: 'ba_release_dzen_task1002'
    });
}

/** Authenticated provider-read-only inventory preflight; never creates or edits content. */
export async function preflightDzenTask1002(args: RouteArgs) {
    assertScope(args);
    const userId = ownerUserId(args.actorId);
    await assertDzen1002CurrentManifest(userId);
    // Manifest approval does not resolve the recorded action-scope question.
    requireDzen1002Action('inventory');
    return dzenTaskPublicationService.verifyConnector({ projectId: 10, taskId: 1002,
        actorId: args.actorId, idempotencyKey: args.idempotencyKey });
}
