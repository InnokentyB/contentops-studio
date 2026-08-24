"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const art_direction_service_1 = require("../services/art_direction.service");
const capabilities_1 = require("../mcp/capabilities");
const baseDecision = {
    decision: 'GENERATE',
    source_content_revision: 3,
    channel: 'dzen',
    placement: 'article_cover',
    visual_function: 'explain',
    reason: 'A diagram makes the sequence understandable.',
    post_owns: 'The post describes the process.',
    visual_adds: 'The visual exposes the order and handoffs.',
    loss_without_visual: 'Readers lose the sequence.',
    authenticity_class: 'CONCEPTUAL_EDITORIAL',
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
(0, node_test_1.default)('A: no-visual is a positive ready state and does not require generation', () => {
    const decision = (0, art_direction_service_1.validateArtDirectionDecision)({
        ...baseDecision,
        decision: 'NO_VISUAL_NEEDED',
        loss_without_visual: '',
        prompt: null
    }, 'auto_assess');
    strict_1.default.equal(decision.decision, 'NO_VISUAL_NEEDED');
    strict_1.default.deepEqual((0, art_direction_service_1.calculateVisualReadiness)({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 3,
        contentRevision: 3,
        visualMode: 'auto_assess',
        visualState: 'NO_VISUAL_NEEDED'
    }), { ready: true, reason: null });
});
(0, node_test_1.default)('B: generated is not publication-ready until visual review approves an asset', () => {
    strict_1.default.equal((0, art_direction_service_1.calculateVisualReadiness)({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 3,
        contentRevision: 3,
        visualMode: 'required',
        visualState: 'GENERATED'
    }).ready, false);
    strict_1.default.equal((0, art_direction_service_1.calculateVisualReadiness)({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 3,
        contentRevision: 3,
        visualMode: 'required',
        visualState: 'APPROVED',
        selectedAssetRevision: 3
    }).ready, true);
});
(0, node_test_1.default)('C: evidence visuals without evidence refs require a source instead of generation', () => {
    strict_1.default.throws(() => (0, art_direction_service_1.validateArtDirectionDecision)({
        ...baseDecision,
        authenticity_class: 'ACTUAL_EVIDENCE',
        evidence_refs: []
    }, 'auto_assess'), /SOURCE_REQUIRED/);
});
(0, node_test_1.default)('D: simulated documentation is never a valid visual decision', () => {
    strict_1.default.throws(() => (0, art_direction_service_1.validateArtDirectionDecision)({
        ...baseDecision,
        authenticity_class: 'SIMULATED_DOCUMENTATION'
    }, 'auto_assess'), /SIMULATED_DOCUMENTATION/);
});
(0, node_test_1.default)('E: a newer content revision makes an approved visual stale', () => {
    strict_1.default.deepEqual((0, art_direction_service_1.calculateVisualReadiness)({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 4,
        contentRevision: 4,
        visualMode: 'auto_assess',
        visualState: 'APPROVED',
        selectedAssetRevision: 3
    }), { ready: false, reason: 'visual_stale' });
});
(0, node_test_1.default)('F: idempotency contract exposes only deterministic decisions', () => {
    strict_1.default.deepEqual(art_direction_service_1.ART_DIRECTION_DECISIONS, [
        'NO_VISUAL_NEEDED', 'GENERATE', 'SOURCE_REQUIRED', 'MANUAL_ASSET_REQUIRED', 'BLOCKED'
    ]);
});
(0, node_test_1.default)('G: required and forbidden placement modes cannot be bypassed', () => {
    strict_1.default.throws(() => (0, art_direction_service_1.validateArtDirectionDecision)({
        ...baseDecision,
        decision: 'NO_VISUAL_NEEDED',
        loss_without_visual: '',
        prompt: null
    }, 'required'), /VISUAL_REQUIRED/);
    strict_1.default.equal((0, art_direction_service_1.defaultVisualMode)('email', 'body'), 'forbidden');
    strict_1.default.equal((0, art_direction_service_1.defaultVisualMode)('linkedin', 'carousel'), 'required');
    strict_1.default.equal((0, art_direction_service_1.calculateVisualReadiness)({
        enabled: true,
        textState: 'accepted',
        acceptedRevision: 1,
        contentRevision: 1,
        visualMode: 'forbidden',
        visualState: 'PENDING_ASSESSMENT'
    }).ready, true);
});
(0, node_test_1.default)('H: art-director MCP can assess visuals but cannot rewrite publication copy', () => {
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('art_director', 'ba_get_art_direction_context'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('art_director', 'ba_submit_art_direction_decision'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('art_director', 'ba_review_image_asset'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('art_director', 'ba_update_publication_content'), false);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('art_director', 'ba_import_publication_plan'), false);
});
