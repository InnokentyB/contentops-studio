/** Safe operator diagnostics. Values must come from reviewed static catalogs, never request/provider data. */
export type PublicationDiagnostic = {
    code: string;
    message: string;
    reasons: readonly { code: string; field: string; message: string; action: string }[];
    retry_allowed: false;
};

/** Keeps the legacy code in Error.message while carrying safe structured diagnostics to adapters. */
export class PublicationDiagnosticError extends Error {
    constructor(public readonly diagnostics: PublicationDiagnostic) {
        super(`[${diagnostics.code}] ${JSON.stringify(diagnostics)}`);
        this.name = 'PublicationDiagnosticError';
    }
}
