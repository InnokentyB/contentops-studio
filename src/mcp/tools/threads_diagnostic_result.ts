import { threadsErrorDiagnostic } from '../../services/threads_error_catalog';
import { asToolResult } from './common';

/** Sends the same safe diagnostic to the operator and structured logs; never logs raw errors or arguments. */
export async function threadsDiagnosticResult<T extends Record<string, unknown>>(
    run: () => Promise<T>
): Promise<ReturnType<typeof asToolResult> & { isError: boolean }> {
    try { return { ...asToolResult(await run()), isError: false }; }
    catch (error: unknown) {
        const diagnostic = threadsErrorDiagnostic(error);
        console.warn(JSON.stringify({ event: 'publication_blocked', service: 'threads', ...diagnostic }));
        return { ...asToolResult(diagnostic), isError: true };
    }
}
