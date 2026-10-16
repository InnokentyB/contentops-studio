import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import publicationFactService, { RecordPublicationFactArgs } from './publication_fact.service';
import { EXACT_BROWSER_PACKAGES, checkedBoundary, loadTask, assertPackage,
    releaseExactBrowserTask, startExactBrowserSubmission,
    validateProviderIdentity, assertLinkedIn1135ReleaseFingerprint, BoundaryArgs } from './exact_browser_publication_1133_1132.service';

/** New exact package reuses the existing browser release/claim/start engine. */
export const LINKEDIN1135 = EXACT_BROWSER_PACKAGES.linkedin1135;
const p = LINKEDIN1135, prefix = 'linkedin_task1135_browser_submission';
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const actor = z.string().regex(/^user:[1-9]\d*$/), checksum = z.string().regex(/^[a-f0-9]{64}$/);
const scope = { projectId: z.literal(10), taskId: z.literal(1135), actorId: actor };
/** Exact, token-principal-bound owner release; reference does not claim provider verification. */
export const linkedin1135ReleaseSchema = z.object({ ...scope, expectedManifestChecksum: z.literal(p.manifest),
    expectedBodySha256: z.literal(p.bodySha256), expectedScheduleAt: z.literal(p.schedule),
    approvalReference: z.string().min(10).max(2000), duplicateCheckReference: z.string().min(10).max(2000),
    idempotencyKey: z.string().min(1).max(160) }).strict();
/** Claim scope; no release or new work can be manufactured through this command. */
export const linkedin1135ClaimSchema = z.object({ projectId: z.literal(10), actorId: actor,
    workItemId: z.number().int().positive(), leaseSeconds: z.number().int().min(30).max(1800).optional(),
    idempotencyKey: z.string().min(1).max(160) }).strict();
/** All provider mutation boundaries bind current copy, image and the same lease. */
export const linkedin1135BoundarySchema = z.object({ ...scope, channelId: z.literal(179),
    workItemId: z.number().int().positive(), leaseToken: z.string().min(1).max(500),
    approvalReference: z.string().min(10).max(2000), idempotencyKey: z.string().min(1).max(160),
    contentRevision: z.literal(2), textSha256: z.literal(p.bodySha256), selectedAssetId: z.literal(163),
    imageSha256: z.literal(p.assetSha256) }).strict();
const observed = { observedAuthorUrl: z.literal(p.targetProfileUrl), observedAccountType: z.literal('company_page'),
    observedTextSha256: z.literal(p.bodySha256), observedImageSha256: z.literal(p.assetSha256),
    attachedImageCount: z.literal(1), paragraphBlockSha256: z.array(checksum).min(2).max(100),
    duplicateAbsent: z.literal(true) };
/** Executor observations from the actual composer, immediately before Submit. */
export const linkedin1135PreSubmitSchema = linkedin1135BoundarySchema.extend({ ...observed,
    attemptId: z.number().int().positive(), evidenceSha256: checksum }).strict();
/** Public company-post readback must prove exact text blocks, original image and provider identity. */
export const linkedin1135ConfirmSchema = linkedin1135PreSubmitSchema.extend({ publicUrl: z.string().url(),
    providerObjectId: z.string().regex(/^urn:li:activity:[1-9]\d*$/),
    publishedAt: z.string().datetime({ offset: true }) }).strict();
/** Owner reconciliation records an existing object only; it does not renew or require a lost lease. */
export const linkedin1135ReconcileSchema = linkedin1135ConfirmSchema.omit({ leaseToken: true }).strict();
/** Bounded codes prevent raw browser/provider secrets from entering operational errors. */
export const linkedin1135UncertainSchema = linkedin1135BoundarySchema.extend({ attemptId: z.number().int().positive(),
    reasonCode: z.enum(['PROVIDER_RESULT_UNCERTAIN','PRE_SUBMIT_REJECTED','BROWSER_UNAVAILABLE']) }).strict();
