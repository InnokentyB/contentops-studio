export function planAcceptedContentEdit(input: {
    currentRevision: number;
    acceptedRevision: number | null;
    textState: string;
    bodyChanged: boolean;
}) {
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
        reviewBaseResultVersion: contentRevision,
        reviewState: 'waiting_approval'
    };
}

export function planContentReviewRecovery(input: {
    contentRevision: number;
    acceptedRevision: number | null;
    textState: string;
    reviewResultVersion: number;
    currentRevisionDecision: 'approved' | 'rejected' | null;
    submittedReviewAvailable: boolean;
    highestApprovalResultVersion?: number;
}) {
    if (input.currentRevisionDecision === 'approved'
        && input.acceptedRevision === input.contentRevision
        && input.textState === 'accepted') {
        return {
            needsRecovery: false,
            textState: input.textState,
            acceptedRevision: input.acceptedRevision,
            reviewState: 'completed',
            reviewResultVersion: input.reviewResultVersion,
            replacementReviewRequired: false
        };
    }

    if (input.currentRevisionDecision === null
        && input.submittedReviewAvailable) {
        return {
            needsRecovery: false,
            textState: input.textState,
            acceptedRevision: input.acceptedRevision,
            reviewState: 'waiting_approval',
            reviewResultVersion: input.reviewResultVersion,
            replacementReviewRequired: false
        };
    }

    const decisionVersionCollision = input.currentRevisionDecision !== null;
    const preserveSubmittedReview = decisionVersionCollision && input.submittedReviewAvailable;

    return {
        needsRecovery: true,
        textState: 'draft',
        acceptedRevision: null,
        reviewState: 'waiting_approval',
        reviewResultVersion: preserveSubmittedReview
            ? Math.max(input.reviewResultVersion, input.highestApprovalResultVersion || 0) + 1
            : Math.max(input.contentRevision, input.reviewResultVersion,
                (input.highestApprovalResultVersion || 0) + 1),
        replacementReviewRequired: decisionVersionCollision && !preserveSubmittedReview
    };
}

/** Work-item result versions are independent of content and writer versions. */
export function nextContentReviewResultVersion(current: number, highestApproval: number = 0): number {
    return Math.max(current, highestApproval) + 1;
}

export function planMissingContentReviewRecovery(input: {
    contentRevision: number;
    acceptedRevision: number | null;
    textState: string;
}) {
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
