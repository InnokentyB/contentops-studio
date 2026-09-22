export function assertContentReviewInput(input: {
    kind: string;
    assigneeRole: string;
    state: string;
    resultVersion: number;
    expectedResultVersion: number;
    contentRevision: number | null;
    expectedContentRevision: number;
    phase: 'claim' | 'submit';
}) {
    if (input.kind !== 'content_review' || input.assigneeRole !== 'content_reviewer') {
        throw new Error('[CONTENT_REVIEW_ROLE_MISMATCH] Only assigned content-review work can use this route');
    }
    if (input.state !== (input.phase === 'claim' ? 'available' : 'claimed')) {
        throw new Error('[CONTENT_REVIEW_STATE_CONFLICT] Review work is not in the expected state');
    }
    if (input.resultVersion !== input.expectedResultVersion
        || input.contentRevision !== input.expectedContentRevision) {
        throw new Error('[CONTENT_REVIEW_VERSION_CONFLICT] Review input or content revision changed');
    }
}
