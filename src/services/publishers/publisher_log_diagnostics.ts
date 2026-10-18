import { diagnoseDirectPublicationError } from '../direct_publication_error_diagnostics';
export type PublisherLogDiagnostic={code:string;message:string;action:string;retry_allowed:false};
type Template=readonly [RegExp,string,string,string];
const reconcile='Inspect the existing attempt and publication fact with the responsible operator. Reconcile an uncertain provider outcome before any further execution; do not resend or replace the operation key.';
const templates:readonly Template[]=[
 [/^\[Publisher\] Publishing to (?:Threads|VK|LinkedIn) for post \d+$/, 'PUBLISHER_SUBMISSION_STARTED','The publisher started processing a provider submission.',reconcile],
 [/^\[Publisher\] publishPostNow: calling MTProto for post \d+$/, 'PUBLISHER_SUBMISSION_STARTED','The publisher started processing a provider submission.',reconcile],
 [/^\[Publisher\] Successfully published post \d+ to (?:Threads|VK|LinkedIn|Telegram): /,'PUBLISHER_PUBLISHED','The adapter reported successful publication.','Verify the canonical publication fact and readback; this log does not independently establish provider success.'],
 [/^\[Publisher\] Published via MTProto Client: Message ID /,'PUBLISHER_PUBLISHED','The adapter reported successful publication.','Verify the canonical publication fact and provider readback.'],
 [/^\[Publisher\] Task \d+ is waiting on visual readiness\.$/,'PUBLISHER_WAITING_VISUAL','The task is waiting for its required visual.','Complete the visual review for the accepted revision and inspect release readiness.'],
 [/^\[Publisher\] Task \d+ is parked because a dependency is deferred\.$/,'PUBLISHER_DEPENDENCY_DEFERRED','Publication is parked because a dependency is deferred.','Inspect the dependency and resolve its approved schedule before reviewing this task.'],
 [/^\[Publisher\] Task \d+ is blocked because a dependency was skipped\.$/,'PUBLISHER_DEPENDENCY_SKIPPED','Publication is blocked because a dependency was skipped.','Ask the owner to review the skipped dependency and the resulting publication plan.'],
 [/^\[Publisher\] Task \d+ is waiting on blocking conditions\.$/,'PUBLISHER_WAITING_GUARDS','The task is waiting for blocking conditions to clear.','Read the task readiness diagnostics and resolve the observed prerequisites through their approved workflows.'],
 [/^\[Publisher\] Task \d+ was published but its canonical fact needs verification\.$/,'PUBLISHER_FACT_VERIFICATION_REQUIRED','The adapter reported publication but its canonical fact requires verification.',reconcile],
 [/^\[Publisher\] Processed publication task \d+ \([a-z_]+\) via automated adapter\.$/,'PUBLISHER_TASK_PROCESSED','The automated adapter finished processing a publication task.','Inspect the recorded task outcome and canonical publication fact; processing alone does not establish publication.'],
 [/^\[Publisher\] Connector failed for task \d+; routed to browser publication\.$/,'PUBLISHER_CONNECTOR_ROUTE_CHANGED','The existing dispatcher reported a connector failure and route change.','Inspect the audited route and applicable platform policy. For VK/Dzen keep blocked and repair the registered independent adapter; no browser/API/manual fallback.'],
 [/^\[Publisher\] Failed to (?:publish post \d+ to (?:Threads|VK|LinkedIn):|process publication task \d+|natively schedule post \d+:)/,'PUBLISHER_EXECUTION_FAILED','The publisher reported an execution failure; the exact provider cause is not established.',reconcile],
 [/^(?:Threads config missing user_id\/token|VK config missing id\/key|LinkedIn config missing urn\/token|Telegram channel config missing ID) for post \d+/,'PUBLISHER_CONFIGURATION_MISSING','The adapter reported missing required connection or destination configuration.','Ask the authorized administrator to repair protected connector configuration and verify the approved identity; never share credentials in diagnostics.'],
 [/^Channel not found or config missing for post \d+$/,'PUBLISHER_CHANNEL_UNAVAILABLE','The publication channel or its configuration is unavailable.','Inspect the tenant-owned channel and ask its administrator to restore the intended binding.'],
 [/^\[Publisher\] Fallback resolved Telegram handle from name\/ref: /,'PUBLISHER_TARGET_RESOLVED','The Telegram adapter resolved a destination handle.','Verify that the resolved destination matches the approved tenant-owned channel.'],
 [/^\[Publisher\] Telegram HTML message failed, retrying as plain text\.$/,'PUBLISHER_TEXT_FORMAT_FALLBACK','The Telegram adapter reported its existing plain-text formatting fallback.','Inspect the resulting attempt and accepted text; reconcile uncertain delivery before any manual repeat.'],
 [/^\[Publisher\] Failed to resolve Telegram handle to chat id\.$/,'PUBLISHER_TARGET_RESOLUTION_FAILED','The Telegram destination handle could not be resolved.','Verify the configured tenant-owned destination and authorized account access through protected settings.'],
 [/^\[Publisher\] 🚧 LOCAL DEV: redirecting post \d+ from /,'PUBLISHER_DEVELOPMENT_REDIRECT','The publisher reported a development destination override.','Verify synthetic environment isolation and intended test destination before further execution.'],
 [/^\[Publisher\] Reset \d+ stuck 'publishing' posts back to 'scheduled'\.$/,'PUBLISHER_LEGACY_STATE_RESET','The legacy publisher reported resetting stuck publication states.',reconcile],
 [/^\[Publisher\] Failed to reset stuck publishing posts:$/,'PUBLISHER_LEGACY_RESET_FAILED','The legacy publisher could not complete its state reset.','Ask engineering to inspect persisted states and reconcile existing attempts before scheduling further execution.'],
 [/^\[Publisher\] Found \d+ posts due \(or past due\) for publishing\.$/,'PUBLISHER_DUE_ITEMS_FOUND','The publisher found due publication work.','Inspect the approved schedule and publication gates; discovery is not submission authority.'],
 [/^\[Publisher\] Checking \d+ future posts for native scheduling\.\.\.$/,'PUBLISHER_SCHEDULE_CHECK','The publisher is checking future scheduling work.','Inspect the approved schedule and current attempt history before any operator action.'],
 [/^\[Publisher\] Scheduled natively via MTProto: Message ID /,'PUBLISHER_NATIVE_SCHEDULED','The Telegram adapter reported native scheduling.','Verify the recorded provider schedule and reconcile its outcome before creating another scheduled item.'],
 [/^LEGACY_PUBLICATION_BINDING_HELD$/,'PUBLISHER_LEGACY_BINDING_HELD','The legacy publication binding is held.','Inspect the canonical task and its owner release instead of bypassing the legacy hold.'],
 [/^VK_INDEPENDENT_ADAPTER_REQUIRED$/,'PUBLISHER_INDEPENDENT_ADAPTER_REQUIRED','VK publication requires the registered independent adapter.','Keep blocked and repair the documented Planner to registered adapter route; no browser/API/manual fallback.']
];
/** Classifies only reviewed templates/codes; raw message, data and provider values are never emitted. */
export function publisherLogDiagnostic(message:string,data?:unknown):PublisherLogDiagnostic {
 if(data instanceof Error&&/^\[[A-Z][A-Z0-9_]+\]/.test(data.message)){
  const diagnostic=diagnoseDirectPublicationError(data);
  if(diagnostic.code!=='PUBLICATION_REQUEST_FAILED')return {code:diagnostic.code,message:diagnostic.message,action:diagnostic.reasons[0]!.action,retry_allowed:false};
 }
 if(!/[\r\n]/.test(message))for(const [pattern,code,summary,action] of templates){
  if(pattern.test(message))return {code,message:summary,action,retry_allowed:false};
 }
 return {code:'PUBLISHER_EVENT_UNCLASSIFIED',message:'The publisher emitted an event whose exact meaning is not safely classified.',action:`Ask engineering to classify this event using protected diagnostics. ${reconcile}`,retry_allowed:false};
}
