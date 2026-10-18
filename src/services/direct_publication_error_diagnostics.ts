import { PublicationDiagnostic } from './publication_diagnostics';
import { dzenPublicationAdapterRequired, vkPublicationAdapterRequired } from './vk_publication_route_contract';

type Entry = readonly [field: string, message: string, action: string];
const reconcile = 'Reconcile the existing attempt and provider evidence with the project owner. Do not resend, change the idempotency key or bypass the existing attempt.';
const adapter = 'Use the documented Planner command and registered independent adapter. Keep the task blocked if unavailable and request engineering repair; browser, API and manual fallback are forbidden.';
const catalog: Record<string, Entry> = {
    APPROVED_VISUAL_REQUIRED: ['selected_asset', 'An approved visual bound to the accepted revision is required.', 'Select a visual, complete its review for the accepted revision and obtain the required owner release.'],
    APPROVED_VISUAL_NOT_SERVER_RESOLVABLE: ['selected_asset', 'The approved visual does not have a permitted durable HTTPS location.', 'Store the approved visual at a durable server-accessible HTTPS location, then review and release the updated package.'],
    ACCEPTED_REVISION_REQUIRED: ['accepted_revision', 'The current text revision is not accepted.', 'Complete review of the current text revision before requesting owner release.'],
    SUPPORTED_PUBLICATION_TASK_REQUIRED: ['channel', 'This task is not supported by the selected direct publication route.', 'Inspect the task channel and use its documented supported publication command; do not change the channel to bypass the guard.'],
    IDEMPOTENCY_KEY_REQUIRED: ['idempotency_key', 'Live task publication requires an idempotency key.', 'Read existing attempts first. Supply the key for the intended authorized operation; do not create a fresh key for an unresolved attempt.'],
    IDEMPOTENCY_KEY_CONFLICT: ['idempotency_key', 'The idempotency key belongs to another publication task.', 'Check the intended task and its recorded operation key. Resolve the conflict with the owner without editing audit history or bypassing an attempt.'],
    PUBLICATION_TASK_NOT_FOUND: ['task', 'The publication task was not found in the selected project.', 'Verify the selected project and task with an authorized project operator. Do not search another tenant or create a replacement publication.'],
    OWNER_RELEASE_REQUIRED: ['owner_release', 'Accepted content does not authorize publication.', 'Ask the project owner to review the accepted package and issue the documented audited release.'],
    OWNER_RELEASE_PROOF_MISMATCH: ['owner_release', 'The exact audited owner release could not be validated.', 'Read the current accepted package and release bindings with the owner. Correct the selected proof or obtain a new release after review; do not edit stored proof.'],
    TELEGRAM_PERSONAL_STORY_SESSION_BINDING_MISMATCH: ['session_binding', 'The Telegram personal-story session does not match the released binding.', 'Have the owner verify the intended account and current session binding, then review and release that exact package.'],
    PROJECT_OWNER_REQUIRED: ['owner', 'The project has no owner available for publication confirmation.', 'Ask a project administrator to restore the authorized owner binding before reviewing publication.'],
    PUBLICATION_ROUTE_NOT_EXECUTABLE: ['route', 'The task is not authorized for execution through this direct connector route.', 'Inspect the task publication mode and use its documented authorized route. Obtain owner approval where required; do not switch transports to bypass a block.'],
    PUBLICATION_NOT_DUE: ['schedule', 'The owner-released publication is scheduled for the future.', 'Wait until the authorized publication time, or have the owner review a schedule change and any required renewed release.'],
    PUBLICATION_STATE_CHANGED: ['task_state', 'The task state changed before this operation could claim it.', 'Read the current task, attempts and release before deciding the next action with the owner. Do not automatically repeat the request.'],
    VK_NATIVE_VIDEO_ADAPTER_UNSUPPORTED: ['adapter', 'This route cannot transport native VK video.', adapter],
    VK_PERSONAL_STORY_CONNECTOR_NOT_READY: ['connector', 'The VK personal-story connector lacks the required verified identity or connection.', adapter],
    VK_CONNECTOR_NOT_READY: ['connector', 'The VK connector lacks the required community identity or publication connection.', adapter],
    VK_MEDIA_CONNECTOR_NOT_READY: ['connector', 'The VK image connector lacks its required media-upload connection.', adapter],
    VK_TEXT_REQUIRED: ['text', 'The VK publication text is empty.', 'Prepare and accept the required text, then obtain release for that exact package through the documented adapter route.'],
    VK_STORY_MEDIA_REQUIRED: ['selected_asset', 'The VK personal story has no approved image.', 'Select and approve the story image, then review and release the package through the documented independent adapter.'],
    TELEGRAM_STORY_MEDIA_REQUIRED: ['selected_asset', 'The Telegram personal story has no approved image.', 'Select and approve the story image for the current revision, then obtain the required owner release.'],
    TELEGRAM_STORY_SEQUENCE_ADAPTER_UNAVAILABLE: ['adapter', 'The configured publisher has no Telegram story-sequence adapter.', 'Ask engineering to restore the supported adapter and reconcile any recorded attempt before requesting another operation. Do not use another transport as a bypass.'],
    TELEGRAM_TARGET_REQUIRED: ['channel', 'The Telegram channel has no configured destination.', 'Have the authorized operator configure and verify the intended destination, then review the channel and release bindings.'],
    MTPROTO_UNAVAILABLE: ['connector', 'No active Telegram MTProto session is available for this project.', 'Ask the authorized session operator to restore the project connection; never send session credentials in a diagnostic report. Reconcile any recorded attempt before proceeding.'],
    LINKEDIN_NATIVE_FORMAT_INVALID: ['content_format', 'The content failed the LinkedIn native-format validation.', 'Review the accepted content against the LinkedIn native-format contract, correct the format and obtain approval for the updated package.'],
    VK_INDEPENDENT_ADAPTER_REQUIRED: ['route', 'VK publication requires the registered independent adapter.', adapter],
    DZEN_INDEPENDENT_ADAPTER_REQUIRED: ['route', 'Dzen publication requires the registered independent adapter.', adapter],
    REDDIT_TITLE_REQUIRED: ['title', 'Reddit publication requires a title.', 'Provide and review the intended Reddit title before requesting an authorized publication.'],
    REDDIT_SUBREDDIT_REQUIRED: ['subreddit', 'Reddit publication requires a subreddit.', 'Select and verify the intended subreddit and its posting requirements before requesting an authorized publication.'],
    PUBLICATION_BROWSER_HANDOFF_REQUIRED: ['route', 'The task was handed off to its browser publication workflow; this is not provider publication success.', 'Inspect the existing browser work item, owner release and adapter readiness through the documented Planner workflow. This handoff grants no new publication permission; reconcile any existing attempt before proceeding.'],
    PUBLICATION_OWNED_ROUTE_REQUIRED: ['route', 'This owned task requires its documented governed publication command.', 'Use the required command with the current task-owned release and authorization. Do not use the generic dispatcher, change bindings or bypass an existing attempt.'],
    PUBLICATION_WAITING: ['task_state', 'The publication route is waiting and has not executed this request.', 'Read the current task readiness, schedule, release and attempts with the owner. Resolve the recorded prerequisite before requesting another operation.'],
    PUBLICATION_PREREQUISITE_NOT_READY: ['readiness', 'The dispatcher skipped publication because a prerequisite is not ready; this result does not establish which prerequisite failed.', 'Inspect the task visual readiness, dependency and blocking-condition records through the protected project workflow. Resolve the recorded blocker with the owner before another operation.'],
    VISUAL_GATE_BLOCKED: ['visual_readiness', 'The publication visual-readiness gate did not pass.', 'Inspect the task visual-review requirements, correct the selected asset or its review and obtain release for the updated accepted package. Do not bypass the visual gate.'],
    PUBLICATION_DEPENDENCY_BLOCKED: ['dependencies', 'The publication dependencies or blocking conditions are not satisfied.', 'Read the task dependencies and blocking conditions with the owner, resolve the prerequisite through its supported workflow and review the task state before another operation.'],
    PUBLICATION_ALREADY_PUBLISHED: ['publication_fact', 'This task is already published.', 'Read the existing publication fact and permalink. Do not resend this task; corrections require the documented owner-approved correction workflow.'],
    PUBLICATION_STATUS_NOT_EXECUTABLE: ['task_state', 'The current task status does not permit publication execution.', 'Read the current task and attempt history with the owner. Complete the supported review or recovery workflow; do not force status changes or bypass a pending attempt.'],
    THREADS_CONNECTOR_NOT_READY: ['connector', 'The Threads channel lacks its required account identity or publication connection.', 'Ask the authorized account operator to configure and verify the project Threads connection using protected account settings. Do not put credentials in diagnostics; review release bindings after account changes.'],
    LINKEDIN_CONNECTOR_NOT_READY: ['connector', 'The LinkedIn channel lacks its required account identity or publication connection.', 'Ask the authorized account operator to configure and verify the LinkedIn identity and protected publication connection, then review channel and release bindings.'],
    OK_CONNECTOR_NOT_READY: ['connector', 'The Odnoklassniki channel lacks one or more required account, application or group settings.', 'Ask the authorized account operator to verify the protected application credentials, account connection and intended group. Never paste credentials into an error report.'],
    PUBLICATION_CHANNEL_UNAVAILABLE: ['channel', 'The requested active channel was not found in the selected project.', 'Verify the intended channel and active status within the authorized project. Ask its administrator to repair the binding; do not select another tenant or fallback destination.'],
    PUBLICATION_CHANNEL_UNSUPPORTED: ['channel', 'Direct MCP publication does not support the selected channel type.', 'Use the documented supported publication command for the intended channel. Keep the operation blocked if no authorized adapter is available and request engineering support.'],
    TELEGRAM_TEXT_REQUIRED: ['text', 'Telegram publication text is empty.', 'Prepare and accept the required Telegram text, then obtain any required release for that exact package.'],
    OWNER_REQUIRED: ['owner', 'This operation requires the authorized project owner.', 'Use the authenticated project owner identity and its scoped documented command; do not change actor arguments to bypass authorization.'],
    MCP_PROJECT_SCOPE_MISMATCH: ['project', 'The selected project does not match the authorized command scope.', 'Verify the authenticated project scope and use the supported command for that project.'],
    STALE_MANIFEST: ['manifest', 'The supplied manifest is not the pinned accepted manifest.', 'Read the current manifest and ask the owner to review any changes. Do not silently rebind approval or send with a stale manifest.'],
    DZEN_TASK_SCOPE_MISMATCH: ['task', 'The task is outside the released Dzen command scope.', 'Verify the intended task and documented release scope with the owner. Do not create task-specific code or change bindings to bypass the scope.'],
    DZEN_TASK_MISMATCH: ['task', 'The Dzen task does not match the required accepted publication package.', 'Read the current task and required package with the owner, correct review or release through the documented route, and preserve existing attempts.'],
    DZEN_OWNER_RELEASE_PROOF_MISMATCH: ['owner_release', 'The Dzen owner-release proof did not match the required package.', 'Ask the owner to inspect the release and current accepted package, then correct the selected proof or obtain a reviewed release. Do not edit audit history.'],
    DZEN_CONNECTOR_NOT_READY: ['connector', 'The required Dzen connector readiness evidence is missing, stale or invalid.', 'Use the documented Planner preflight through the registered independent adapter to inspect the exact readiness blocker. A stale proof does not establish a session failure. Keep blocked and request repair; no browser or API fallback.'],
    DZEN_CONNECTOR_PREFLIGHT_GUARD_FAILED: ['preflight', 'The Dzen connector preflight prerequisites did not pass.', 'Read the task, accepted-package bindings and preflight requirements through the documented independent adapter route. Correct the prerequisite with the owner before requesting preflight again.'],
    DZEN_PROVIDER_IDENTITY_MISMATCH: ['provider_identity', 'The Dzen provider identity does not match the expected channel.', 'Ask the authorized independent-adapter operator to verify the intended channel identity and connection. Keep blocked; do not use another session or route as a bypass.'],
    DZEN_PUBLICATION_STATE_CHANGED: ['task_state', 'The Dzen task is no longer in an allowed publication state.', 'Read the current task, release and attempts with the owner. Reconcile any outstanding attempt before deciding a supported next operation.'],
    DZEN_RETRY_NOT_AUTHORIZED: ['publication_attempt', 'The Dzen retry is not authorized for the existing attempt and operation key.', 'Reconcile the frozen existing attempt through the documented independent adapter and owner workflow. Do not resend, invent a new key or bypass the retry guard.'],
    PUBLICATION_REQUEST_FAILED: ['publication', 'The publication request failed; the exact cause has not been established safely.', `Ask engineering to inspect the protected service diagnostics. ${reconcile}`]
};
for (const code of ['TELEGRAM_PUBLICATION_UNCERTAIN', 'VK_PUBLICATION_UNCERTAIN', 'PUBLICATION_ATTEMPT_UNCERTAIN',
    'PUBLICATION_ALREADY_CLAIMED', 'PUBLICATION_IDENTITY_MISSING', 'LINKEDIN_PROVIDER_ID_MISSING', 'DZEN_PUBLICATION_ALREADY_CLAIMED', 'DZEN_PUBLICATION_UNCERTAIN', 'DZEN_FACT_PENDING']) {
    catalog[code] = ['publication_attempt', code === 'PUBLICATION_ALREADY_CLAIMED'
        ? 'Another operation has already claimed this publication.'
        : 'The publication result or stable provider identity is unresolved.', reconcile];
}
function diagnostic(code: string): PublicationDiagnostic {
    const [field, message, action] = catalog[code]!;
    return { code, message, reasons: [{ code, field, message, action }], retry_allowed: false };
}
/** Recognizes only reviewed local guard prefixes/exact legacy strings; never echoes provider error text. */
export function diagnoseDirectPublicationError(error: unknown): PublicationDiagnostic {
    const message = error instanceof Error ? error.message : '';
    const code = /^\[([A-Z][A-Z0-9_]+)\](?:\s|$)/.exec(message)?.[1];
    const exactConfigurationErrors: Record<string, string> = {
        'Threads channel config is missing threads_user_id or access_token': 'THREADS_CONNECTOR_NOT_READY',
        'LinkedIn channel config is missing linkedin_urn or access_token': 'LINKEDIN_CONNECTOR_NOT_READY',
        'Telegram channel config is missing telegram_channel_id or public handle': 'TELEGRAM_TARGET_REQUIRED',
        'Odnoklassniki channel config is missing access_token, application_key, application_secret_key, or group_id': 'OK_CONNECTOR_NOT_READY',
        'VK channel config is missing vk_id or api_key': 'VK_CONNECTOR_NOT_READY',
        'Task is blocked by a deferred dependency': 'PUBLICATION_DEPENDENCY_BLOCKED',
        'Task is blocked by a skipped dependency': 'PUBLICATION_DEPENDENCY_BLOCKED',
        'Task dependencies are not satisfied yet': 'PUBLICATION_DEPENDENCY_BLOCKED',
        'Task is waiting on blocking conditions': 'PUBLICATION_DEPENDENCY_BLOCKED',
        'This publication task is already published': 'PUBLICATION_ALREADY_PUBLISHED'
    };
    if (Object.prototype.hasOwnProperty.call(exactConfigurationErrors, message)) return diagnostic(exactConfigurationErrors[message]!);
    const templates: readonly (readonly [RegExp, string])[] = [
        [/^Publication task [1-9]\d* not found$/, 'PUBLICATION_TASK_NOT_FOUND'],
        [/^This publication task cannot be executed from status '(?:draft|ready|scheduled|review|pending|accepted|approved|publishing|published|failed|blocked|deferred|skipped|cancelled|rejected|needs_review)'$/, 'PUBLICATION_STATUS_NOT_EXECUTABLE'],
        [/^Threads channel [1-9]\d* is missing threads_user_id or access_token$/, 'THREADS_CONNECTOR_NOT_READY'],
        [/^LinkedIn channel [1-9]\d* is missing linkedin_urn or access_token$/, 'LINKEDIN_CONNECTOR_NOT_READY'],
        [/^Odnoklassniki channel [1-9]\d* is missing access_token, application_key, application_secret_key, or group_id$/, 'OK_CONNECTOR_NOT_READY'],
        [/^VK channel [1-9]\d* is missing vk_id or api_key$/, 'VK_CONNECTOR_NOT_READY'],
        [/^VK channel [1-9]\d* requires user_access_token to upload an image$/, 'VK_MEDIA_CONNECTOR_NOT_READY'],
        [/^Channel [1-9]\d* not found or inactive for project [1-9]\d*$/, 'PUBLICATION_CHANNEL_UNAVAILABLE'],
        [/^No active channel of type '(?:telegram|reddit|threads|linkedin|vk|ok|odnoklassniki|habr|habr_article|vc|vc_article|zen|zen_article|dzen)' found for project [1-9]\d*$/, 'PUBLICATION_CHANNEL_UNAVAILABLE'],
        [/^Direct MCP publication is not supported for channel type '(?:telegram|reddit|threads|linkedin|vk|ok|odnoklassniki|habr|habr_article|vc|vc_article|zen|zen_article|dzen)'$/, 'PUBLICATION_CHANNEL_UNSUPPORTED']
    ];
    if (!/[\r\n]/.test(message)) {
        for (const [pattern, templateCode] of templates) if (pattern.test(message)) return diagnostic(templateCode);
    }

    if (code && Object.prototype.hasOwnProperty.call(catalog, code)) return diagnostic(code);
    if (message === 'Either `channelId` or `channelType` must be provided') return { code: 'PUBLICATION_CHANNEL_REQUIRED', message: 'A publication channel must be selected.', reasons: [{code: 'PUBLICATION_CHANNEL_REQUIRED', field: 'channel', message: 'No channel selection was supplied.', action: 'Select an active channel belonging to the authorized project and review its release bindings.'}], retry_allowed: false };
    if (message === 'Missing Reddit credentials') return { code: 'REDDIT_CONNECTOR_NOT_READY', message: 'The Reddit connector lacks required credentials.', reasons: [{code: 'REDDIT_CONNECTOR_NOT_READY', field: 'connector', message: 'Required Reddit connector credentials are missing.', action: 'Ask the authorized account operator to configure the project Reddit connection through the protected configuration interface; do not send credentials in error reports.'}], retry_allowed: false };
    if (message === '`title` is required for Reddit publication') return diagnostic('REDDIT_TITLE_REQUIRED');
    if (message === '`subreddit` is required for Reddit publication') return diagnostic('REDDIT_SUBREDDIT_REQUIRED');
    return diagnostic('PUBLICATION_REQUEST_FAILED');
}
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function enumValue(value: unknown, options: readonly string[]): string | null {
    return typeof value === 'string' && options.includes(value) ? value : null;
}
type SafeTelegramRouteTrace = { eligibility: { mtproto: boolean; bot_api_fallback: boolean; reason_code: string | null }; session_target: { configured: boolean }; target: { source: string | null }; asset_resolution: { has_asset: boolean; server_resolvable: boolean; source: string | null; kind: string | null; reason_code: string | null }; final_adapter: string };
/** Preserves reviewed route semantics and removes raw errors, destinations and session identifiers. */
export function sanitizeTelegramRouteTrace(value: unknown): SafeTelegramRouteTrace | null {
    const raw = record(value), trace = 'routeTrace' in raw ? record(raw.routeTrace) : raw;
    if (!('eligibility' in trace) || !('final_adapter' in trace)) return null;
    const eligibility = record(trace.eligibility), asset = record(trace.asset_resolution);
    return {
        eligibility: { mtproto: eligibility.mtproto === true, bot_api_fallback: eligibility.bot_api_fallback === true,
            reason_code: enumValue(eligibility.reason_code, ['project_session_missing', 'session_connection_failed', 'session_lookup_failed']) },
        session_target: { configured: record(trace.session_target).configured === true },
        target: { source: enumValue(record(trace.target).source, ['telegram_channel_id', 'channel_handle', 'bot_api_handle_resolution', 'local_test_override', 'missing']) },
        asset_resolution: { has_asset: asset.has_asset === true, server_resolvable: asset.server_resolvable === true,
            source: enumValue(asset.source, ['normalized_input', 'none']),
            kind: enumValue(asset.kind, ['https_url', 'http_url', 'data_uri', 'local_path', 'none']),
            reason_code: enumValue(asset.reason_code, ['asset_non_server_resolvable']) },
        final_adapter: enumValue(trace.final_adapter, ['not_dispatched', 'mtproto', 'bot_api']) || 'not_dispatched'
    };
}
/** Adds safe diagnostics to returned denials. Successful legacy payloads remain unchanged. */
export function projectDirectPublicationResult(value: unknown): { payload: Record<string, unknown>; diagnostic?: PublicationDiagnostic; isError?: boolean } {
    const result = record(value);
    const status = enumValue(result.status, ['draft', 'ready', 'scheduled', 'review', 'pending', 'accepted', 'approved', 'publishing', 'published', 'failed', 'blocked', 'deferred', 'skipped', 'cancelled', 'rejected', 'needs_review', 'browser_required']);
    if (result.browserRequired === true || result.mode === 'browser') {
        const nested = record(result.reason);
        const code = nested.code === 'CONNECTOR_ATTEMPT_STALE' ? 'PUBLICATION_ATTEMPT_UNCERTAIN' : 'PUBLICATION_BROWSER_HANDOFF_REQUIRED';
        return { payload: { success: result.success === true, mode: 'browser', browserRequired: true,
            ...(status ? {status} : {}), adapter: enumValue(result.adapter, ['telegram','threads','reddit','linkedin','ok','odnoklassniki','habr','habr_article','vc','vc_article','medium','setka','x','tilda']) }, diagnostic: diagnostic(code), isError: result.success !== true || code === 'PUBLICATION_ATTEMPT_UNCERTAIN' };
    }
    if (result.reason === 'exact_owned_task_route_required') {
        const command = typeof result.required_command === 'string' && /^ba_[a-z0-9_]+$/.test(result.required_command) && !/[\r\n]/.test(result.required_command) ? result.required_command : null;
        return {payload: {success:false,blocked:true,provider_execution:'blocked',route_executable:false,
            reason:'exact_owned_task_route_required', ...(status ? {status} : {}), ...(command ? {required_command:command} : {})}, diagnostic: diagnostic('PUBLICATION_OWNED_ROUTE_REQUIRED')};
    }
    if (result.skipped === true && result.success === false) {
        const code = result.reason === 'already_claimed' ? 'PUBLICATION_ALREADY_CLAIMED'
            : result.reason === 'published' ? 'PUBLICATION_ALREADY_PUBLISHED'
            : result.reason === 'waiting' ? 'PUBLICATION_WAITING' : 'PUBLICATION_PREREQUISITE_NOT_READY';
        return {payload: {success:false,skipped:true,...(status ? {status} : {})},diagnostic:diagnostic(code)};
    }
    if (result.success === false || result.blocked === true || result.mode === 'blocked') {
        const code = result.reason === 'vk_adapter_required' ? 'VK_INDEPENDENT_ADAPTER_REQUIRED'
            : result.reason === 'dzen_adapter_required' ? 'DZEN_INDEPENDENT_ADAPTER_REQUIRED' : 'PUBLICATION_REQUEST_FAILED';
        const channel = record(result.channel);
        const projectId = safeIntegerOrNull(result.project_id), channelId = safeIntegerOrNull(channel.id);
        const channelType = enumValue(channel.type, ['vk', 'dzen', 'zen', 'zen_article']);
        const context = code !== 'PUBLICATION_REQUEST_FAILED' ? { ...(projectId !== null && projectId > 0 ? {project_id: projectId} : {}), ...(channelId !== null && channelId > 0 && channelType ? {channel: {id: channelId, type: channelType}} : {}) } : {};
        return { payload: { success: false, ...context, ...(code !== 'PUBLICATION_REQUEST_FAILED' ? { blocked: true, provider_execution: 'blocked', route_executable: false, reason: code === 'VK_INDEPENDENT_ADAPTER_REQUIRED' ? 'vk_adapter_required' : 'dzen_adapter_required', adapter_requirement: code === 'VK_INDEPENDENT_ADAPTER_REQUIRED' ? vkPublicationAdapterRequired() : dzenPublicationAdapterRequired() } : {}),
            ...(typeof result.mode === 'string' && ['blocked', 'dry_run'].includes(result.mode) ? {mode: result.mode} : {}) }, diagnostic: diagnostic(code) };
    }
    return { payload: result };
}

function safeIntegerOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}
function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}
/** Successful route context retains typed destination metadata, but never raw provider errors or session hints. */
export function projectSuccessfulTelegramTrace(value: unknown): Record<string, unknown> {
    const result = record(value);
    if (!('route_trace' in result)) return result;
    const trace = record(result.route_trace), safe = sanitizeTelegramRouteTrace(trace);
    if (!safe) return { ...result, route_trace: null };
    const session = record(trace.session_target), target = record(trace.target);
    return { ...result, route_trace: {
        ...safe,
        eligibility: { ...safe.eligibility, reason: null },
        session_target: { ...safe.session_target, project_id: safeIntegerOrNull(session.project_id),
            account_id: safeIntegerOrNull(session.account_id) },
        target: { ...safe.target, value: stringOrNull(target.value), configured_channel_id: stringOrNull(target.configured_channel_id),
            configured_handle: stringOrNull(target.configured_handle), matched_channel_id: safeIntegerOrNull(target.matched_channel_id) },
        asset_resolution: { ...safe.asset_resolution, resolved_url: null },
        fallback_reason: null
    } };
}
