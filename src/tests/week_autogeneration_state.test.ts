import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveWeekAutomationState } from '../services/week_autogeneration_state';

const approvedBase = {
    themeExists: true,
    themeAccepted: true,
    topicCount: 7,
    planDecision: 'approved',
    activeWriteCount: 0,
    activeReviewCount: 0,
    activeVisualCount: 0
};

test('week automation waits for headquarters approval before writing', () => {
    const state = deriveWeekAutomationState({ ...approvedBase, planDecision: null });
    assert.equal(state.stage, 'awaiting_topic_approval');
    assert.equal(state.next_action.command, 'ba_decide_week_plan');
});

test('week automation routes approved topics through writer, review, and visuals', () => {
    assert.equal(deriveWeekAutomationState({ ...approvedBase, activeWriteCount: 7 }).stage, 'writing');
    assert.equal(deriveWeekAutomationState({ ...approvedBase, activeReviewCount: 3 }).stage, 'content_review');
    assert.equal(deriveWeekAutomationState({ ...approvedBase, activeVisualCount: 2 }).stage, 'visual_production');
    assert.equal(deriveWeekAutomationState(approvedBase).stage, 'ready_for_publication');
});

test('week automation never treats an incomplete seven-day topic set as approved work', () => {
    const state = deriveWeekAutomationState({ ...approvedBase, topicCount: 6 });
    assert.equal(state.stage, 'generating_topics');
    assert.equal(state.next_action.actor, 'planner');
});
