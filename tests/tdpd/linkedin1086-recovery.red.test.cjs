'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, acceptRisk, scope, sha } = require('../fixtures/linkedin1086-recovery.cjs');

function feature() {
    const target = path.resolve(__dirname, '../../src/services/linkedin1086_recovery_decision.ts');
    assert.ok(fs.existsSync(target), 'LI1086-RECOVERY-RED: same-attempt recovery decision seam is absent');
    const ts = require('typescript'), exports = {};
    const code = ts.transpileModule(fs.readFileSync(target, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const sandbox = { exports, module: { exports }, require(name) {
        assert.equal(name, 'node:crypto', `Pure assessment cannot load ${name}`);
        return require('node:crypto');
    } };
    vm.runInNewContext(code, sandbox, { timeout: 1000, filename: target });
    assert.equal(typeof sandbox.module.exports.assessLinkedIn1086Recovery, 'function');
    return input => JSON.parse(JSON.stringify(sandbox.module.exports.assessLinkedIn1086Recovery(input)));
}
function blocked(result, code) {
    assert.equal(result.mode, 'blocked'); assert.equal(result.code, code);
    assert.equal(result.submissionPermitted, false);
}
test('LI1086-R00 synthetic fixture/runner work, owner observation is not provider proof', () => {
    const f = fixture(); assert.equal(f.current.attemptId, 41);
    assert.equal(f.ownerObservation.providerVerified, false);
    assert.match(sha(JSON.stringify(scope)), /^[a-f0-9]{64}$/);
});
test('LI1086-R01 owner absence and Dovodi do not replace exact duplicate-risk acceptance', () => {
    const assess = feature();
    for (const acceptance of [null, { verdict: 'publication_GO' }, { verdict: 'Доводи' }]) {
        const f = fixture(); f.riskAcceptance = acceptance;
        blocked(assess(f), 'LI1086_EXPLICIT_DUPLICATE_RISK_ACCEPTANCE_REQUIRED');
    }
    for (const change of [f => { delete f.riskAcceptance.humanMessageSha256; },
        f => { f.riskAcceptance.humanMessageSha256 = 'invalid'; },
        f => { f.riskAcceptance.humanMessageRef = ''; },
        f => { f.riskAcceptance.packetId = 'OTHER'; },
        f => { f.riskAcceptance.source = 'provider_certificate'; },
        f => { f.riskAcceptance.serverHumanMessageVerification = true; }]) {
        const f = acceptRisk(fixture()); change(f);
        blocked(assess(f), 'LI1086_EXPLICIT_DUPLICATE_RISK_ACCEPTANCE_REQUIRED');
    }
});
test('LI1086-R02 optionA returns only review plan, preserving unknown inflight and exact attempt/WI/key', () => {
    const assess = feature(), f = acceptRisk(fixture()), before = JSON.stringify(f);
    const result = assess(f);
    assert.equal(result.mode, 'recovery_review_ready'); assert.equal(result.submissionPermitted, false);
    assert.equal(result.attemptId, 41); assert.equal(result.workItemId, 1946);
    assert.equal(result.recoveryGeneration, 1);
    assert.equal(result.publicationKeySha256, scope.publicationKeySha256);
    assert.equal(result.originalExecutor, 'not_identifiable');
    assert.equal(result.providerInflight, 'not_excluded'); assert.equal(result.duplicateRisk, 'residual_accepted');
    assert.equal(result.providerVerified, false); assert.equal(JSON.stringify(f), before);
    assert.equal(result.newAttemptAllowed, false); assert.equal(result.newWorkItemAllowed, false);
});
test('LI1086-R03 exact identity/package/date/fence/key mismatches fail closed', () => {
    const assess = feature();
    for (const key of Object.keys(scope)) {
        const f = acceptRisk(fixture()), value = f.current[key];
        f.current[key] = typeof value === 'number' ? value + 1 : `${value}-changed`;
        blocked(assess(f), 'LI1086_RECOVERY_SNAPSHOT_CHANGED');
    }
    for (const change of [f => { f.current.selectedAssetId = 1; }, f => { f.current.decisionId = 250; },
        f => { f.current.visualState = 'APPROVED'; }, f => { f.current.manifestChecksum = `sha256:${sha('other')}`; }]) {
        const f = acceptRisk(fixture()); change(f); blocked(assess(f), 'LI1086_RECOVERY_SNAPSHOT_CHANGED');
    }
});
test('LI1086-R04 foreign owner or acceptance actor/scope cannot recover', () => {
    const assess = feature();
    for (const change of [f => { f.current.role = 'editor'; }, f => { f.current.ownerUserId = 3; },
        f => { f.riskAcceptance.actorId = 'user:3'; }, f => { f.riskAcceptance.scopeSha256 = sha('other scope'); }]) {
        const f = acceptRisk(fixture()); change(f); blocked(assess(f), 'LI1086_RECOVERY_OWNER_OR_VERDICT_MISMATCH');
    }
});
test('LI1086-R05 known active publisher/composer or contradictory provider evidence overrides risk acceptance', () => {
    const assess = feature();
    for (const change of [f => { f.localEvidence.knownConcurrentPublisher = true; },
        f => { f.localEvidence.composer = 'present'; },
        f => { f.current.contradictoryProviderEvidence = true; }]) {
        const f = acceptRisk(fixture()); change(f); blocked(assess(f), 'LI1086_ACTIVE_OR_CONTRADICTORY_EXECUTION');
    }
});
test('LI1086-R06 fact/permit/recovery/unknown/multiple attempts prevent any second generation or permit', () => {
    const assess = feature();
    for (const change of [f => { f.current.factId = 1; }, f => { f.current.permitCount = 1; },
        f => { f.current.recoveryCount = 1; }, f => { f.current.attemptStatus = 'verification_required'; },
        f => { f.current.attemptCount = 2; }, f => { f.request.recoveryGeneration = 2; }]) {
        const f = acceptRisk(fixture()); change(f); blocked(assess(f), 'LI1086_RECONCILIATION_ONLY');
    }
});
test('LI1086-R07 prepare-normalized browser_required is not permission; same publishing state remains assessable', () => {
    const assess = feature();
    for (const status of ['browser_required', 'publishing']) {
        const f = acceptRisk(fixture()); f.current.status = status;
        const r = assess(f); assert.equal(r.mode, 'recovery_review_ready'); assert.equal(r.submissionPermitted, false);
    }
    const f = acceptRisk(fixture()); f.current.status = 'available';
    blocked(assess(f), 'LI1086_RECOVERY_SNAPSHOT_CHANGED');
});
test('LI1086-R08 no certificate/no-send claims are fabricated; incomplete observation input blocks', () => {
    const assess = feature();
    for (const change of [f => { f.ownerObservation.providerVerified = true; },
        f => { f.localEvidence.providerInflight = 'terminated'; }, f => { f.ownerObservation = null; },
        f => { f.localEvidence.reference = ''; }]) {
        const f = acceptRisk(fixture()); change(f); blocked(assess(f), 'LI1086_RECOVERY_EVIDENCE_INVALID');
    }
});
test('LI1086-R09 no mutation, raw secret, lease, provider ID or submit token leaves pure assessment', () => {
    const assess = feature(), f = acceptRisk(fixture());
    f.request.leaseToken = 'SYNTHETIC_SECRET';
    const invalid = assess(f);
    blocked(invalid, 'LI1086_RECOVERY_INPUT_INVALID');
    assert.equal(JSON.stringify(invalid).includes('SYNTHETIC_SECRET'), false);
    assert.equal(invalid.leaseToken, undefined); assert.equal(invalid.rawInput, undefined);
    const r = assess(acceptRisk(fixture())), serialized = JSON.stringify(r);
    assert.equal(serialized.includes('SYNTHETIC_SECRET'), false);
    for (const key of ['leaseToken', 'providerObjectId', 'publicUrl', 'submitToken']) assert.equal(r[key], undefined);
    for (const input of [null, {}, { request: 'SYNTHETIC_SECRET' }]) {
        const result = assess(input); blocked(result, 'LI1086_RECOVERY_INPUT_INVALID');
        assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false);
        assert.equal(result.rawInput, undefined); assert.equal(result.leaseToken, undefined);
    }
});
