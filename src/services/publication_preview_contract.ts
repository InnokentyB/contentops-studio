import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Read-only snapshot input; identity is supplied by the authenticated server session. */
export const publicationPreviewSchema = z.object({
    projectId: z.number().int().positive(), taskId: z.number().int().positive(),
    expectedAcceptedRevision: z.number().int().positive().optional(),
    expectedPackageSha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
});
export type PublicationPreviewInput = z.infer<typeof publicationPreviewSchema>;
export type PreviewBlocker = {code: string; cause: string; action: string; role: 'owner' | 'publisher' | 'art_director' | 'engineering'};
const errors = {
    PREVIEW_AUTHENTICATED_PRINCIPAL_REQUIRED: ['An authenticated publication operator is required.', 'Connect the existing Owner or Publisher profile.'],
    PREVIEW_PROFILE_NOT_ALLOWED: ['This profile cannot inspect the publication execution boundary.', 'Use an authorized Owner or Publisher profile.'],
    PREVIEW_PROJECT_SCOPE_MISMATCH: ['The task project differs from the authenticated project.', 'Use the task belonging to the connected project; do not change caller identity fields.'],
    PREVIEW_PROJECT_ACCESS_DENIED: ['The authenticated user has no project membership.', 'Ask the project owner to restore the correct project access.'],
    PREVIEW_TASK_NOT_FOUND: ['No task was found in the authorized project.', 'Check the task reference in the current project.'],
    PREVIEW_DEPENDENCY_UNAVAILABLE: ['The local publication snapshot could not be read.', 'Restore database connectivity and repeat this read-only check; do not repeat an uncertain send.']
} as const;
export type PreviewErrorCode = keyof typeof errors;
/** Carries only reviewed error codes; dependency exceptions never enter the operator response. */
export class PublicationPreviewError extends Error {
    constructor(readonly code: PreviewErrorCode) {super(code);}
}
/** Project an error without exposing raw dependency messages or request arguments. */
export function publicationPreviewError(error: unknown): Record<string, unknown> {
    const code = error instanceof PublicationPreviewError ? error.code : 'PREVIEW_DEPENDENCY_UNAVAILABLE';
    const [cause, action] = errors[code];
    return {code, cause, action, mutates_state: false, provider_called: false, submission_permitted: false, retry_allowed: false};
}
/** Hash local metadata only; this digest is not a release signature or provider proof. */
export function previewHash(value: string): string {return createHash('sha256').update(value).digest('hex');}
