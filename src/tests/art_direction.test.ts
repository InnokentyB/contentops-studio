import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ART_DIRECTION_DECISIONS,
    calculateVisualReadiness,
    defaultVisualMode,
    validateArtDirectionDecision
} from '../services/art_direction.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const baseDecision = {
    decision: 'GENERATE' as const,
    source_content_revision: 3,
    channel: 'dzen',
    placement: 'article_cover',
    visual_function: 'explain',
    reason: 'A diagram makes the sequence understandable.',
    post_owns: 'The post describes the process.',
    visual_adds: 'The visual exposes the order and handoffs.',
    loss_without_visual: 'Readers lose the sequence.',
    authenticity_class: 'CONCEPTUAL_EDITORIAL' as const,
    evidence_refs: [],
    visual_format: 'diagram',
    dimensions: { width: 1200, height: 630, aspect_ratio: '1.91:1' },
    required_text: [],
    forbidden_text: [],
    visible_copy_budget: 12,
    prompt: 'Editorial process diagram',
    alt_text: 'A diagram showing the editorial process.',
    acceptance_criteria: ['Sequence is readable'],
    recent_asset_refs: []
};

test('A: no-visual is a positive ready state and does not require generation', () => {
    const decision = validateArtDirectionDecision({
        ...baseDecision,
        decision: 'NO_VISUAL_NEEDED',
        loss_without_visual: '',
        prompt: null
    }, 'auto_assess');
    assert.equal(decision.decision, 'NO_VISUAL_NEEDED');
    assert.deepEqual(calculateVisualReadiness({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 3,
        contentRevision: 3,
        visualMode: 'auto_assess',
        visualState: 'NO_VISUAL_NEEDED'
    }), { ready: true, reason: null });
});

test('B: generated is not publication-ready until visual review approves an asset', () => {
    assert.equal(calculateVisualReadiness({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 3,
        contentRevision: 3,
        visualMode: 'required',
        visualState: 'GENERATED'
    }).ready, false);
    assert.equal(calculateVisualReadiness({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 3,
        contentRevision: 3,
        visualMode: 'required',
        visualState: 'APPROVED',
        selectedAssetRevision: 3
    }).ready, true);
});

test('C: evidence visuals without evidence refs require a source instead of generation', () => {
    assert.throws(() => validateArtDirectionDecision({
        ...baseDecision,
        authenticity_class: 'ACTUAL_EVIDENCE',
        evidence_refs: []
    }, 'auto_assess'), /SOURCE_REQUIRED/);
});

test('D: simulated documentation is never a valid visual decision', () => {
    assert.throws(() => validateArtDirectionDecision({
        ...baseDecision,
        authenticity_class: 'SIMULATED_DOCUMENTATION'
    }, 'auto_assess'), /SIMULATED_DOCUMENTATION/);
});

test('E: a newer content revision makes an approved visual stale', () => {
    assert.deepEqual(calculateVisualReadiness({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 4,
        contentRevision: 4,
        visualMode: 'auto_assess',
        visualState: 'APPROVED',
        selectedAssetRevision: 3
    }), { ready: false, reason: 'visual_stale' });
});

test('F: idempotency contract exposes only deterministic decisions', () => {
    assert.deepEqual(ART_DIRECTION_DECISIONS, [
        'NO_VISUAL_NEEDED', 'GENERATE', 'SOURCE_REQUIRED', 'MANUAL_ASSET_REQUIRED', 'BLOCKED'
    ]);
});

test('G: required and forbidden placement modes cannot be bypassed', () => {
    assert.throws(() => validateArtDirectionDecision({
        ...baseDecision,
        decision: 'NO_VISUAL_NEEDED',
        loss_without_visual: '',
        prompt: null
    }, 'required'), /VISUAL_REQUIRED/);
    assert.equal(defaultVisualMode('email', 'body'), 'forbidden');
    assert.equal(defaultVisualMode('linkedin', 'carousel'), 'required');
    assert.equal(calculateVisualReadiness({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 1,
        contentRevision: 1,
        visualMode: 'forbidden',
        visualState: 'PENDING_ASSESSMENT'
    }).ready, true);
});

test('H: art-director MCP can assess visuals but cannot rewrite publication copy', () => {
    assert.equal(isToolAllowedForProfile('art_director', 'ba_get_art_direction_context'), true);
    assert.equal(isToolAllowedForProfile('art_director', 'ba_submit_art_direction_decision'), true);
    assert.equal(isToolAllowedForProfile('art_director', 'ba_review_image_asset'), true);
    assert.equal(isToolAllowedForProfile('art_director', 'ba_update_publication_content'), false);
    assert.equal(isToolAllowedForProfile('art_director', 'ba_import_publication_plan'), false);
});
