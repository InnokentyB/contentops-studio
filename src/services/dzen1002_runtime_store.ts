import { Prisma } from '@prisma/client';
import { DZEN1002_RUNTIME as p, dzen1002Hash, dzen1002Object as obj, validateDzen1002Receipt } from './dzen1002_runtime_contract';
import type { Dzen1002Args as Args, Dzen1002Claim as Claim, Dzen1002Result as Result, Dzen1002Receipt } from './dzen1002_runtime_contract';
import { DZEN1002_COMMAND as command, DZEN1002_SYSTEM_ACTOR as actor, dzen1002Serializable as serial,
    dzen1002CommittedClaim, dzen1002Snapshot, dzen1002Owner, dzen1002ReadClaim, dzen1002RequireStarted, dzen1002Event } from './dzen1002_runtime_store_guard';
import type { Dzen1002StoreDependencies } from './dzen1002_runtime_store_guard';
export type { Dzen1002StoreDependencies } from './dzen1002_runtime_store_guard';
const frozen = (id?: number): Result => ({ mode: 'verification_required', task_id: 1002, retry_allowed: false, ...(id ? { attempt_id: id } : {}) });
/** Existing-table persistence only. No transaction ever runs provider code. */
export class Dzen1002RuntimeStore {
    constructor(readonly dependencies: Dzen1002StoreDependencies) {}
    private now() { return this.dependencies.now?.() || new Date(); }
    async inspect(a: Args) {
        return this.dependencies.db.$transaction(async tx => (await dzen1002Snapshot(tx, a, this.dependencies)).package, serial);
    }
    async claim(a: Args): Promise<Claim> {
        return this.dependencies.db.$transaction(async tx => {
            const snap = await dzen1002Snapshot(tx, a, this.dependencies);
            const [attempt, fact, legacy, browser, preflight] = await Promise.all([
                tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1002 } }),
                tx.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1002 } }),
                tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002, command: { in: [`${command}_claim`, `${command}:claim`, command] } } }),
                tx.workItem.findFirst({ where: { project_id: 10, content_item_id: 1002, kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } }),
                tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002, actor_id: a.actorId,
                    command: 'ba_preflight_dzen_task1002' }, orderBy: { id: 'desc' } })
            ]);
            if (attempt || fact || legacy || browser) throw new Error('[DZEN1002_RECONCILIATION_REQUIRED]');
            const proof = obj(preflight?.after_state); const inventory = obj(proof.inventory);
            const age = this.now().getTime() - Date.parse(String(proof.checked_at));
            if (!Number.isFinite(age) || age < 0 || age > 15 * 60_000 || proof.task_id !== 1002 || proof.channel_id !== 116
                || proof.body_sha256 !== p.bodySha256 || proof.asset_sha256 !== p.assetSha256 || proof.selected_asset_id !== 151
                || proof.authenticated !== true || proof.editor_available !== true || inventory.classification !== 'absent'
                || inventory.exact_title_matches !== 0 || inventory.coverage_complete !== true
                || inventory.provider_channel_id !== p.providerChannelId || inventory.expected_public_title !== snap.package.title) throw new Error('[DZEN1002_FRESH_INVENTORY_REQUIRED]');
            const changed = await tx.contentItem.updateMany({ where: { project_id: 10, id: 1002,
                status: 'ready_for_execution', publication_mode: 'owner_released', updated_at: snap.task.updated_at }, data: { status: 'publishing' } });
            if (changed.count !== 1) throw new Error('[DZEN1002_CAS_CONFLICT]');
            const created = await tx.deliveryAttempt.create({ data: { project_id: 10, content_item_id: 1002,
                channel_id: 116, mode: 'automatic', status: 'pending', attempt_number: 1, idempotency_key: a.idempotencyKey,
                scheduled_at: snap.task.schedule_at, requires_manual_confirmation: true } });
            await dzen1002Event(tx, 'claim', a.idempotencyKey, { actor_id: a.actorId, attempt_id: created.id,
                package: { ...snap.package }, release_id: 3126 });
            return { attemptId: created.id, key: a.idempotencyKey, package: snap.package };
        }, serial);
    }
    async loadClaim(a: Args, id: number) {
        return this.dependencies.db.$transaction(tx => dzen1002ReadClaim(tx, a, id, this.dependencies), serial);
    }
    private async bound(tx: Prisma.TransactionClient, a: Args, c: Claim) {
        const stored = await dzen1002ReadClaim(tx, a, c.attemptId, this.dependencies);
        if (stored.key !== c.key || stored.package.digest !== c.package.digest || JSON.stringify(stored.package) !== JSON.stringify(c.package)) throw new Error('[DZEN1002_CLAIM_MISMATCH]');
        return stored;
    }
    async start(a: Args, c: Claim): Promise<void> {
        await this.dependencies.db.$transaction(async tx => {
            await this.bound(tx, a, c);
            const attempt = await tx.deliveryAttempt.findUnique({ where: { id: c.attemptId } });
            if (attempt?.status !== 'pending') throw new Error('[DZEN1002_ATTEMPT_FROZEN]');
            await dzen1002Event(tx, 'started', String(c.attemptId), { attempt_id: c.attemptId, package_digest: c.package.digest });
        }, serial);
    }
    async assertSubmit(a: Args, c: Claim): Promise<void> {
        await this.dependencies.db.$transaction(async tx => {
            await this.bound(tx, a, c); await dzen1002RequireStarted(tx, c);
            const attempt = await tx.deliveryAttempt.findUnique({ where: { id: c.attemptId } });
            if (attempt?.status !== 'pending' || attempt.error_message) throw new Error('[DZEN1002_ATTEMPT_FROZEN]');
        }, serial);
    }
    async saveReceipt(a: Args, c: Claim, value: Dzen1002Receipt): Promise<void> {
        const receipt = validateDzen1002Receipt(value, c, this.now());
        await this.dependencies.db.$transaction(async tx => {
            await dzen1002CommittedClaim(tx, a, c, this.dependencies); await dzen1002RequireStarted(tx, c);
            const prior = await this.receipt(tx, c);
            if (prior) {
                if (JSON.stringify(prior) !== JSON.stringify(receipt)) throw new Error('[DZEN1002_RECEIPT_CONFLICT]');
                return;
            }
            const changed = await tx.deliveryAttempt.updateMany({ where: { id: c.attemptId, project_id: 10, content_item_id: 1002,
                idempotency_key: c.key, status: 'pending' }, data: { status: 'verification_required', requires_manual_confirmation: true } });
            if (changed.count !== 1) throw new Error('[DZEN1002_ATTEMPT_CONFLICT]');
            await dzen1002Event(tx, 'receipt', String(c.attemptId), { receipt: { ...receipt }, receipt_digest: dzen1002Hash(JSON.stringify(receipt)) });
        }, serial);
    }
    private async receipt(tx: Prisma.TransactionClient, c: Claim): Promise<Dzen1002Receipt | null> {
        const event = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002,
            actor_id: actor, command: `${command}:receipt`, idempotency_key: String(c.attemptId) } });
        if (!event) return null;
        const r = validateDzen1002Receipt(obj(event.after_state).receipt, c, this.now());
        if (obj(event.after_state).receipt_digest !== dzen1002Hash(JSON.stringify(r))) throw new Error('[DZEN1002_RECEIPT_CONFLICT]');
        return r;
    }
    private async canonical(tx: Prisma.TransactionClient, c: Claim, r: Dzen1002Receipt): Promise<Result | null> {
        const fact = await tx.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1002 } });
        if (!fact) return null;
        if (fact.artifact_kind !== 'article' || fact.outcome !== 'published' || fact.channel_id !== 116
            || fact.public_url !== r.url || fact.provider_object_id !== r.objectId || fact.published_at?.toISOString() !== r.publishedAt
            || fact.confirmation_mode !== 'automatic' || fact.evidence_type !== 'api' || fact.evidence_ref !== r.objectId) throw new Error('[DZEN1002_FACT_CONFLICT]');
        const attempt = await tx.deliveryAttempt.findUnique({ where: { id: c.attemptId } });
        const completed = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002, actor_id: actor,
            command: `${command}:completed`, idempotency_key: String(c.attemptId) } });
        if (attempt?.status !== 'delivered' || obj(completed?.after_state).package_digest !== c.package.digest) throw new Error('[DZEN1002_COMPLETION_CONFLICT]');
        return { mode: 'published', task_id: 1002, attempt_id: c.attemptId, retry_allowed: false, published_link: r.url, external_id: r.objectId };
    }
    async confirm(a: Args, c: Claim): Promise<Result> {
        const receipt = await this.dependencies.db.$transaction(async tx => {
            await this.bound(tx, a, c); await dzen1002RequireStarted(tx, c);
            return this.receipt(tx, c);
        }, serial);
        if (!receipt) return frozen(c.attemptId);
        for (let retry = 0; retry < 3; retry += 1) {
            try {
                await this.dependencies.facts.record({ projectId: 10, taskId: 1002, actorId: a.actorId, artifactKind: 'article',
                    outcome: 'published', confirmationMode: 'automatic', publicUrl: receipt.url, providerObjectId: receipt.objectId,
                    publishedAt: receipt.publishedAt, evidence: { type: 'api', ref: receipt.objectId }, beforeWrite: async tx => {
                        await this.bound(tx, a, c); await dzen1002RequireStarted(tx, c);
                        const retained = await this.receipt(tx, c);
                        if (!retained || JSON.stringify(retained) !== JSON.stringify(receipt)) throw new Error('[DZEN1002_RECEIPT_CONFLICT]');
                        if (await this.canonical(tx, c, receipt)) return;
                        const changed = await tx.deliveryAttempt.updateMany({ where: { id: c.attemptId, project_id: 10,
                            content_item_id: 1002, idempotency_key: c.key, status: 'verification_required' }, data: {
                                status: 'delivered', actual_published_at: new Date(receipt.publishedAt), requires_manual_confirmation: false, error_message: null } });
                        if (changed.count !== 1) throw new Error('[DZEN1002_ATTEMPT_CONFLICT]');
                        await dzen1002Event(tx, 'completed', String(c.attemptId), { attempt_id: c.attemptId,
                            package_digest: c.package.digest, public_url: receipt.url, provider_object_id: receipt.objectId });
                    } });
                const result = await this.replay(a, c.attemptId);
                if (!result || result.mode !== 'published') throw new Error('[DZEN1002_COMPLETION_MISSING]');
                return result;
            } catch (error: unknown) {
                const completed = await this.replay(a, c.attemptId);
                if (completed?.mode === 'published') return completed;
                if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || retry === 2) throw error;
            }
        }
        return frozen(c.attemptId);
    }
    async replay(a: Args, attemptId?: number): Promise<Result | null> {
        return this.dependencies.db.$transaction(async tx => {
            await dzen1002Owner(tx, a, this.dependencies);
            const attempts = await tx.deliveryAttempt.findMany({ where: { project_id: 10, content_item_id: 1002 }, orderBy: { id: 'asc' } });
            const fact = await tx.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1002 } });
            if (!attempts.length) return fact ? frozen() : null;
            const attempt = attempts[0];
            if (attemptId !== undefined && attempt.id !== attemptId) throw new Error('[DZEN1002_ATTEMPT_CONFLICT]');
            const event = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1002, actor_id: actor,
                command: `${command}:claim`, idempotency_key: attempt.idempotency_key } });
            if (!event || attempts.length !== 1) return frozen(attempt.id);
            const originalArgs = { ...a, idempotencyKey: attempt.idempotency_key || '' };
            const c = await dzen1002ReadClaim(tx, originalArgs, attempt.id, this.dependencies);
            const r = await this.receipt(tx, c);
            return r ? await this.canonical(tx, c, r) || frozen(c.attemptId) : frozen(c.attemptId);
        }, serial);
    }
    async uncertain(a: Args, c: Claim): Promise<void> {
        await this.dependencies.db.$transaction(async tx => {
            await dzen1002Owner(tx, a, this.dependencies);
            const attempt = await tx.deliveryAttempt.findFirst({ where: { id: c.attemptId, project_id: 10, content_item_id: 1002, idempotency_key: c.key } });
            if (!attempt || c.key !== a.idempotencyKey) throw new Error('[DZEN1002_ATTEMPT_CONFLICT]');
            if (attempt.status === 'delivered') return;
            await tx.deliveryAttempt.update({ where: { id: c.attemptId }, data: { error_message: 'DZEN1002_OUTCOME_UNCERTAIN_RECONCILE_ONLY', requires_manual_confirmation: true } });
        }, serial);
    }
}
