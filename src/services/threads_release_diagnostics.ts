import { PublicationDiagnosticError } from './publication_diagnostics';

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

type Release = { before_state: unknown; after_state: unknown };
type ExpectedProof = { body_sha256: string; channel_id: number | null; accepted_revision: number | null;
    manifest_checksum: string; actor_id: string; approval_reference: string };

const fields = {
    publication_authorized: { code: 'PUBLICATION_NOT_AUTHORIZED', message: 'Release does not authorize publication.',
        action: 'The project owner must review the accepted package and issue an explicit audited release.' },
    body_sha256: { code: 'BODY_SHA256_MISMATCH', message: 'Accepted text differs from the released text.',
        action: 'Review the current accepted text and obtain a release bound to that exact text.' },
    channel_id: { code: 'CHANNEL_ID_MISMATCH', message: 'The release targets a different channel.',
        action: 'Verify the intended channel and obtain an owner release for the current accepted package.' },
    accepted_revision: { code: 'ACCEPTED_REVISION_MISMATCH', message: 'The accepted revision differs from the released revision.',
        action: 'Complete review of the current revision and obtain a release for that accepted revision.' },
    manifest_checksum: { code: 'MANIFEST_CHECKSUM_MISMATCH', message: 'The workspace manifest differs from the released manifest.',
        action: 'Read the current workspace manifest, review its changes and obtain a release bound to it.' },
    actor_id: { code: 'ACTOR_ID_MISMATCH', message: 'The release proof belongs to a different actor.',
        action: 'Use the authorized owner identity and its matching audited release; do not edit the stored proof.' },
    approval_reference: { code: 'APPROVAL_REFERENCE_MISMATCH', message: 'The approval reference does not match the release.',
        action: 'Use the approval reference associated with the selected audited release; ask the owner if unavailable.' }
} as const;

/** Validates the same release guards and reports every observable mismatch without exposing either value. */
export function assertThreadsOwnerRelease(release: Release | null, expected: ExpectedProof): Record<string, unknown> {
    const proof = record(release?.after_state);
    const reasons = !release ? [{ code: 'RELEASE_NOT_FOUND', field: 'release',
        message: 'No audited release matches the current project, task, owner and release key.',
        action: 'Check the selected owner and release key. If no matching release exists, the owner must review the package and run ba_release_approved_threads_task. Do not resend publication.' }]
        : (Object.keys(fields) as (keyof typeof fields)[]).flatMap(field => {
            const actual = field === 'approval_reference' ? record(release.before_state)[field] : proof[field];
            const wanted = field === 'publication_authorized' ? true : expected[field];
            if (actual === wanted) return [];
            return [{ field, ...fields[field] }];
        });
    if (reasons.length) throw new PublicationDiagnosticError({ code: 'THREADS_GENERIC_OWNER_RELEASE_REQUIRED',
        message: 'Publication is blocked because the audited owner release does not match the accepted package.',
        reasons, retry_allowed: false });
    return proof;
}
