"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.derivePublicationContentState = derivePublicationContentState;
function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function derivePublicationContentState(item) {
    if (String(item?.status || '') === 'published' || hasText(item?.published_link)) {
        return 'published';
    }
    const handoffBody = item?.quality_report?.handoff_bundle?.publication?.body;
    if (hasText(item?.draft_text) || hasText(handoffBody)) {
        return 'ready';
    }
    return 'empty';
}
