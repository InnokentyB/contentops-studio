import { threadsErrorDiagnostic } from '../../services/threads_error_catalog';
import { asToolResult } from './common';
import { publicationDiagnosticResult } from './publication_diagnostic_result';

/** Sends the same safe diagnostic to the operator and structured logs; never logs raw errors or arguments. */
export async function threadsDiagnosticResult<T extends Record<string, unknown>>(
    run: () => Promise<T>
): Promise<ReturnType<typeof asToolResult> & { isError: boolean }> {
    return publicationDiagnosticResult('threads', run, threadsErrorDiagnostic);
}
