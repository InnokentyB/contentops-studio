import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { browserRequestSchema, hash, object, snapshotHash, noBrowserDelivery,
    type BrowserDb, type BrowserRequest } from './browser_publication_contract';
import { pairingStoredSchema, pairingKey, nativePairingChallengeSchema, auditedPairing,
    pairingActiveKey, pairingActiveSchema, type PairingState } from './x_native_pairing_contract';

type Input = BrowserRequest & { publicKey: PairingState['publicKey']; installationId: string; bundleSha256: string; extensionId: string };
/** Bounded scheduling evidence only; never includes a code, key, copy or provider response. */
export class NativePairingWaitError extends Error {
    readonly retryAfterSeconds: number;
    readonly retryAt: string;
    constructor(public readonly code: 'X_NATIVE_PAIRING_ACTIVE' | 'X_NATIVE_PAIRING_THROTTLED' | 'X_NATIVE_PAIRING_BUSY', seconds: number) {
        super(`[${code}]`); this.name = 'NativePairingWaitError';
        this.retryAfterSeconds = Math.max(1, Math.min(900, Math.ceil(seconds)));
        this.retryAt = new Date(Date.now() + this.retryAfterSeconds * 1000).toISOString();
    }
}
const serialContext = (a: Input): BrowserRequest => browserRequestSchema.parse(Object.fromEntries(Object.entries(a)
    .filter(([name]) => !['publicKey', 'installationId', 'extensionId', 'bundleSha256', 'recovery'].includes(name))));
