const DEFAULT_DATABASE_POOL_MAX = 4;
const MAX_SAFE_DATABASE_POOL_PER_PROCESS = 5;

/**
 * Resolves a bounded PostgreSQL session budget for one service process.
 * The production session endpoint is shared by planner-app and planner-mcp,
 * so one process must never be able to consume the provider's full allowance.
 */
export function resolveDatabasePoolMax(rawValue: string | undefined): number {
    const normalized = String(rawValue || '').trim();
    if (!normalized) return DEFAULT_DATABASE_POOL_MAX;

    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SAFE_DATABASE_POOL_PER_PROCESS) {
        throw new Error(
            `[DATABASE_POOL_MAX_INVALID] DATABASE_POOL_MAX must be an integer from 1 to ${MAX_SAFE_DATABASE_POOL_PER_PROCESS}`
        );
    }
    return parsed;
}
