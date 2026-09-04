import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    planAcceptedContentEdit,
    planContentReviewRecovery,
    planMissingContentReviewRecovery
} from '../services/publication_content_revision_lifecycle';

test('editing accepted content creates a new draft revision and reopens review without reusing its approval version', () => {
    assert.deepEqual(planAcceptedContentEdit({
        currentRevision: 1,
        acceptedRevision: 1,
        textState: 'accepted',
        bodyChanged: true
    }), {
        contentRevision: 2,
        textState: 'draft',
        acceptedRevision: null,
        reopenReview: true,
        reviewBaseResultVersion: 1
    });
});

test('saving the same body is idempotent and preserves the accepted revision', () => {
    assert.deepEqual(planAcceptedContentEdit({
        currentRevision: 2,
        acceptedRevision: 2,
        textState: 'accepted',
        bodyChanged: false
    }), {
        contentRevision: 2,
        textState: 'accepted',
        acceptedRevision: 2,
        reopenReview: false,
        reviewBaseResultVersion: 2
    });
});

test('recovery exposes the current content revision as a separately approvable review result', () => {
    assert.deepEqual(planContentReviewRecovery({
        contentRevision: 2,
        acceptedRevision: 1,
        textState: 'accepted',
        reviewResultVersion: 1,
        currentRevisionAlreadyApproved: false
    }), {
        needsRecovery: true,
        textState: 'draft',
        acceptedRevision: null,
        reviewState: 'waiting_approval',
        reviewResultVersion: 2
    });
});

test('recovery is idempotent after the current revision has already been approved', () => {
    assert.deepEqual(planContentReviewRecovery({
        contentRevision: 2,
        acceptedRevision: 2,
        textState: 'accepted',
        reviewResultVersion: 2,
        currentRevisionAlreadyApproved: true
    }), {
        needsRecovery: false,
        textState: 'accepted',
        acceptedRevision: 2,
        reviewState: 'completed',
        reviewResultVersion: 2
    });
});

test('publication content update and owner recovery are wired to the lifecycle contract', () => {
    const publicationService = readFileSync(resolve(process.cwd(), 'src/services/mcp_publication.service.ts'), 'utf8');
    const queueService = readFileSync(resolve(process.cwd(), 'src/services/work_queue.service.ts'), 'utf8');
    const mcpServer = readFileSync(resolve(process.cwd(), 'src/mcp/shared.ts'), 'utf8');

    assert.match(publicationService, /planAcceptedContentEdit/);
    assert.match(publicationService, /async configureVkStoryPoll/);
    assert.match(publicationService, /vk_story_poll: boundPoll/);
    assert.match(publicationService, /accepted_revision: lifecycle\.acceptedRevision/);
    assert.match(publicationService, /kind: 'content_review'/);
    assert.match(queueService, /requireProjectOwner\(tx, params\.projectId, params\.actorId\)/);
    assert.match(queueService, /command = 'ba_recover_content_review'/);
    assert.match(mcpServer, /registerTool\('ba_recover_content_review'/);
});

test('missing review recovery restores a draft gate without accepting or changing the current revision', () => {
    assert.deepEqual(planMissingContentReviewRecovery({
        contentRevision: 1,
        acceptedRevision: null,
        textState: 'draft'
    }), {
        contentRevision: 1,
        taskStatus: 'drafted',
        textState: 'draft',
        acceptedRevision: null,
        handoffState: 'blocked',
        reviewState: 'available',
        reviewResultVersion: 0,
        reviewInputContextVersion: 1
    });
});
