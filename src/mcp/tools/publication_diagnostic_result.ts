import type { PublicationDiagnostic, PublicationDiagnosticService } from '../../services/publication_diagnostics';
import { logPublicationDiagnostic } from '../../services/publication_diagnostic_log';
import { asToolResult } from './common';

export type { PublicationDiagnosticService } from '../../services/publication_diagnostics';

/** A boundary-specific projection must remove unsafe values from failed results before returning payload. */
export type PublicationResultProjection = {
    payload: Record<string, unknown>;
    diagnostic?: PublicationDiagnostic;
    isError?: boolean;
};

function diagnosticResult(service: PublicationDiagnosticService, diagnostic: PublicationDiagnostic,
    payload: Record<string, unknown>, isError: boolean) {
    logPublicationDiagnostic(service, diagnostic, isError);
    return { ...asToolResult({ ...payload, ...diagnostic }), isError };
}

/** Handles reviewed diagnostics once at the operator boundary, preserving successful and informational reads. */
export async function publicationDiagnosticResult(
    service: PublicationDiagnosticService,
    run: () => Promise<Record<string, unknown>>,
    diagnose: (error: unknown) => PublicationDiagnostic,
    project?: (result: Record<string, unknown>) => PublicationResultProjection
): Promise<ReturnType<typeof asToolResult> & { isError: boolean }> {
    try {
        const result = await run();
        const projected = project ? project(result) : { payload: result };
        if (projected.diagnostic) return diagnosticResult(service, projected.diagnostic,
            projected.payload, projected.isError ?? true);
        return { ...asToolResult(projected.payload), isError: projected.isError ?? false };
    } catch (error: unknown) {
        const diagnostic = diagnose(error);
        return diagnosticResult(service, diagnostic, { error: `[${diagnostic.code}]` }, true);
    }
}
