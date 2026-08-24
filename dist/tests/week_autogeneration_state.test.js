"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const week_autogeneration_state_1 = require("../services/week_autogeneration_state");
const approvedBase = {
    themeExists: true,
    themeAccepted: true,
    topicCount: 7,
    planDecision: 'approved',
    activeWriteCount: 0,
    activeReviewCount: 0,
    activeVisualCount: 0
};
(0, node_test_1.default)('week automation waits for headquarters approval before writing', () => {
    const state = (0, week_autogeneration_state_1.deriveWeekAutomationState)({ ...approvedBase, planDecision: null });
    strict_1.default.equal(state.stage, 'awaiting_topic_approval');
    strict_1.default.equal(state.next_action.command, 'ba_decide_week_plan');
});
(0, node_test_1.default)('week automation routes approved topics through writer, review, and visuals', () => {
    strict_1.default.equal((0, week_autogeneration_state_1.deriveWeekAutomationState)({ ...approvedBase, activeWriteCount: 7 }).stage, 'writing');
    strict_1.default.equal((0, week_autogeneration_state_1.deriveWeekAutomationState)({ ...approvedBase, activeReviewCount: 3 }).stage, 'content_review');
    strict_1.default.equal((0, week_autogeneration_state_1.deriveWeekAutomationState)({ ...approvedBase, activeVisualCount: 2 }).stage, 'visual_production');
    strict_1.default.equal((0, week_autogeneration_state_1.deriveWeekAutomationState)(approvedBase).stage, 'ready_for_publication');
});
(0, node_test_1.default)('week automation never treats an incomplete seven-day topic set as approved work', () => {
    const state = (0, week_autogeneration_state_1.deriveWeekAutomationState)({ ...approvedBase, topicCount: 6 });
    strict_1.default.equal(state.stage, 'generating_topics');
    strict_1.default.equal(state.next_action.actor, 'planner');
});