/** Read-only scoped diagnosis; never exports a lease or token. */
export const linkedin1135DiagnoseSchema = z.object(scope).strict();
type Db = Prisma.TransactionClient;
type FactWriter = (args: RecordPublicationFactArgs) => Promise<unknown>;
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown> : {};
const boundary = (args: unknown): BoundaryArgs => ({ packageKey: 'linkedin1135', ...linkedin1135BoundarySchema.strip().parse(args) });

/** Ordered paragraph hashes preserve the visible block structure, not merely a flattened text checksum. */
export function linkedin1135Paragraphs(body: string): string[] {
    return body.split(/\n\s*\n/).map(block => sha(block.trim()));
}
/** Validate observations against the authoritative accepted caption, without storing copy or screenshots. */
export function assertLinkedIn1135Paragraphs(body: string, observedHashes: string[]): void {
    if (JSON.stringify(linkedin1135Paragraphs(body)) !== JSON.stringify(observedHashes)) throw new Error('[LINKEDIN1135_PARAGRAPH_MISMATCH]');
}
async function owner(tx: Pick<Db, 'projectMember'>, actorId: string): Promise<void> {
    const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: Number(actorId.slice(5)) } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
}
async function pendingAttempt(tx: Pick<Db,'deliveryAttempt'>, args: { attemptId: number; idempotencyKey: string }) {
    const attempt = await tx.deliveryAttempt.findFirst({ where: { id: args.attemptId, project_id: 10,
        content_item_id: 1135, channel_id: 179, idempotency_key: args.idempotencyKey, status: 'pending' } });
    if (!attempt || await tx.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1135 } }) !== 1) {
        throw new Error('[LINKEDIN1135_RECONCILIATION_REQUIRED]');
    }
    return attempt;
}
/** Owner release preserves the existing engine, identity and immutable content/visual records. */
export async function releaseLinkedIn1135(input: z.input<typeof linkedin1135ReleaseSchema>,
    dependencies?: Parameters<typeof releaseExactBrowserTask>[2]) {
    return releaseExactBrowserTask('linkedin1135', linkedin1135ReleaseSchema.parse(input), dependencies);
}
/** Same fenced WI lease model, but audit stores only its fingerprint, never a reusable token. */
export async function claimLinkedIn1135(input: z.input<typeof linkedin1135ClaimSchema>, database = prisma) {
    const args = linkedin1135ClaimSchema.parse(input), requestHash = sha(JSON.stringify(args));
    return database.$transaction(async tx => {
        await owner(tx, args.actorId);
        const task = await loadTask(tx, p); assertPackage(task, p, ['browser_required'], true);
        if (await tx.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1135 } })) throw new Error('[LINKEDIN1135_RECONCILIATION_REQUIRED]');
        const work = await tx.workItem.findFirst({ where: { id: args.workItemId, project_id: 10,
            content_item_id: 1135, kind: 'browser_publish', assignee_role: 'browser_publisher', input_context_version: 2 } });
        if (!work) throw new Error('[EXACT_BROWSER_WORK_ITEM_REQUIRED]');
        const key = { project_id_actor_id_command_idempotency_key: { project_id: 10, actor_id: args.actorId,
            command: 'ba_claim_linkedin_task1135_browser_publication', idempotency_key: args.idempotencyKey } };
        const prior = await tx.workflowEvent.findUnique({ where: key });
        const now = new Date();
        if (prior) {
            if (record(prior.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            if (work.state !== 'claimed' || work.lease_actor_id !== args.actorId || !work.lease_token
                || !work.lease_expires_at || work.lease_expires_at <= now) throw new Error('[EXACT_BROWSER_ACTIVE_LEASE_REQUIRED]');
            return { work_item: { id: work.id, state: work.state }, lease_token: work.lease_token,
                lease_expires_at: work.lease_expires_at.toISOString(), replayed: true };
        }
        const lease = `lease-${randomUUID()}`, expiry = new Date(now.getTime() + (args.leaseSeconds || 900) * 1000);
        const changed = await tx.workItem.updateMany({ where: { id: work.id, project_id: 10, content_item_id: 1135,
            OR: [{ state: 'available' }, { state: 'claimed', lease_expires_at: { lt: now } }] },
        data: { state: 'claimed', lease_actor_id: args.actorId, lease_token: lease, lease_expires_at: expiry } });
        if (changed.count !== 1) throw new Error('[WORK_ITEM_ALREADY_CLAIMED]');
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1135, work_item_id: work.id,
            actor_id: args.actorId, command: 'ba_claim_linkedin_task1135_browser_publication', idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, state: work.state }, after_state: { state: 'claimed', lease_sha256: sha(lease), lease_expires_at: expiry.toISOString() } } });
        return { work_item: { id: work.id, state: 'claimed' }, lease_token: lease, lease_expires_at: expiry.toISOString(), replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
/** Existing serializable start records one durable attempt before any provider mutation. */
export async function startLinkedIn1135(input: z.input<typeof linkedin1135BoundarySchema>, database = prisma) {
    return startExactBrowserSubmission(boundary(input), database);
}
/** Record the actual company composer/text-block/image check; no external operation. */
export async function preSubmitLinkedIn1135(input: z.input<typeof linkedin1135PreSubmitSchema>, database = prisma) {
    const args = linkedin1135PreSubmitSchema.parse(input);
    return database.$transaction(async tx => {
        const checked = await checkedBoundary(tx, boundary(args), ['publishing']);
        await pendingAttempt(tx, args); assertLinkedIn1135Paragraphs(checked.task.draft_text!, args.paragraphBlockSha256);
        const proof = { attempt_id: args.attemptId, work_item_id: args.workItemId, author_url: args.observedAuthorUrl,
            paragraph_blocks_sha256: sha(JSON.stringify(args.paragraphBlockSha256)), image_sha256: p.assetSha256,
            lease_sha256: sha(args.leaseToken), evidence_sha256: args.evidenceSha256, submit_authorized: true };
        const key = { project_id_actor_id_command_idempotency_key: { project_id: 10, actor_id: args.actorId,
            command: `ba_pre_submit_${prefix}`, idempotency_key: args.idempotencyKey } };
        const prior = await tx.workflowEvent.findUnique({ where: key });
        if (prior) {
            if (!Object.entries(proof).every(([key, value]) => record(prior.after_state)[key] === value)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...proof, audit_id: prior.id, replayed: true };
        }
        const event = await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1135,
            work_item_id: args.workItemId, actor_id: args.actorId, command: `ba_pre_submit_${prefix}`,
            idempotency_key: args.idempotencyKey, before_state: { delivery_attempt_id: args.attemptId }, after_state: proof } });
        return { ...proof, audit_id: event.id, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type ConfirmInput = z.input<typeof linkedin1135ConfirmSchema>;
type ReconcileInput = z.input<typeof linkedin1135ReconcileSchema>;
async function confirm(input: ConfirmInput | ReconcileInput, reconcile: boolean, database: typeof prisma, recordFact: FactWriter) {
    const args = reconcile ? linkedin1135ReconcileSchema.parse(input) : linkedin1135ConfirmSchema.parse(input);
    const identity = validateProviderIdentity('linkedin', args.publicUrl, args.providerObjectId, args.publishedAt);
    await owner(database, args.actorId);
    const priorFact = await database.publicationFact.findUnique({ where: { content_item_id: 1135 } });
    if (priorFact) {
        const attempt = await database.deliveryAttempt.findFirst({ where: { id: args.attemptId, project_id: 10,
            content_item_id: 1135, status: 'delivered', idempotency_key: args.idempotencyKey } });
        if (!attempt || priorFact.project_id !== 10 || priorFact.channel_id !== 179
            || priorFact.public_url !== identity.publicUrl || priorFact.provider_object_id !== identity.providerObjectId
            || priorFact.published_at?.toISOString() !== identity.publishedAt
            || priorFact.evidence_ref !== `sha256:${args.evidenceSha256}`) throw new Error('[IDEMPOTENCY_CONFLICT]');
        return { publication_fact: { id: priorFact.id, public_url: priorFact.public_url },
            public_url: priorFact.public_url, provider_object_id: priorFact.provider_object_id, retry_allowed: false, replayed: true };
    }
    const check = async (tx: Db): Promise<void> => {
        await owner(tx, args.actorId);
        const existingFact = await tx.publicationFact.findUnique({ where: { content_item_id: 1135 } });
        if (existingFact) throw new Error('[LINKEDIN1135_FACT_EXISTS_RECONCILE_READ_ONLY]');
        const task = await loadTask(tx, p); assertPackage(task, p, ['publishing'], true);
        assertLinkedIn1135Paragraphs(task!.draft_text!, args.paragraphBlockSha256);
        const work = await tx.workItem.findFirst({ where: { id: args.workItemId, project_id: 10, content_item_id: 1135,
            kind: 'browser_publish', assignee_role: 'browser_publisher', input_context_version: 2 } });
        const proof = record(work?.result_payload), ownerProof = record(record(task!.quality_report).owner_release);
        assertLinkedIn1135ReleaseFingerprint(task!, proof, ownerProof);
        if (!work || proof.publication_authorized !== true || ownerProof.publication_authorized !== true
            || proof.approval_reference !== args.approvalReference || ownerProof.approval_reference !== args.approvalReference
            || proof.body_sha256 !== p.bodySha256 || proof.asset_sha256 !== p.assetSha256
            || ownerProof.body_sha256 !== p.bodySha256 || ownerProof.asset_sha256 !== p.assetSha256
            || proof.target_profile_url !== p.targetProfileUrl || ownerProof.target_profile_url !== p.targetProfileUrl) {
            throw new Error('[EXACT_BROWSER_RELEASE_PROOF_INVALID]');
        }
        await pendingAttempt(tx, args);
        if (!reconcile) {
            await checkedBoundary(tx, boundary(input), ['publishing']);
            const pre = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1135,
                work_item_id: args.workItemId, actor_id: args.actorId,
                command: `ba_pre_submit_${prefix}`, idempotency_key: args.idempotencyKey } });
            if (record(pre?.after_state).lease_sha256 !== sha(linkedin1135ConfirmSchema.parse(input).leaseToken)
                || record(pre?.after_state).attempt_id !== args.attemptId
                || record(pre?.after_state).paragraph_blocks_sha256 !== sha(JSON.stringify(args.paragraphBlockSha256))) {
                throw new Error('[LINKEDIN1135_PRE_SUBMIT_REQUIRED]');
            }
        }
    };
    // Guard again inside the fact transaction; no state gap between confirmation and audit/attempt completion.
    const fact = await recordFact({ projectId: 10, taskId: 1135, actorId: args.actorId, artifactKind: 'post',
        browserWorkItemId: args.workItemId,
        outcome: 'published', publishedAt: identity.publishedAt, publicUrl: identity.publicUrl,
        providerObjectId: identity.providerObjectId, confirmationMode: reconcile ? 'reconciled' : 'automatic',
        evidence: { type: 'screenshot', ref: `sha256:${args.evidenceSha256}` }, utmStatus: 'not_applicable',
        beforeWrite: async tx => {
            await check(tx);
            const changed = await tx.deliveryAttempt.updateMany({ where: { id: args.attemptId, project_id: 10,
                content_item_id: 1135, channel_id: 179, status: 'pending', idempotency_key: args.idempotencyKey },
            data: { status: 'delivered', actual_published_at: new Date(identity.publishedAt), requires_manual_confirmation: false, error_message: null } });
            if (changed.count !== 1) throw new Error('[LINKEDIN1135_CONFIRM_CAS_CONFLICT]');
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1135, work_item_id: args.workItemId,
                actor_id: args.actorId, command: `ba_${reconcile ? 'reconcile' : 'confirm'}_${prefix}`,
                idempotency_key: `${args.idempotencyKey}:${reconcile ? 'reconcile' : 'confirm'}`,
                before_state: { delivery_attempt_id: args.attemptId }, after_state: { public_url: identity.publicUrl,
                    provider_object_id: identity.providerObjectId, status: 'delivered', evidence_sha256: args.evidenceSha256 } } });
        } });
    return { ...record(fact), public_url: identity.publicUrl, provider_object_id: identity.providerObjectId, retry_allowed: false };
}
/** Atomic fact/attempt/audit completion after exact observed company readback and pre-submit proof. */
export async function confirmLinkedIn1135(input: ConfirmInput, database = prisma,
    recordFact: FactWriter = args => publicationFactService.record(args)) {
    return confirm(input, false, database, recordFact);
}
/** Owner-only recovery of an already existing public object; never grants another submission. */
export async function reconcileLinkedIn1135(input: ReconcileInput, database = prisma,
    recordFact: FactWriter = args => publicationFactService.record(args)) {
    return confirm(input, true, database, recordFact);
}
/** Freeze the existing attempt with a bounded reason; even expired leases cannot authorize resend. */
export async function markLinkedIn1135Uncertain(input: z.input<typeof linkedin1135UncertainSchema>, database = prisma) {
    const args = linkedin1135UncertainSchema.parse(input);
    return database.$transaction(async tx => {
        await owner(tx, args.actorId); await checkedBoundary(tx, boundary(args), ['publishing']); await pendingAttempt(tx, args);
        const key = { project_id_actor_id_command_idempotency_key: { project_id: 10, actor_id: args.actorId,
            command: `ba_mark_${prefix}_uncertain`, idempotency_key: `${args.idempotencyKey}:uncertain` } };
        const prior = await tx.workflowEvent.findUnique({ where: key });
        if (prior) {
            if (record(prior.after_state).reason_code !== args.reasonCode) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { attempt_id: args.attemptId, audit_id: prior.id, retry_allowed: false, state: 'reconciliation_required', replayed: true };
        }
        await tx.deliveryAttempt.updateMany({ where: { id: args.attemptId, project_id: 10, content_item_id: 1135,
            status: 'pending', idempotency_key: args.idempotencyKey },
        data: { requires_manual_confirmation: true, error_message: args.reasonCode } });
        const event = await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1135,
            work_item_id: args.workItemId, actor_id: args.actorId, command: `ba_mark_${prefix}_uncertain`,
            idempotency_key: `${args.idempotencyKey}:uncertain`, before_state: { attempt_id: args.attemptId },
            after_state: { retry_allowed: false, reason_code: args.reasonCode } } });
        return { attempt_id: args.attemptId, audit_id: event.id, retry_allowed: false, state: 'reconciliation_required' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
/** Safe production handoff/readback includes IDs and hashes, never credential or lease contents. */
export async function diagnoseLinkedIn1135(input: z.input<typeof linkedin1135DiagnoseSchema>, database = prisma) {
    const args = linkedin1135DiagnoseSchema.parse(input); await owner(database, args.actorId);
    const [task, attempts, work] = await Promise.all([database.$transaction(tx => loadTask(tx, p)),
        database.deliveryAttempt.findMany({ where: { project_id: 10, content_item_id: 1135 },
            select: { id: true, status: true, requires_manual_confirmation: true } }),
        database.workItem.findMany({ where: { project_id: 10, content_item_id: 1135, kind: 'browser_publish' },
            select: { id: true, state: true, input_context_version: true, lease_expires_at: true } })]);
    return { project_id: 10, task_id: 1135, channel_id: task?.channel_id, content_revision: task?.content_revision,
        accepted_revision: task?.accepted_revision, body_sha256: sha(task?.draft_text || ''), selected_asset_id: task?.selected_asset_id,
        image_sha256: record(record(task?.selected_asset?.provenance).planner_storage).sha256,
        paragraph_block_sha256: linkedin1135Paragraphs(task?.draft_text || ''), target_profile_url: p.targetProfileUrl,
        publication_mode: task?.publication_mode, status: task?.status, attempts, browser_work_items: work,
        publication_fact: task?.publication_fact ? { id: task.publication_fact.id, public_url: task.publication_fact.public_url,
            provider_object_id: task.publication_fact.provider_object_id, published_at: task.publication_fact.published_at } : null,
        retry_allowed: false, next_action: attempts.length ? 'reconcile_existing_attempt' : work.length ? 'claim_existing_work_item' : 'owner_release',
        mutates_state: false };
}
