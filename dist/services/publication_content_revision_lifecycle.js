"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planAcceptedContentEdit = planAcceptedContentEdit;
exports.planContentReviewRecovery = planContentReviewRecovery;
exports.planMissingContentReviewRecovery = planMissingContentReviewRecovery;
function planAcceptedContentEdit(input) {
    if (!input.bodyChanged) {
        return {
            contentRevision: input.currentRevision,
            textState: input.textState,
            acceptedRevision: input.acceptedRevision,
            reopenReview: false,
            reviewBaseResultVersion: input.currentRevision
        };
    }
    const contentRevision = input.currentRevision + 1;
    return {
        contentRevision,
        textState: 'draft',
        acceptedRevision: null,
        reopenReview: true,
        reviewBaseResultVersion: contentRevision - 1
    };
}
function planContentReviewRecovery(input) {
    if (input.currentRevisionAlreadyApproved
        && input.acceptedRevision === input.contentRevision
        && input.textState === 'accepted') {
        return {
            needsRecovery: false,
            textState: input.textState,
            acceptedRevision: input.acceptedRevision,
            reviewState: 'completed',
            reviewResultVersion: input.reviewResultVersion
        };
    }
    return {
        needsRecovery: true,
        textState: 'draft',
        acceptedRevision: null,
        reviewState: 'waiting_approval',
        reviewResultVersion: input.contentRevision
    };
}
function planMissingContentReviewRecovery(input) {
    return {
        contentRevision: input.contentRevision,
        taskStatus: 'drafted',
        textState: 'draft',
        acceptedRevision: null,
        handoffState: 'blocked',
        reviewState: 'available',
        reviewResultVersion: Math.max(0, input.contentRevision - 1),
        reviewInputContextVersion: input.contentRevision
    };
}
