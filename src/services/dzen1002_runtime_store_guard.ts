import { Prisma, PrismaClient } from '@prisma/client';
import type { RecordPublicationFactArgs } from './publication_fact.service';
import { DZEN1002_RUNTIME as p, dzen1002Hash, dzen1002Object as obj, dzen1002PackageSchema } from './dzen1002_runtime_contract';
import type { Dzen1002Args as Args, Dzen1002Package, Dzen1002Claim } from './dzen1002_runtime_contract';
export const DZEN1002_SYSTEM_ACTOR = 'system:planner-mcp:dzen-task1002';
export const DZEN1002_COMMAND = 'ba_publish_dzen_task1002';
export const dzen1002Serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
export interface Dzen1002StoreDependencies {
    db: PrismaClient;
    loadManifest: (projectId: number, userId: number, tx?: Prisma.TransactionClient) => Promise<{ checksum: string; project: { slug: string } }>;
    facts: { record(args: RecordPublicationFactArgs): Promise<unknown> };
    now?: () => Date;
    /** Synthetic tests only; production construction uses SHA256. */
    hashBody?: (body: string) => string;
}
export async function dzen1002Owner(tx: Prisma.TransactionClient, a: Args, d: Dzen1002StoreDependencies) {
    if (a.projectId !== 10 || a.taskId !== 1002 || !/^[\w.:-]{1,200}$/.test(a.idempotencyKey)) throw new Error('[DZEN1002_SCOPE_MISMATCH]');
    const actor = /^user:([1-9]\d*)$/.exec(a.actorId);
    if (!actor) throw new Error('[OWNER_REQUIRED]');
    const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: Number(actor[1]) } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const manifest = await d.loadManifest(10, Number(actor[1]), tx);
    if (a.expectedManifestChecksum !== p.manifest || manifest.checksum !== p.manifest || manifest.project.slug !== 'analystcraft-2') throw new Error('[STALE_MANIFEST]');
}
export async function dzen1002Snapshot(tx: Prisma.TransactionClient, a: Args, d: Dzen1002StoreDependencies, claimed = false) {
    await dzen1002Owner(tx, a, d);
    const task = await tx.contentItem.findFirst({ where: { project_id: 10, id: 1002 }, include: { channel: true, selected_asset: true } });
    const release = await tx.workflowEvent.findFirst({ where: { id: 3126, project_id: 10, content_item_id: 1002,
        command: 'ba_release_dzen_task1002', actor_id: a.actorId } });
    const decision = await tx.artDirectionDecision.findFirst({ where: { id: 300, project_id: 10, content_item_id: 1002,
        source_content_revision: 3, decision_version: 2, status: 'active', channel: 'dzen', placement: 'article_cover' } });
    const body = task?.draft_text || '';
    const bodyHash = (d.hashBody || dzen1002Hash)(body);
    const proof = obj(release?.after_state);
    const asset = task?.selected_asset;
    const provenance = obj(asset?.provenance);
    const assetHash = obj(provenance.planner_storage).sha256 || provenance.sha256;
    const accountId = obj(task?.channel?.config).channel_id;
    const hold = obj(task?.quality_report);
    if (!task || task.channel_id !== 116 || task.channel?.project_id !== 10 || task.channel.type !== 'dzen' || !task.channel.is_active
        || accountId !== p.providerChannelId || task.content_revision !== 3 || task.accepted_revision !== 3
        || task.text_state !== 'accepted' || task.handoff_state !== 'ready' || task.visual_state !== 'APPROVED'
        || task.visual_placement !== p.placement || task.visual_decision_version !== 2 || task.selected_asset_id !== 151
        || task.publication_mode !== 'owner_released' || !decision || decision.decision === 'NO_VISUAL_NEEDED'
        || !body.trim() || bodyHash !== p.bodySha256 || !task.title?.trim()
        || task.schedule_at?.toISOString() !== p.schedule || task.publish_at?.toISOString() !== p.schedule
        || asset?.project_id !== 10 || asset.content_item_id !== 1002 || asset.decision_id !== 300 || asset.content_revision !== 3
        || asset.status !== 'approved' || assetHash !== p.assetSha256 || !asset.file_url?.startsWith('https://')
        || hold.publication_hold || (!claimed && (task.status !== 'ready_for_execution' || task.published_link
            || hold.dzen_publish_claim || hold.dzen_publication_pending
            || ['provider_call_started', 'provider_result_uncertain', 'provider_confirmed_fact_pending'].includes(String(obj(hold.publication_task_delivery).state))))
        || (claimed && !['publishing', 'published'].includes(task.status))
        || !release || proof.task_id !== 1002 || proof.channel_id !== 116 || proof.content_revision !== 3
        || proof.accepted_revision !== 3 || proof.body_sha256 !== p.bodySha256 || proof.visual_decision_id !== 300
        || proof.visual_decision_version !== 2 || proof.publish_at !== p.schedule
        || proof.selected_asset_id !== 151 || proof.asset_sha256 !== p.assetSha256 || proof.schedule_at !== p.schedule
        || proof.publication_mode !== 'owner_released') throw new Error('[DZEN1002_PACKAGE_MISMATCH]');
    const data = { projectId: 10, taskId: 1002, channelId: 116, revision: 3, decisionId: 300, decisionVersion: 2,
        selectedAssetId: 151, bodySha256: bodyHash, assetSha256: p.assetSha256, schedule: p.schedule, manifest: p.manifest,
        releaseId: 3126, accountId, body, title: task.title, assetUrl: asset.file_url };
    const pkg: Dzen1002Package = { ...data, digest: dzen1002Hash(JSON.stringify(data)) };
    return { task, package: pkg };
}
export async function dzen1002Event(tx: Prisma.TransactionClient, kind: string, key: string, after: Prisma.InputJsonObject) {
    return tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1002, actor_id: DZEN1002_SYSTEM_ACTOR,
        command: `${DZEN1002_COMMAND}:${kind}`, idempotency_key: key, after_state: after } });
}
export async function dzen1002ReadClaim(tx: Prisma.TransactionClient, a: Args, id: number, d: Dzen1002StoreDependencies): Promise<Dzen1002Claim> {
    await dzen1002Owner(tx, a, d);
    const event = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002,
        actor_id: DZEN1002_SYSTEM_ACTOR, command: `${DZEN1002_COMMAND}:claim`, idempotency_key: a.idempotencyKey } });
    const state = obj(event?.after_state);
    const pkg = obj(state.package);
    const attempt = await tx.deliveryAttempt.findFirst({ where: { id, project_id: 10, content_item_id: 1002,
        channel_id: 116, mode: 'automatic', idempotency_key: a.idempotencyKey } });
    const snap = await dzen1002Snapshot(tx, a, d, true);
    if (!attempt || state.attempt_id !== id || pkg.digest !== snap.package.digest
        || state.actor_id !== a.actorId || await tx.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1002 } }) !== 1) throw new Error('[DZEN1002_CLAIM_MISMATCH]');
    return { attemptId: id, key: a.idempotencyKey, package: snap.package };
}
/** Internal receipt custody survives post-submit eligibility/owner/manifest drift. */
export async function dzen1002CommittedClaim(tx: Prisma.TransactionClient, a: Args, c: Dzen1002Claim,
    d: Dzen1002StoreDependencies): Promise<Dzen1002Claim> {
    if (a.projectId !== 10 || a.taskId !== 1002 || c.key !== a.idempotencyKey
        || a.expectedManifestChecksum !== p.manifest) throw new Error('[DZEN1002_CLAIM_MISMATCH]');
    const event = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002,
        actor_id: DZEN1002_SYSTEM_ACTOR, command: `${DZEN1002_COMMAND}:claim`, idempotency_key: c.key } });
    const state = obj(event?.after_state);
    const pkg = dzen1002PackageSchema.parse(state.package);
    const { digest, ...data } = pkg;
    const attempt = await tx.deliveryAttempt.findFirst({ where: { id: c.attemptId, project_id: 10, content_item_id: 1002,
        channel_id: 116, mode: 'automatic', idempotency_key: c.key } });
    if (!attempt || state.attempt_id !== c.attemptId || state.actor_id !== a.actorId || state.release_id !== 3126
        || digest !== dzen1002Hash(JSON.stringify(data)) || JSON.stringify(pkg) !== JSON.stringify(c.package)
        || (d.hashBody || dzen1002Hash)(pkg.body) !== p.bodySha256) throw new Error('[DZEN1002_CLAIM_MISMATCH]');
    return { attemptId: c.attemptId, key: c.key, package: pkg };
}
export async function dzen1002RequireStarted(tx: Prisma.TransactionClient, c: Dzen1002Claim) {
    const started = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002,
        actor_id: DZEN1002_SYSTEM_ACTOR, command: `${DZEN1002_COMMAND}:started`, idempotency_key: String(c.attemptId) } });
    if (obj(started?.after_state).package_digest !== c.package.digest) throw new Error('[DZEN1002_NOT_STARTED]');
}
