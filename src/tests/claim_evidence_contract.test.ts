import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClaimEvidence } from '../services/claim_evidence_contract';

const revision = 3;

test('verified result requires revision-bound verified production evidence', () => {
    const aligned = evaluateClaimEvidence({
        claimStage: 'verified_result', evidenceStatus: 'verified',
        evidenceRefs: [{ type: 'reproducible_test', ref: 'test://release-readback', contentRevision: revision }]
    }, revision);
    assert.equal(aligned.alignment_status, 'aligned');
    assert.deepEqual(aligned.issue_codes, []);

    const missing = evaluateClaimEvidence({
        claimStage: 'verified_result', evidenceStatus: 'missing', evidenceRefs: []
    }, revision);
    assert.equal(missing.alignment_status, 'revise');
    assert.ok(missing.issue_codes.includes('VERIFIED_RESULT_EVIDENCE_REQUIRED'));
});

test('idea and hypothesis do not require production-result evidence', () => {
    for (const claimStage of ['idea', 'hypothesis'] as const) {
        const result = evaluateClaimEvidence({
            claimStage, evidenceStatus: 'not_required', evidenceRefs: []
        }, revision);
        assert.equal(result.alignment_status, 'aligned');
    }
});

test('headline cannot claim a stronger lifecycle stage than the body', () => {
    const result = evaluateClaimEvidence({
        claimStage: 'hypothesis', headlineStage: 'verified_result',
        evidenceStatus: 'not_required', evidenceRefs: []
    }, revision);
    assert.equal(result.alignment_status, 'revise');
    assert.ok(result.issue_codes.includes('HEADLINE_EXCEEDS_EVIDENCE'));
});

test('mockups and AI demos cannot prove a production outcome', () => {
    for (const type of ['mockup', 'prototype', 'presentation', 'ai_generated_demo'] as const) {
        const result = evaluateClaimEvidence({
            claimStage: 'verified_result', evidenceStatus: 'verified',
            evidenceRefs: [{ type, ref: `artifact://${type}`, contentRevision: revision }]
        }, revision);
        assert.equal(result.alignment_status, 'revise');
        assert.ok(result.issue_codes.includes('NON_PRODUCTION_ARTIFACT'));
    }
});

test('evidence from another content revision is stale', () => {
    const result = evaluateClaimEvidence({
        claimStage: 'verified_result', evidenceStatus: 'verified',
        evidenceRefs: [{ type: 'publication_fact', ref: 'fact://42', contentRevision: revision - 1 }]
    }, revision);
    assert.equal(result.alignment_status, 'revise');
    assert.ok(result.issue_codes.includes('STALE_CLAIM_EVIDENCE'));
});

test('metric claims require a period and comparator', () => {
    const result = evaluateClaimEvidence({
        claimStage: 'verified_result', evidenceStatus: 'verified',
        evidenceRefs: [{ type: 'metric', ref: 'metric://save-rate', contentRevision: revision,
            metric: { period: '2026-W39' } }]
    }, revision);
    assert.equal(result.alignment_status, 'revise');
    assert.ok(result.issue_codes.includes('INCOMPLETE_METRIC_EVIDENCE'));
});

test('organization research evidence keeps safe source provenance inside content review', () => {
    const aligned = evaluateClaimEvidence({
        claimStage: 'verified_result', evidenceStatus: 'verified',
        evidenceRefs: [{
            type: 'external_source_signal', ref: 'signal://42', contentRevision: revision,
            source: {
                signalId: 42,
                sourceType: 'indie_hackers',
                canonicalUrl: 'https://www.indiehackers.com/post/example',
                snapshotHash: 'a'.repeat(64),
                observedAt: '2026-10-01T10:00:00.000Z',
                accessClass: 'authenticated_read',
                cookies: 'must-not-survive-review-boundary'
            } as never
        }]
    }, revision);

    assert.equal(aligned.alignment_status, 'aligned');
    assert.equal(aligned.evidence_refs[0].source?.accessClass, 'authenticated_read');
    assert.equal('cookies' in (aligned.evidence_refs[0].source || {}), false);
});

test('external research evidence without canonical provenance cannot approve a result claim', () => {
    const result = evaluateClaimEvidence({
        claimStage: 'verified_result', evidenceStatus: 'verified',
        evidenceRefs: [{
            type: 'external_source_signal', ref: 'signal://42', contentRevision: revision,
            source: {
                sourceType: 'reddit', canonicalUrl: '', snapshotHash: '',
                observedAt: '', accessClass: 'authenticated_read'
            }
        }]
    }, revision);

    assert.equal(result.alignment_status, 'revise');
    assert.ok(result.issue_codes.includes('INCOMPLETE_SOURCE_PROVENANCE'));
});
