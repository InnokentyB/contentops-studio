'use strict';
const { createHash } = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const scope = { projectId: 7, taskId: 1086, channelId: 5, attemptId: 41, workItemId: 1946,
    actorId: 'user:2', contentRevision: 1, acceptedRevision: 1,
    bodySha256: '52da1d66f2c06e3b953ac41f7e132a6a34ff6d83b4817edf9603fdcb8d9d865b',
    profileUrl: 'https://www.linkedin.com/in/innokentyb/',
    scheduleAt: '2026-10-15T09:00:00.000Z', publishAt: '2026-10-15T09:00:00.000Z',
    publicationKeySha256: '9e4d4844b592c26cd54d7f0535114830bbf512c83db59eb457791fbd12b2a8a1',
    oldLeaseSha256: 'daca078ba671310142569e4e6aa07811e8a86b3b8bb612959a55560ea0c2ac37',
    oldLeaseExpiresAt: '2026-10-15T20:48:48.260Z' };
function fixture() {
    return { now: '2026-10-16T19:00:00.000Z', request: { ...scope, recoveryGeneration: 1 },
        current: { ...scope, ownerUserId: 2, role: 'owner', status: 'browser_required',
            attemptCount: 1, attemptStatus: 'pending', workState: 'claimed', leaseActorId: 'user:2',
            decisionId: 249, visualState: 'NO_VISUAL_NEEDED', selectedAssetId: null,
            manifestChecksum: 'sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd',
            factId: null, permitCount: 0, recoveryCount: 0, contradictoryProviderEvidence: false },
        localEvidence: { composer: 'absent', originalExecutor: 'not_identifiable',
            knownConcurrentPublisher: false, providerInflight: 'not_excluded', source: 'ops_report',
            reference: 'fixture-ops-observation' },
        ownerObservation: { kind: 'owner_observed_absence', reference: 'fixture-owner-observation',
            providerVerified: false, capturedAt: null },
        riskAcceptance: null };
}
function acceptRisk(f) {
    f.riskAcceptance = { verdict: 'accept_residual_duplicate_risk_once', actorId: 'user:2',
        scopeSha256: sha(JSON.stringify(scope)), packetId: 'LINKEDIN1086-RECOVERY-001-A',
        humanMessageRef: 'fixture-explicit-human-answer', source: 'operator_reported_human_reply',
        humanMessageSha256: sha('fixture explicit acceptance of residual duplicate risk for same attempt41'),
        serverHumanMessageVerification: false };
    return f;
}
module.exports = { fixture, acceptRisk, scope, sha };
