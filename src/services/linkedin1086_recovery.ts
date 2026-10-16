import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { claim1086Schema } from './linkedin1086_contract';
import { releasedWork1086, submissionObject as object, submissionHash as hash, submissionRequestHash } from './linkedin1086_guard';
import { assessLinkedIn1086Recovery, RECOVERY1086_SCOPE } from './linkedin1086_recovery_decision';
import { LI1086_HUMAN_REF, LI1086_RECOVERY_COMMAND, recovery1086Event } from './linkedin1086_recovery_fence';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const LI1086_VERDICT = 'Утверждаю, риск дубля принимаю';
const verdictSha = createHash('sha256').update(LI1086_VERDICT).digest('hex');
export const LI1086_APPROVAL_COMMAND = 'ba_record_linkedin_task1086_recovery_approval';
const riskSchema = z.object({ verdict: z.literal('accept_residual_duplicate_risk_once'), actorId: z.literal('user:2'),
    scopeSha256: sha, packetId: z.literal('LINKEDIN1086-RECOVERY-001-A'), humanMessageRef: z.literal(LI1086_HUMAN_REF),
    humanMessageSha256: z.literal(verdictSha), source: z.literal('operator_reported_human_reply'),
    serverHumanMessageVerification: z.literal(false) }).strict();
const evidenceSchema = z.object({ composer: z.literal('absent'), originalExecutor: z.literal('not_identifiable'),
    knownConcurrentPublisher: z.literal(false), providerInflight: z.literal('not_excluded'),
    source: z.literal('ops_report'), reference: z.string().trim().min(1).max(500) }).strict();
const observationSchema = z.object({ kind: z.literal('owner_observed_absence'), reference: z.string().trim().min(1).max(500),
    providerVerified: z.literal(false), capturedAt: z.null() }).strict();
export const recovery1086Schema = claim1086Schema.extend({ actorId: z.literal('user:2'), workItemId: z.literal(1946),
    attemptId: z.literal(41), apply: z.boolean().default(false), expectedExpiredLeaseSha256: sha,
    expectedExpiredLeaseAt: z.literal(RECOVERY1086_SCOPE.oldLeaseExpiresAt), riskAcceptance: riskSchema.optional(),
    localEvidence: evidenceSchema, ownerObservation: observationSchema }).strict();

/** Exact human message read in Portfolio OS, not a fabricated provider or human-verification certificate. */
export function recovery1086RiskAudit(scopeSha256: string): z.infer<typeof riskSchema> {
    return { verdict: 'accept_residual_duplicate_risk_once', actorId: 'user:2', scopeSha256,
        packetId: 'LINKEDIN1086-RECOVERY-001-A', humanMessageRef: LI1086_HUMAN_REF, humanMessageSha256: verdictSha,
        source: 'operator_reported_human_reply', serverHumanMessageVerification: false };
}

