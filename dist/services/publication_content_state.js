"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.derivePublicationContentState = derivePublicationContentState;
function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function derivePublicationContentState(item) {
    const fact = item?.publication_fact;
    const factPublished = fact?.outcome === 'published' && Boolean(fact?.published_at)
        && (hasText(fact?.public_url)
            || (fact?.artifact_kind === 'story' && hasText(fact?.provider_object_id) && hasText(fact?.evidence_ref))
            || (fact?.artifact_kind === 'email' && hasText(fact?.provider_object_id)));
    if (factPublished || (!fact && (String(item?.status || '') === 'published' || hasText(item?.published_link)))) {
        return 'published';
    }
    const handoffBody = item?.quality_report?.handoff_bundle?.publication?.body;
    if (hasText(item?.draft_text) || hasText(handoffBody)) {
        return 'ready';
    }
    return 'empty';
}
