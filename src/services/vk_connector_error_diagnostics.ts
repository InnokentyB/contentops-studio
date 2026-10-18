import type { PublicationDiagnostic } from './publication_diagnostics';

const catalog: Record<string, readonly [string, string, string]> = {
    AUTH_UNAVAILABLE: ["actor", "An authenticated owner identity is unavailable.", "Use the authenticated project owner identity; ask the administrator to repair identity mapping."],
    SCOPE_MISMATCH: ["scope", "The requested scope is not supported by this connector.", "Use the documented Planner connector command and its authorized project scope."],
    HOST_IDENTITY_INVALID: ["host", "The connector host identity is invalid.", "Use the registered independent adapter identity; do not inject a session or use another transport."],
    DISABLED: ["connector", "Connector dispatch is disabled.", "Ask the operator to review connector configuration and permission before enabling it."],
    STALE_MANIFEST: ["manifest", "The workspace manifest has changed.", "Read the current manifest and obtain owner approval for the current package before dispatch."],
    PACKAGE_CHANGED: ["package", "The immutable publication package no longer matches.", "Compare the accepted package with the existing job; obtain a matching owner release without editing historical proof."],
    PACKAGE_NOT_READY: ["package", "The connector package or stored execution state is not ready.", "Inspect stored job validity, accepted revision, visual decision, owner release and publication gates; the exact failed prerequisite is not established here."],
    IDEMPOTENCY_CONFLICT: ["idempotency", "The existing operation key belongs to a different request.", "Inspect the recorded operation and original package; do not change keys to bypass an existing attempt."],
    ALREADY_PUBLISHED: ["publication", "A publication fact already exists.", "Read and verify the canonical publication fact; do not submit another publication."],
    VERIFICATION_REQUIRED: ["attempt", "Existing attempt or publication state requires verification.", "Reconcile the existing attempt and provider evidence through the registered adapter; never resend."],
    FENCED: ["fence", "The combined job, host, generation or lease fence failed.", "Read the current job and registered host state; reconcile any started attempt before obtaining valid fencing. The failed subcondition is not established here."],
    CAS_CONFLICT: ["state", "The job changed before the conditional update completed.", "Read the current job and generation; reconcile an existing attempt before considering another authorized control action."],
    JOB_NOT_FOUND: ["job", "The job is unavailable in the authorized scope.", "Check the existing job reference and project access; do not create a replacement to bypass history."],
    EXECUTION_PACKAGE_UNAVAILABLE: ["package", "The execution package reader is unavailable.", "Ask engineering to repair the registered adapter package integration before execution."],
    ATTEMPT_CHANGED: ["attempt", "The canonical attempt differs from the transport attempt.", "Reconcile the existing canonical attempt and transport history; do not reset or resend."],
    INPUT_INVALID: ["input", "A connector input failed validation.", "Check the documented input formats and use the current immutable package bindings."],
    BUILD_INVALID: ["build", "The consumer build version format is invalid.", "Repair the registered consumer build metadata and use the documented version format."],
    HOST_BUSY: ["host", "Another current consumer instance owns the host.", "Inspect the registered instance and heartbeat; coordinate ownership before starting another consumer."],
    BLOCKER_INVALID: ["blocker", "The reported blocker is not supported.", "Use a documented blocker code from the registered consumer; repair incompatible reporting code."],
    PROVIDER_MODE_REQUIRED: ["mode", "The registered host is not in provider execution mode.", "Ask the operator to inspect registered consumer mode and permissions; mode alone never grants permission."],
    RECONCILIATION_SOURCE_UNVERIFIED: ["evidence", "The reconciliation source could not be verified.", "Collect supported read-only evidence through the registered independent adapter; unknown coverage is not proof of absence."],
    LEASE_UNAVAILABLE: ["lease", "A valid canonical lease could not be obtained.", "Inspect the existing job and canonical attempt; repair lease coordination without resetting or bypassing the attempt."],
    MEDIA_UNCONFIRMED: ["media", "The required media acknowledgement was not confirmed.", "Verify exact accepted media through the registered adapter; reconcile any started submission before further action."],
    MEDIA_SOURCE_UNVERIFIED: ["media", "The media evidence source could not be verified.", "Repair trusted media evidence collection in the registered adapter; reconcile existing publication evidence."],
    RECONCILIATION_ONLY: ["attempt", "The current state permits reconciliation only.", "Reconcile the same job and attempt through the registered independent adapter; never resend."],
    CHALLENGE_CAPACITY: ["challenge", "The bounded application challenge capacity is exhausted.", "Ask engineering to inspect challenge lifecycle and expiry; do not create parallel consumers or bypass capability checks."],
    PROVIDER_CONTROL_DENIED: ["permission", "Provider control is denied.", "Keep the job blocked and ask the operator to resolve the denial in the registered adapter; no browser, API or chat fallback."],
    PROVIDER_PERMISSION_UNVERIFIED: ["permission", "Provider permission has not been verified.", "Have the registered adapter verify permitted action-time admission; application heartbeat or approval is not provider permission."],
    NOT_CONNECTED: ["connection", "The registered adapter reports no provider connection.", "Ask the operator to repair the registered adapter connection; do not inject sessions or use an alternate transport."],
    LOGIN_REQUIRED: ["connection", "The registered adapter reports that login is required.", "Ask the operator to restore login in the independent adapter operating context; never share tokens or cookies in diagnostics."],
    COVERAGE_UNKNOWN: ["evidence", "Provider inventory coverage is unknown.", "Repair complete read-only collection and pagination in the registered adapter; do not infer absence or resend."],
    ACTIVE_ATTEMPT: ["attempt", "An existing attempt is active.", "Reconcile the same attempt and provider result; do not create a new attempt or send again."],
    POLICY_DENIED: ["permission", "The requested provider action is denied by policy.", "Keep the job blocked; resolve the explicit denial with the responsible operator. Another adapter or chat cannot bypass it."],
    EXECUTION_INTERRUPTED: ["attempt", "Execution was interrupted and its outcome is uncertain.", "Reconcile the existing durable attempt and provider history; never resend or rotate the operation key."],
    CANONICAL_LEASE_UNAVAILABLE: ["lease", "Canonical lease binding was not completed.", "Inspect the canonical job and lease state and reconcile existing attempts before repairing coordination."],
    PROVIDER_VERIFICATION_REQUIRED: ["attempt", "Provider outcome requires verification.", "Reconcile the existing attempt through the registered adapter using trusted provider evidence; never resend."],
    FACT_PATH_INVALID: ["fact", "The attempted publication fact path is not supported.", "Ask engineering to repair the canonical fact integration; preserve the attempt and reconcile provider evidence."],
    OBJECT_UNCONFIRMED: ["evidence", "The provider object identity could not be confirmed.", "Collect valid trusted provider readback through the registered adapter and reconcile the existing attempt."],
    HOST_MODE_INVALID: ['mode', 'The stored registered host mode is invalid.', 'Ask engineering to repair registered consumer mode configuration without changing existing attempt history.'],
    OFFLINE: ['host', 'The registered adapter has no fresh heartbeat.', 'Ask the operator to inspect the registered independent adapter health and logs; do not activate a duplicate consumer.'],
    REQUEST_FAILED: ["request", "The connector request failed for an unclassified reason.", "Ask engineering to investigate sanitized service health and existing job history. The exact cause is not established; reconcile before any repeat."],
};

