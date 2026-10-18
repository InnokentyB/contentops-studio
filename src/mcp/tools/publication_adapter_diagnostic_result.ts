import { PublicationDiagnosticError, type PublicationDiagnostic } from '../../services/publication_diagnostics';
import { diagnoseDirectPublicationError, projectDirectPublicationResult,
    projectSuccessfulTelegramTrace, sanitizeTelegramRouteTrace } from '../../services/direct_publication_error_diagnostics';
import { threadsErrorDiagnostic } from '../../services/threads_error_catalog';
import { publicationDiagnosticResult } from './publication_diagnostic_result';
import { asToolResult } from './common';

function diagnose(error: unknown): PublicationDiagnostic {
    const diagnostic = error instanceof PublicationDiagnosticError ? error.diagnostics
        : error instanceof Error && /^\[THREADS_/.test(error.message) ? threadsErrorDiagnostic(error)
            : diagnoseDirectPublicationError(error);
    const trace = error !== null && typeof error === 'object' && 'routeTrace' in error
        ? sanitizeTelegramRouteTrace(error) : null;
    return { ...diagnostic, ...(trace ? { route_trace: trace } : {}) };
}

/** Adapter-level operator boundary: safe errors/denials and safe Telegram fallback evidence, no provider retries. */
export function publicationAdapterDiagnosticResult(
    run: () => Promise<Record<string, unknown>>
): Promise<ReturnType<typeof asToolResult> & { isError: boolean }> {
    return publicationDiagnosticResult('publication', run, diagnose, result => {
        const projected = projectDirectPublicationResult(result);
        return projected.diagnostic ? projected : { payload: projectSuccessfulTelegramTrace(projected.payload) };
    });
}
