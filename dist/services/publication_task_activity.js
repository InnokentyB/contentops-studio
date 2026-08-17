"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalPublicationOutcome = canonicalPublicationOutcome;
exports.isPublicationTaskActive = isPublicationTaskActive;
const ACTIVE_STATUSES = new Set([
    'planned', 'drafted', 'revised', 'approved', 'scheduled',
    'ready_for_execution', 'awaiting_manual_publication', 'failed'
]);
function canonicalPublicationOutcome(item) {
    return item?.publication_fact?.outcome
        || item?.quality_report?.publication_outcome
        || item?.metrics?.publication_outcome
        || null;
}
function isPublicationTaskActive(item) {
    if (!ACTIVE_STATUSES.has(String(item?.status || '')))
        return false;
    return !['removed', 'blocked', 'restricted'].includes(String(canonicalPublicationOutcome(item) || ''));
}
