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
        reviewBaseResultVersion: contentRevision - 1
    };
}

export function planContentReviewRecovery(input: {
    contentRevision: number;
    acceptedRevision: number | null;
    textState: string;
    reviewResultVersion: number;
    currentRevisionAlreadyApproved: boolean;
}) {
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