/** Owner-only same41 generation1 recovery. No browser call, new attempt, release or WI; replay never returns a lease. */
export async function recoverLinkedIn1086Attempt41(input: unknown, recordApprovalOnly = false): Promise<Record<string, unknown>> {
    const a = recovery1086Schema.parse(input), args = { ...a, leaseToken: '' };
    const requestHash = hash(JSON.stringify({ request: submissionRequestHash(args), risk: a.riskAcceptance,
        evidence: a.localEvidence, observation: a.ownerObservation, old: a.expectedExpiredLeaseSha256,
        expiry: a.expectedExpiredLeaseAt }));
    return prisma.$transaction(async tx => {
        const { task, work } = await releasedWork1086(tx, args);
        if (hash(a.idempotencyKey) !== RECOVERY1086_SCOPE.publicationKeySha256) throw new Error('[LINKEDIN1086_ORIGINAL_KEY_REQUIRED]');
        const prior = await recovery1086Event(tx, work.id);
        if (prior) {
            if (object(prior.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { mode: 'reconciliation_only', attempt_id: 41, work_item_id: 1946,
                recovery_generation: 1, submission_permitted: false, replayed: true, retry_allowed: false };
        }
        const [attempts, start, claim, permit] = await Promise.all([
            tx.deliveryAttempt.findMany({ where: { project_id: 7, content_item_id: 1086 } }),
            tx.workflowEvent.findFirst({ where: { id: 3265, project_id: 7, content_item_id: 1086, work_item_id: 1946,
                command: 'ba_start_linkedin_task1086_browser_submission', actor_id: a.actorId, idempotency_key: a.idempotencyKey } }),
            tx.workflowEvent.findFirst({ where: { id: 3264, project_id: 7, content_item_id: 1086, work_item_id: 1946,
                command: 'ba_claim_linkedin_task1086_browser', actor_id: a.actorId } }),
            tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086,
                command: { in: ['ba_pre_submit_linkedin_task1086_browser_submission',
                    'ba_confirm_linkedin_task1086_browser_submission', 'ba_reconcile_linkedin_task1086_browser_submission',
                    'ba_mark_linkedin_task1086_browser_submission_uncertain'] } } })
        ]);
        const attempt = attempts[0];
        if (!attempt || attempts.length !== 1 || attempt.id !== 41 || attempt.channel_id !== 5 || attempt.status !== 'pending'
            || attempt.idempotency_key !== a.idempotencyKey || attempt.actual_published_at || permit
            || object(start?.after_state).attempt_id !== 41 || object(start?.before_state).request_hash !== submissionRequestHash(args)
            || work.state !== 'claimed' || work.lease_actor_id !== a.actorId || !work.lease_token || !work.lease_expires_at
            || work.lease_expires_at.getTime() > Date.now()
            || work.lease_expires_at.toISOString() !== a.expectedExpiredLeaseAt
            || hash(work.lease_token) !== a.expectedExpiredLeaseSha256
            || object(claim?.after_state).lease_sha256 !== a.expectedExpiredLeaseSha256
            || object(claim?.after_state).lease_expires_at !== a.expectedExpiredLeaseAt) throw new Error('[LINKEDIN1086_RECOVERY_SNAPSHOT_CHANGED]');
        const scope = { ...RECOVERY1086_SCOPE, oldLeaseSha256: a.expectedExpiredLeaseSha256 };
        const scopeSha = hash(JSON.stringify(scope)), approvedRisk = recovery1086RiskAudit(scopeSha);
        const assessment = assessLinkedIn1086Recovery({ now: new Date().toISOString(), request: { ...scope, recoveryGeneration: 1 },
            current: { ...scope, ownerUserId: 2, role: 'owner', status: task.status, attemptCount: attempts.length,
                attemptStatus: attempt.status, workState: work.state, leaseActorId: work.lease_actor_id, decisionId: 249,
                visualState: task.visual_state, selectedAssetId: task.selected_asset_id, manifestChecksum: a.expectedManifestChecksum,
                factId: null, permitCount: 0, recoveryCount: 0, contradictoryProviderEvidence: false },
            riskAcceptance: a.riskAcceptance || approvedRisk, localEvidence: a.localEvidence, ownerObservation: a.ownerObservation }, scope);
        if (assessment.mode !== 'recovery_review_ready') throw new Error('[LINKEDIN1086_RECOVERY_ASSESSMENT_FAILED]');
        if (!a.apply) return { mode: 'preview', attempt_id: 41, work_item_id: 1946, recovery_generation: 1,
            submission_permitted: false, risk_acceptance_audit: approvedRisk, duplicate_risk: 'residual_not_excluded',
            owner_verdict: LI1086_VERDICT, known_concurrent_execution_allowed: false };
        if (!a.riskAcceptance || !isDeepStrictEqual(a.riskAcceptance, approvedRisk)) throw new Error('[LINKEDIN1086_EXACT_HUMAN_VERDICT_REQUIRED]');
        const approval = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086,
            work_item_id: 1946, actor_id: a.actorId, command: LI1086_APPROVAL_COMMAND, idempotency_key: 'attempt41-generation1' } });
        if (approval && !isDeepStrictEqual(object(approval.after_state).risk_acceptance, approvedRisk)) {
            throw new Error('[LINKEDIN1086_EXACT_HUMAN_VERDICT_REQUIRED]');
        }
        if (approval && object(approval.before_state).request_hash !== requestHash) {
            throw new Error('[LINKEDIN1086_APPROVAL_PACKET_MISMATCH]');
        }
        if (recordApprovalOnly) {
            if (!approval) await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1086, work_item_id: 1946,
                actor_id: a.actorId, command: LI1086_APPROVAL_COMMAND, idempotency_key: 'attempt41-generation1',
                before_state: { request_hash: requestHash }, after_state: { risk_acceptance: approvedRisk,
                    owner_verdict_text: LI1086_VERDICT, question_reference: 'call_ad92d90550aa4f6eb7603909fdfdaf8f',
                    attempt_id: 41, recovery_generation: 1, submission_permitted: false } } });
            return { mode: 'owner_risk_approval_recorded', attempt_id: 41, work_item_id: 1946,
                submission_permitted: false, replayed: Boolean(approval) };
        }
        if (!approval) throw new Error('[LINKEDIN1086_AUDITED_RISK_APPROVAL_REQUIRED]');
        const now = new Date(), token = `lease-${randomUUID()}`, expires = new Date(now.getTime() + 300_000);
        const taskCas = await tx.contentItem.updateMany({ where: { id: 1086, project_id: 7, channel_id: 5,
            updated_at: task.updated_at, status: task.status, publication_mode: 'browser_required' }, data: { status: 'publishing' } });
        const workCas = await tx.workItem.updateMany({ where: { id: 1946, project_id: 7, content_item_id: 1086,
            state: 'claimed', lease_actor_id: a.actorId, lease_token: work.lease_token, lease_expires_at: work.lease_expires_at,
            updated_at: work.updated_at }, data: { lease_token: token, lease_expires_at: expires } });
        const attemptCas = await tx.deliveryAttempt.updateMany({ where: { id: 41, project_id: 7, content_item_id: 1086,
            channel_id: 5, status: 'pending', idempotency_key: a.idempotencyKey, updated_at: attempt.updated_at },
        data: { requires_manual_confirmation: true } });
        if (taskCas.count !== 1 || workCas.count !== 1 || attemptCas.count !== 1) throw new Error('[LINKEDIN1086_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1086, work_item_id: 1946,
            actor_id: a.actorId, command: LI1086_RECOVERY_COMMAND, idempotency_key: 'attempt41-generation1',
            before_state: { request_hash: requestHash, old_lease_sha256: a.expectedExpiredLeaseSha256,
                old_expiry: a.expectedExpiredLeaseAt, release_event_id: 3263, claim_event_id: 3264, start_event_id: 3265,
                old_start_before_sha256: hash(JSON.stringify(start?.before_state ?? null)), old_start_after_sha256: hash(JSON.stringify(start?.after_state ?? null)) },
            after_state: { attempt_id: 41, recovery_generation: 1, lease_sha256: hash(token), lease_expires_at: expires.toISOString(),
                publication_key_sha256: hash(a.idempotencyKey), submission_permitted: false, owner_verdict_text: LI1086_VERDICT,
                risk_acceptance: approvedRisk, local_evidence: a.localEvidence, owner_observation: a.ownerObservation,
                original_executor: 'not_identifiable', provider_inflight: 'not_excluded', server_provider_verification: false } } });
        return { mode: 'recovery_prepared', attempt_id: 41, work_item_id: 1946, recovery_generation: 1,
            lease_token: token, lease_expires_at: expires.toISOString(), submission_permitted: false, retry_allowed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