function diagnostic(key: string): PublicationDiagnostic {
    const [field, message, action] = catalog[key];
    return { code: `VK_CONNECTOR_${key}`, message, reasons: [{ code: key, field, message, action }], retry_allowed: false };
}

/** Classifies only reviewed connector codes; raw exception data never crosses this boundary. */
export function vkConnectorErrorDiagnostic(error: unknown): PublicationDiagnostic {
    const key = error instanceof Error ? /^\[VK_CONNECTOR_([A-Z_]+)\]/.exec(error.message)?.[1] : undefined;
    return diagnostic(key && Object.prototype.hasOwnProperty.call(catalog, key) ? key : 'REQUEST_FAILED');
}

/** An observed blocker is status information, never new send authority or a failed transport call. */
export function vkConnectorOutcomeDiagnostic(result: Record<string, unknown>): PublicationDiagnostic | undefined {
    const blocker = typeof result.blocker === 'string' ? result.blocker : undefined;
    if (blocker && Object.prototype.hasOwnProperty.call(catalog, blocker)) {
        const value = diagnostic(blocker);
        return { ...value, reasons: value.reasons.map(reason => ({ ...reason, action: `${reason.action} Reconcile any started or uncertain attempt before further execution.` })) };
    }
    if (blocker) return diagnostic('REQUEST_FAILED');
    if (result.status === 'verification_required' || result.state === 'verification_required') return diagnostic('VERIFICATION_REQUIRED');
    if (result.state === 'blocked') return diagnostic('REQUEST_FAILED');
    if (result.status === 'disabled') return diagnostic('DISABLED');
    if (result.status === 'offline') return diagnostic('OFFLINE');
    if (result.providerExecution === 'blocked' && result.permissionStatus === 'POLICY_DENIED') return diagnostic('POLICY_DENIED');
    if (result.providerExecution === 'blocked' && result.permissionStatus === 'NOT_CHECKED') return diagnostic('PROVIDER_PERMISSION_UNVERIFIED');
    const health = result.health;
    if (health && typeof health === 'object' && !Array.isArray(health)) return vkConnectorOutcomeDiagnostic(health as Record<string, unknown>);
    return undefined;
}

