import { createHash } from 'node:crypto';

export const RECOVERY1086_SCOPE = {
    projectId: 7, taskId: 1086, channelId: 5, attemptId: 41, workItemId: 1946,
    actorId: 'user:2', contentRevision: 1, acceptedRevision: 1,
    bodySha256: '52da1d66f2c06e3b953ac41f7e132a6a34ff6d83b4817edf9603fdcb8d9d865b',
    profileUrl: 'https://www.linkedin.com/in/innokentyb/',
    scheduleAt: '2026-10-15T09:00:00.000Z', publishAt: '2026-10-15T09:00:00.000Z',
    publicationKeySha256: '9e4d4844b592c26cd54d7f0535114830bbf512c83db59eb457791fbd12b2a8a1',
    oldLeaseSha256: 'daca078ba671310142569e4e6aa07811e8a86b3b8bb612959a55560ea0c2ac37',
    oldLeaseExpiresAt: '2026-10-15T20:48:48.260Z'
} as const;
type ObjectValue = Record<string, unknown>;
export type Recovery1086Scope = { [K in keyof typeof RECOVERY1086_SCOPE]: typeof RECOVERY1086_SCOPE[K] extends number ? number : string };
function obj(v: unknown): ObjectValue {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : {};
}
function hash(s: string): string { return createHash('sha256').update(s).digest('hex'); }
function text(v: unknown, max = 500): v is string { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function failure(code: string): ObjectValue { return { mode: 'blocked', code, submissionPermitted: false }; }

/** Pure operator assessment only; trusted expected scope comes from retained server audit, never public JSON. */
export function assessLinkedIn1086Recovery(input: unknown, expected: Recovery1086Scope = RECOVERY1086_SCOPE): ObjectValue {
    const f = obj(input), r = obj(f.request), c = obj(f.current), a = obj(f.riskAcceptance);
    const keys = [...Object.keys(expected), 'recoveryGeneration'];
    if (!text(f.now) || !Number.isFinite(Date.parse(f.now)) || Object.keys(r).length !== keys.length
        || Object.keys(r).some(k => !keys.includes(k)) || !Number.isSafeInteger(r.recoveryGeneration)) {
        return failure('LI1086_RECOVERY_INPUT_INVALID');
    }
    if (a.verdict !== 'accept_residual_duplicate_risk_once' || a.packetId !== 'LINKEDIN1086-RECOVERY-001-A'
        || a.source !== 'operator_reported_human_reply' || a.serverHumanMessageVerification !== false
        || !text(a.humanMessageRef) || typeof a.humanMessageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.humanMessageSha256)) {
        return failure('LI1086_EXPLICIT_DUPLICATE_RISK_ACCEPTANCE_REQUIRED');
    }
    if (c.role !== 'owner' || c.ownerUserId !== 2 || a.actorId !== expected.actorId
        || a.scopeSha256 !== hash(JSON.stringify(expected))) return failure('LI1086_RECOVERY_OWNER_OR_VERDICT_MISMATCH');
    if (Object.entries(expected).some(([k, v]) => c[k] !== v || r[k] !== v)
        || c.decisionId !== 249 || c.visualState !== 'NO_VISUAL_NEEDED' || c.selectedAssetId !== null
        || c.workState !== 'claimed' || c.leaseActorId !== expected.actorId
        || !['browser_required', 'publishing'].includes(String(c.status))
        || c.manifestChecksum !== 'sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd') {
        return failure('LI1086_RECOVERY_SNAPSHOT_CHANGED');
    }
    if (c.factId !== null || c.permitCount !== 0 || c.recoveryCount !== 0 || c.attemptCount !== 1
        || c.attemptStatus !== 'pending' || r.recoveryGeneration !== 1) return failure('LI1086_RECONCILIATION_ONLY');
    const e = obj(f.localEvidence), o = obj(f.ownerObservation);
    if (e.knownConcurrentPublisher === true || e.composer === 'present' || c.contradictoryProviderEvidence === true) {
        return failure('LI1086_ACTIVE_OR_CONTRADICTORY_EXECUTION');
    }
    if (e.composer !== 'absent' || e.originalExecutor !== 'not_identifiable' || e.knownConcurrentPublisher !== false
        || e.providerInflight !== 'not_excluded' || e.source !== 'ops_report' || !text(e.reference)
        || o.kind !== 'owner_observed_absence' || !text(o.reference) || o.providerVerified !== false || o.capturedAt !== null) {
        return failure('LI1086_RECOVERY_EVIDENCE_INVALID');
    }
    return { mode: 'recovery_review_ready', submissionPermitted: false, attemptId: 41, workItemId: 1946,
        recoveryGeneration: 1, publicationKeySha256: expected.publicationKeySha256, originalExecutor: 'not_identifiable',
        providerInflight: 'not_excluded', duplicateRisk: 'residual_accepted', providerVerified: false,
        newAttemptAllowed: false, newWorkItemAllowed: false };
}
