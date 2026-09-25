export const INTERNAL_MUTATION_ANNOTATIONS = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
} as const;

export const EXTERNAL_PUBLICATION_ANNOTATIONS = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
} as const;

/**
 * Formats a payload record as a standard MCP tool execution result.
 *
 * @param payload - Result object to serialize and structure.
 * @returns MCP formatted tool response.
 */
export function asToolResult<T extends Record<string, unknown>>(payload: T) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(payload, null, 2)
            }
        ],
        structuredContent: payload
    };
}

/**
 * Formats a caught error with routeTrace as a structured Telegram tool error.
 *
 * @param error - The caught error object or value.
 * @returns Error tool response or null if routeTrace is absent.
 */
export function asTelegramRouteToolError(error: unknown) {
    const err = error as { routeTrace?: unknown; message?: string } | null | undefined;
    if (!err?.routeTrace) return null;
    return {
        ...asToolResult({
            mode: 'failed',
            error: String(err.message || error || 'Telegram publication failed'),
            route_trace: err.routeTrace as Record<string, unknown>
        }),
        isError: true
    };
}

/**
 * Validates that workspace identity (projectId and userId) is present.
 *
 * @param projectId - Workspace project ID.
 * @param userId - Requesting user ID.
 * @returns An object containing guaranteed numeric projectId and userId.
 */
export function requireWorkspaceIdentity(projectId?: number, userId?: number): { projectId: number; userId: number } {
    if (!projectId || !userId) {
        throw new Error('[IDENTITY_REQUIRED] Remote MCP injects project and user identity from the access token. Local callers must provide both.');
    }
    return { projectId, userId };
}
