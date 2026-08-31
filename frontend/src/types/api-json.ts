/**
 * Unvalidated JSON returned by legacy API endpoints.
 *
 * Keep this escape hatch at the transport boundary. New endpoint contracts should
 * use explicit interfaces and migrate callers away from this type incrementally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy endpoints do not yet expose runtime-validated schemas
export type ApiJson = any