/** Current owner reissues expired unused evidence; history and legacy exhausted grants remain immutable. */
export async function issueCurrentPairing(tx: BrowserDb, a: Input): Promise<Record<string, unknown>> {
    const now = Date.now(), context = serialContext(a), activeKey = pairingActiveKey(a.installationId);
    await noBrowserDelivery(tx, a);
    const task = await tx.contentItem.findFirst({ where: { id: a.taskId, project_id: a.projectId }, include: { publication_fact: true } });
    if (task?.publication_fact || task?.published_link) throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
    if (await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId,
        key: `x_native:installation:v1:${a.snapshot.channelId}:${a.installationId}` } } }) || await tx.workflowEvent.findFirst({ where: {
        project_id: a.projectId, command: { in: ['x_native_register_installation', 'x_native_revoke_installation'] },
        idempotency_key: `${a.snapshot.channelId}:${a.installationId}` } })) {
        throw new Error('[X_NATIVE_INSTALLATION_INVALID]');
    }
    const requestHash = hash(JSON.stringify({ context, publicKey: a.publicKey, installationId: a.installationId,
        extensionId: a.extensionId, bundleSha256: a.bundleSha256 }));
    const requestKey = hash(`${a.actorId}:${a.installationId}:${a.idempotencyKey}`);
    const prior = await tx.workflowEvent.findFirst({ where: { project_id: a.projectId, actor_id: a.actorId,
        command: 'x_native_pairing_request', idempotency_key: requestKey } });
    const active = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId, key: activeKey } } });
    const pointer = active ? pairingActiveSchema.parse(JSON.parse(active.value)) : null;
    const previous = pointer ? await tx.projectSettings.findUnique({ where: { project_id_key: {
        project_id: a.projectId, key: pointer.pairingKey } } }) : await tx.projectSettings.findFirst({
        where: { project_id: a.projectId, key: { startsWith: 'x_native:pairing:v1:' },
            value: { contains: `"installationId":"${a.installationId}"` } }, orderBy: { id: 'desc' } });
    if (pointer && !previous) throw new Error('[X_NATIVE_PAIRING_AUDIT_REQUIRED]');
    const old = previous ? pairingStoredSchema.parse(JSON.parse(previous.value)) : null;
    if (old) {
        await auditedPairing(tx, old);
        if (old.consumed || old.context.projectId !== a.projectId || old.context.actorId !== a.actorId
            || old.challenge.channelId !== a.snapshot.channelId || old.challenge.installationId !== a.installationId
            || old.challenge.account !== a.snapshot.identity.accountRef || old.challenge.profileUrl !== a.snapshot.identity.profileUrl
            || old.challenge.extensionId !== a.extensionId || old.challenge.bundleSha256 !== a.bundleSha256
            || !isDeepStrictEqual(old.publicKey, a.publicKey)) throw new Error('[X_NATIVE_PAIRING_BINDING_MISMATCH]');
        if (now < Date.parse(old.challenge.issuedAt)) throw new Error('[X_NATIVE_PAIRING_INVALID]');
        if (pointer && active) {
            const audit = await tx.workflowEvent.findFirst({ where: { project_id: a.projectId, actor_id: a.actorId,
                command: 'x_native_issue_pairing', idempotency_key: hash(old.challenge.nonce) } });
            if (object(audit?.after_state).active_sha256 !== hash(active.value)) throw new Error('[X_NATIVE_PAIRING_AUDIT_REQUIRED]');
        }
    }
    if (prior) {
        const p = object(prior.after_state);
        if (p.request_sha256 !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
        if (!old || p.pairing_key !== pairingKey(old.challenge.nonce) || now >= Date.parse(old.challenge.expiresAt)) {
            throw new Error('[X_NATIVE_PAIRING_EXPIRED]');
        }
        return { mode: 'pairing_challenge', challenge: old.challenge, replayed: true, publication_authorized: false };
    }
    if (old && now < Date.parse(old.challenge.expiresAt)) {
        throw new NativePairingWaitError('X_NATIVE_PAIRING_ACTIVE', (Date.parse(old.challenge.expiresAt) - now) / 1000);
    }
    const recent = await tx.workflowEvent.findMany({ where: { project_id: a.projectId, actor_id: a.actorId,
        command: { in: ['x_native_issue_pairing', 'x_native_recover_pairing'] }, created_at: { gt: new Date(now - 900000) } },
        select: { created_at: true }, orderBy: { created_at: 'asc' } });
    if (recent.some(e => !Number.isFinite(e.created_at.getTime()) || e.created_at.getTime() > now)) throw new Error('[X_NATIVE_PAIRING_INVALID]');
    if (recent.length >= 10) {
        const cutoff = recent[recent.length - 10]!.created_at.getTime();
        throw new NativePairingWaitError('X_NATIVE_PAIRING_THROTTLED', (cutoff + 900000 - now) / 1000);
    }
    const s = a.snapshot;
    const challenge = nativePairingChallengeSchema.parse({ version: 1, purpose: 'pair', projectId: a.projectId,
        taskId: a.taskId, channelId: s.channelId, revision: s.contentRevision, bodySha256: s.bodySha256,
        manifest: s.manifestChecksum, account: s.identity.accountRef, profileUrl: s.identity.profileUrl,
        scheduleAt: s.scheduleAt, installationId: a.installationId, bundleSha256: a.bundleSha256, actorId: a.actorId, extensionId: a.extensionId,
        nonce: randomBytes(32).toString('hex'), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() });
    const nextKey = pairingKey(challenge.nonce), next = pairingStoredSchema.parse({ challenge, context, publicKey: a.publicKey,
        verifiedSha256: null, consumed: false, issueVersion: 2 });
    const nextPointer = JSON.stringify({ pairingKey: nextKey, generation: (pointer?.generation ?? 0) + 1 });
    if (previous && (await tx.projectSettings.updateMany({ where: { id: previous.id, value: previous.value },
        data: { value: previous.value } })).count !== 1) throw new NativePairingWaitError('X_NATIVE_PAIRING_BUSY', 1);
    if (active) {
        if ((await tx.projectSettings.updateMany({ where: { id: active.id, value: active.value }, data: { value: nextPointer } })).count !== 1) {
            throw new NativePairingWaitError('X_NATIVE_PAIRING_BUSY', 1);
        }
    } else await tx.projectSettings.create({ data: { project_id: a.projectId, key: activeKey, value: nextPointer } });
    await tx.projectSettings.create({ data: { project_id: a.projectId, key: nextKey, value: JSON.stringify(next) } });
    if (old) await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: old.context.taskId, actor_id: a.actorId,
        command: 'x_native_pairing_superseded', idempotency_key: hash(old.challenge.nonce),
        after_state: { successor_nonce_sha256: hash(challenge.nonce), publication_authorized: false } } });
    await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, actor_id: a.actorId,
        command: 'x_native_issue_pairing', idempotency_key: hash(challenge.nonce), after_state: { installation_id: a.installationId,
            bundle_sha256: a.bundleSha256, challenge_sha256: hash(JSON.stringify(challenge)), snapshot_sha256: snapshotHash(s),
            active_sha256: hash(nextPointer), publication_authorized: false } } });
    await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, actor_id: a.actorId,
        command: 'x_native_pairing_request', idempotency_key: requestKey,
        after_state: { request_sha256: requestHash, pairing_key: nextKey, publication_authorized: false } } });
    return { mode: 'pairing_challenge', challenge, publication_authorized: false };
}
