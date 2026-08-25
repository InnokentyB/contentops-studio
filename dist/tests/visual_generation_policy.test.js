"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const visual_generation_policy_1 = require("../services/visual_generation_policy");
const ready = {
    weekPackageId: 12,
    weekApprovalStatus: 'approved',
    textState: 'accepted',
    acceptedRevision: 3,
    contentRevision: 3,
    decisionType: 'GENERATE',
    decisionSourceRevision: 3,
    prompt: 'A single acceptance threshold beside a finished object that falls short.',
    altText: 'A finished object stopping just before a fixed acceptance threshold.'
};
(0, node_test_1.default)('visual generation is blocked until the weekly topic plan is approved', () => {
    strict_1.default.throws(() => (0, visual_generation_policy_1.assertVisualGenerationGate)({ ...ready, weekApprovalStatus: 'needs_review' }), /WEEK_PLAN_NOT_APPROVED/);
});
(0, node_test_1.default)('visual generation is blocked until the current text revision is accepted', () => {
    strict_1.default.throws(() => (0, visual_generation_policy_1.assertVisualGenerationGate)({ ...ready, textState: 'draft', acceptedRevision: null }), /TEXT_NOT_ACCEPTED/);
});
(0, node_test_1.default)('visual generation requires an approved GENERATE brief and alt text', () => {
    strict_1.default.throws(() => (0, visual_generation_policy_1.assertVisualGenerationGate)({ ...ready, decisionType: 'NO_VISUAL_NEEDED' }), /VISUAL_BRIEF_NOT_APPROVED/);
    strict_1.default.throws(() => (0, visual_generation_policy_1.assertVisualGenerationGate)({ ...ready, altText: null }), /ALT_TEXT_REQUIRED/);
    strict_1.default.doesNotThrow(() => (0, visual_generation_policy_1.assertVisualGenerationGate)(ready));
});
(0, node_test_1.default)('production prompt bans text, pseudo interfaces, office scenes and comic retelling', () => {
    const prompt = (0, visual_generation_policy_1.hardenEditorialVisualPrompt)(ready.prompt);
    strict_1.default.match(prompt, /No visible text/);
    strict_1.default.match(prompt, /No user-interface panels/);
    strict_1.default.match(prompt, /No people, office teams/);
    strict_1.default.match(prompt, /must not retell the post/);
});