/** Projects reviewed status metadata only; malformed stored blockers and arbitrary failure data are excluded. */
export function vkConnectorDiagnosticPayload(result: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const enums: Record<string, readonly string[]> = {
        state: ['queued', 'accepted', 'blocked', 'verification_required', 'confirmed', 'reconciling', 'ready', 'executing', 'cancelled'],
        status: ['disabled', 'offline', 'online', 'verification_required'],
        mode: ['infrastructure_only', 'vk_feed_provider'], providerExecution: ['blocked', 'permitted']
    };
    for (const [key, values] of Object.entries(enums)) {
        const value = result[key];
        if (typeof value === 'string' && values.includes(value)) payload[key] = value;
    }
    if (result.blocker === null) payload.blocker = null;
    else if (typeof result.blocker === 'string') payload.blocker = Object.prototype.hasOwnProperty.call(catalog, result.blocker)
        ? result.blocker : 'REQUEST_FAILED';
    for (const key of ['generation', 'attemptId', 'factId']) {
        const value = result[key];
        if (value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) payload[key] = value;
    }
    if (typeof result.hostId === 'string' && /^[a-z0-9_-]{1,100}$/.test(result.hostId)) payload.hostId = result.hostId;
    if (typeof result.jobId === 'string' && /^[a-f0-9-]{36}$/i.test(result.jobId)) payload.jobId = result.jobId;
    if (typeof result.packageSha256 === 'string' && /^[a-f0-9]{64}$/.test(result.packageSha256)) payload.packageSha256 = result.packageSha256;
    for (const key of ['receiptAt', 'heartbeatAt']) {
        const value = result[key];
        if (value === null || typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) payload[key] = value;
    }
    if (result.publicUrl === null) payload.publicUrl = null;
    // These fields belong to the existing protected accepted-package read, not to diagnostics/logs.
    if (result.providerExecution === 'blocked' && (result.permissionStatus === 'POLICY_DENIED' || result.permissionStatus === 'NOT_CHECKED')) {
        payload.permissionStatus = result.permissionStatus;
        for (const key of ['body', 'approvalReference', 'releasedAt']) {
            if (typeof result[key] === 'string') payload[key] = result[key];
        }
        if (typeof result.workItemId === 'number' && Number.isSafeInteger(result.workItemId)) payload.workItemId = result.workItemId;
        if (result.lease === null) payload.lease = null;
        for (const [key, fields] of Object.entries({
            binding: ['projectId', 'taskId', 'channelId', 'communityId', 'revision', 'selectedAssetId', 'placement', 'bodySha256', 'assetSha256', 'releaseSha256'],
            asset: ['id', 'url', 'sha256']
        })) {
            const value = result[key];
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const source = value as Record<string, unknown>, projected: Record<string, unknown> = {};
            for (const field of fields) {
                const entry = source[field];
                if (typeof entry === 'string' || typeof entry === 'number' && Number.isSafeInteger(entry)) projected[field] = entry;
            }
            payload[key] = projected;
        }
    }
    const health = result.health;
    if (health && typeof health === 'object' && !Array.isArray(health)) payload.health = vkConnectorDiagnosticPayload(health as Record<string, unknown>);
    return payload;
}
