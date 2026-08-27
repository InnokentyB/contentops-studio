"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const publication_content_revision_lifecycle_1 = require("../services/publication_content_revision_lifecycle");
(0, node_test_1.default)('editing accepted content creates a new draft revision and reopens review without reusing its approval version', () => {
    strict_1.default.deepEqual((0, publication_content_revision_lifecycle_1.planAcceptedContentEdit)({
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
(0, node_test_1.default)('saving the same body is idempotent and preserves the accepted revision', () => {
    strict_1.default.deepEqual((0, publication_content_revision_lifecycle_1.planAcceptedContentEdit)({
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
(0, node_test_1.default)('recovery exposes the current content revision as a separately approvable review result', () => {
    strict_1.default.deepEqual((0, publication_content_revision_lifecycle_1.planContentReviewRecovery)({
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
(0, node_test_1.default)('recovery is idempotent after the current revision has already been approved', () => {
    strict_1.default.deepEqual((0, publication_content_revision_lifecycle_1.planContentReviewRecovery)({
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
(0, node_test_1.default)('publication content update and owner recovery are wired to the lifecycle contract', () => {
    const publicationService = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(process.cwd(), 'src/services/mcp_publication.service.ts'), 'utf8');
    const queueService = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(process.cwd(), 'src/services/work_queue.service.ts'), 'utf8');
    const mcpServer = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(process.cwd(), 'src/mcp/shared.ts'), 'utf8');
    strict_1.default.match(publicationService, /planAcceptedContentEdit/);
    strict_1.default.match(publicationService, /accepted_revision: lifecycle\.acceptedRevision/);
    strict_1.default.match(publicationService, /kind: 'content_review'/);
    strict_1.default.match(queueService, /requireProjectOwner\(tx, params\.projectId, params\.actorId\)/);
    strict_1.default.match(queueService, /command = 'ba_recover_content_review'/);
    strict_1.default.match(mcpServer, /registerTool\('ba_recover_content_review'/);
});
(0, node_test_1.default)('missing review recovery restores a draft gate without accepting or changing the current revision', () => {
    strict_1.default.deepEqual((0, publication_content_revision_lifecycle_1.planMissingContentReviewRecovery)({
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
