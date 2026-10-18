import type { PublicationDiagnostic, PublicationDiagnosticService } from './publication_diagnostics';

/** Logs only the reviewed diagnostic envelope at the handling boundary, without raw errors or request arguments. */
export function logPublicationDiagnostic(service: PublicationDiagnosticService,
    diagnostic: PublicationDiagnostic, isError: boolean): void {
    console.warn(JSON.stringify({ event: 'publication_diagnostic', service, isError, ...diagnostic }));
}
