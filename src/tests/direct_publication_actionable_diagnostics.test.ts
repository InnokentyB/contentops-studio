import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseDirectPublicationError, projectDirectPublicationResult, sanitizeTelegramRouteTrace, projectSuccessfulTelegramTrace } from '../services/direct_publication_error_diagnostics';
const guards = ['APPROVED_VISUAL_REQUIRED','APPROVED_VISUAL_NOT_SERVER_RESOLVABLE','ACCEPTED_REVISION_REQUIRED','SUPPORTED_PUBLICATION_TASK_REQUIRED','IDEMPOTENCY_KEY_REQUIRED','IDEMPOTENCY_KEY_CONFLICT','PUBLICATION_TASK_NOT_FOUND','OWNER_RELEASE_REQUIRED','OWNER_RELEASE_PROOF_MISMATCH','TELEGRAM_PERSONAL_STORY_SESSION_BINDING_MISMATCH','PROJECT_OWNER_REQUIRED','PUBLICATION_ROUTE_NOT_EXECUTABLE','PUBLICATION_NOT_DUE','PUBLICATION_STATE_CHANGED','VK_NATIVE_VIDEO_ADAPTER_UNSUPPORTED','VK_PERSONAL_STORY_CONNECTOR_NOT_READY','VK_CONNECTOR_NOT_READY','VK_MEDIA_CONNECTOR_NOT_READY','VK_TEXT_REQUIRED','VK_STORY_MEDIA_REQUIRED','TELEGRAM_STORY_MEDIA_REQUIRED','TELEGRAM_STORY_SEQUENCE_ADAPTER_UNAVAILABLE','TELEGRAM_TARGET_REQUIRED','MTPROTO_UNAVAILABLE','LINKEDIN_NATIVE_FORMAT_INVALID','VK_INDEPENDENT_ADAPTER_REQUIRED','DZEN_INDEPENDENT_ADAPTER_REQUIRED'];
for (const code of guards) test(`direct guard ${code} has static correction`, () => {
    const result = diagnoseDirectPublicationError(new Error(`[${code}] raw-secret-body-cookie`));
    assert.equal(result.code, code); assert.equal(result.reasons[0]?.code, code);
    assert.ok(result.reasons[0]?.action.length > 20); assert.equal(result.retry_allowed, false);
    assert.doesNotMatch(JSON.stringify(result), /raw-secret-body-cookie/);
});
for (const code of ['TELEGRAM_PUBLICATION_UNCERTAIN','VK_PUBLICATION_UNCERTAIN','PUBLICATION_ATTEMPT_UNCERTAIN','PUBLICATION_ALREADY_CLAIMED','PUBLICATION_IDENTITY_MISSING','LINKEDIN_PROVIDER_ID_MISSING']) test(`${code} requires reconciliation`, () => {
    const result = diagnoseDirectPublicationError(new Error(`[${code}] secret`));
    assert.equal(result.code, code); assert.match(result.reasons[0]!.action, /reconcil/i);
    assert.match(result.reasons[0]!.action, /Do not resend/); assert.equal(result.retry_allowed, false);
});
test('unknown errors never echo input or pretend a cause', () => {
    for (const error of [new Error('Reddit submit failed: secret-token'), 'secret-token', { message: 'secret-token' }, null]) {
        const result = diagnoseDirectPublicationError(error); assert.equal(result.code, 'PUBLICATION_REQUEST_FAILED');
        assert.match(result.reasons[0]!.action, /reconcil/i); assert.doesNotMatch(JSON.stringify(result), /secret-token/);
    }
});
test('safe legacy Reddit guards recognized without matching provider payloads', () => {
    assert.equal(diagnoseDirectPublicationError(new Error('`title` is required for Reddit publication')).code, 'REDDIT_TITLE_REQUIRED');
    assert.equal(diagnoseDirectPublicationError(new Error('`subreddit` is required for Reddit publication')).code, 'REDDIT_SUBREDDIT_REQUIRED');
    assert.equal(diagnoseDirectPublicationError(new Error('prefix [OWNER_RELEASE_REQUIRED]')).code, 'PUBLICATION_REQUEST_FAILED');
});
test('VK blocked result diagnosed and successful outcome preserved', () => {
    const result=projectDirectPublicationResult({success:false, reason:'vk_adapter_required', provider_payload:'secret'});
    assert.equal(result.diagnostic?.code,'VK_INDEPENDENT_ADAPTER_REQUIRED');
    assert.doesNotMatch(JSON.stringify(result),/secret/);
    assert.deepEqual(projectDirectPublicationResult({mode:'published'}).payload,{mode:'published'});
});
test('Telegram projection preserves reviewed semantics and removes raw data', () => {
    const result=sanitizeTelegramRouteTrace({eligibility:{mtproto:false,bot_api_fallback:true,reason_code:'session_connection_failed',reason:'secret'},final_adapter:'bot_api',fallback_reason:'secret',session_target:{configured:true,phone_hint:'secret'},asset_resolution:{has_asset:true,server_resolvable:false,reason_code:'asset_non_server_resolvable',resolved_url:'secret'},target:{source:'channel_handle',value:'secret'}});
    assert.equal(result?.eligibility.reason_code,'session_connection_failed'); assert.equal(result?.final_adapter,'bot_api');
    assert.doesNotMatch(JSON.stringify(result),/secret|phone_hint|resolved_url|fallback_reason/);
    assert.equal(sanitizeTelegramRouteTrace(null),null);
});

for (const code of ['DZEN_TASK_SCOPE_MISMATCH','DZEN_TASK_MISMATCH','DZEN_OWNER_RELEASE_PROOF_MISMATCH','DZEN_CONNECTOR_NOT_READY','DZEN_CONNECTOR_PREFLIGHT_GUARD_FAILED','DZEN_PROVIDER_IDENTITY_MISMATCH','DZEN_PUBLICATION_STATE_CHANGED','DZEN_RETRY_NOT_AUTHORIZED','DZEN_PUBLICATION_ALREADY_CLAIMED','DZEN_PUBLICATION_UNCERTAIN','DZEN_FACT_PENDING','OWNER_REQUIRED','MCP_PROJECT_SCOPE_MISMATCH','STALE_MANIFEST','TELEGRAM_TEXT_REQUIRED']) test(`extended direct guard ${code}`, () => {
    const result=diagnoseDirectPublicationError(new Error(`[${code}] secret`));
    assert.equal(result.code,code); assert.equal(result.retry_allowed,false); assert.doesNotMatch(JSON.stringify(result),/secret/);
});
test('unknown returned failure does not claim provider was blocked',()=>{
    const result=projectDirectPublicationResult({success:false,error:'secret'});
    assert.equal(result.diagnostic?.code,'PUBLICATION_REQUEST_FAILED');
    assert.equal(result.payload.provider_execution,undefined);
});

test('legacy static prerequisites are classified safely',()=>{
    assert.equal(diagnoseDirectPublicationError(new Error('Missing Reddit credentials')).code,'REDDIT_CONNECTOR_NOT_READY');
    assert.equal(diagnoseDirectPublicationError(new Error('Either `channelId` or `channelType` must be provided')).code,'PUBLICATION_CHANNEL_REQUIRED');
});
test('successful legacy response remains compatible and error traces require a recognized shape',()=>{
    const payload={mode:'published',route_trace:{session_target:{project_id:3}}};
    assert.deepEqual(projectDirectPublicationResult(payload),{payload});
    assert.equal(sanitizeTelegramRouteTrace({code:'secret'}),null);
});

test('successful Telegram trace preserves typed context and redacts provider errors',()=>{
    const payload={mode:'published',published_link:'https://t.me/test/1',route_trace:{
        eligibility:{mtproto:false,bot_api_fallback:true,reason_code:'session_connection_failed',reason:'secret-cookie',provider_payload:'secret-cookie'},
        session_target:{configured:true,project_id:3,account_id:4,phone_hint:'secret-cookie'},
        target:{source:'channel_handle',value:'@test',configured_channel_id:null,configured_handle:'@test',matched_channel_id:5},
        asset_resolution:{has_asset:false,source:'none',kind:'none',resolved_url:null,server_resolvable:true,reason_code:null},
        final_adapter:'bot_api',fallback_reason:'secret-cookie',provider_payload:'secret-cookie'}};
    const result=projectSuccessfulTelegramTrace(payload);
    assert.equal(result.published_link,payload.published_link);
    assert.equal((result.route_trace as Record<string,Record<string,unknown>>).session_target?.project_id,3);
    assert.equal((result.route_trace as Record<string,Record<string,unknown>>).session_target?.account_id,4);
    assert.doesNotMatch(JSON.stringify(result),/secret-cookie|provider_payload|phone_hint/);
    assert.equal(projectSuccessfulTelegramTrace({mode:'dry_run'}).mode,'dry_run');
});

for (const [message,code] of [
    ['Threads channel 42 is missing threads_user_id or access_token','THREADS_CONNECTOR_NOT_READY'],
    ['LinkedIn channel 42 is missing linkedin_urn or access_token','LINKEDIN_CONNECTOR_NOT_READY'],
    ['Odnoklassniki channel 42 is missing access_token, application_key, application_secret_key, or group_id','OK_CONNECTOR_NOT_READY'],
    ['VK channel 42 is missing vk_id or api_key','VK_CONNECTOR_NOT_READY'],
    ['VK channel 42 requires user_access_token to upload an image','VK_MEDIA_CONNECTOR_NOT_READY'],
    ['Channel 42 not found or inactive for project 17','PUBLICATION_CHANNEL_UNAVAILABLE'],
    ["No active channel of type 'linkedin' found for project 17",'PUBLICATION_CHANNEL_UNAVAILABLE'],
    ["Direct MCP publication is not supported for channel type 'linkedin'",'PUBLICATION_CHANNEL_UNSUPPORTED']
]) test(`known full-string connector template ${code}`,()=>{
    assert.equal(diagnoseDirectPublicationError(new Error(message)).code,code);
    assert.doesNotMatch(JSON.stringify(diagnoseDirectPublicationError(new Error(message))),/42|17/);
    for(const suffix of [' secret-cookie','\n','\nsecret-cookie']) {
        assert.equal(diagnoseDirectPublicationError(new Error(message+suffix)).code,'PUBLICATION_REQUEST_FAILED');
    }
});

for (const [message,code] of [
    ['Threads channel config is missing threads_user_id or access_token','THREADS_CONNECTOR_NOT_READY'],
    ['LinkedIn channel config is missing linkedin_urn or access_token','LINKEDIN_CONNECTOR_NOT_READY'],
    ['Telegram channel config is missing telegram_channel_id or public handle','TELEGRAM_TARGET_REQUIRED'],
    ['Odnoklassniki channel config is missing access_token, application_key, application_secret_key, or group_id','OK_CONNECTOR_NOT_READY'],
    ['VK channel config is missing vk_id or api_key','VK_CONNECTOR_NOT_READY']
]) test(`dispatcher exact prerequisite ${code}`,()=>{
    assert.equal(diagnoseDirectPublicationError(new Error(message)).code,code);
    for (const suffix of [' secret','\n']) assert.equal(diagnoseDirectPublicationError(new Error(message+suffix)).code,'PUBLICATION_REQUEST_FAILED');
});

test('adapter-required blocked payload retains scoped typed context without channel names',()=>{
    const result=projectDirectPublicationResult({success:false,reason:'vk_adapter_required',project_id:3,channel:{id:4,type:'vk',name:'secret'},arbitrary:'secret'});
    assert.equal(result.payload.project_id,3); assert.deepEqual(result.payload.channel,{id:4,type:'vk'});
    assert.doesNotMatch(JSON.stringify(result),/secret/);
    const invalid=projectDirectPublicationResult({success:false,reason:'vk_adapter_required',project_id:-3,channel:{id:'secret',type:'secret'}});
    assert.equal(invalid.payload.project_id,undefined); assert.equal(invalid.payload.channel,undefined);
});

for(const message of ['[VISUAL_GATE_BLOCKED] raw-secret','Task is blocked by a deferred dependency','Task is blocked by a skipped dependency','Task dependencies are not satisfied yet','Task is waiting on blocking conditions','This publication task is already published',"This publication task cannot be executed from status 'skipped'",'Publication task 42 not found']) test(`dispatcher guard ${message.split(' ')[0]}`,()=>{
    const result=diagnoseDirectPublicationError(new Error(message)); assert.notEqual(result.code,'PUBLICATION_REQUEST_FAILED'); assert.doesNotMatch(JSON.stringify(result),/raw-secret|42/);
});

for(const [value,code] of [
    [{success:true,mode:'browser',status:'browser_required',browserRequired:true,adapter:'linkedin',reason:{message:'secret'}},'PUBLICATION_BROWSER_HANDOFF_REQUIRED'],
    [{success:false,blocked:true,reason:'exact_owned_task_route_required',required_command:'ba_publish_owned_task',provider_execution:'blocked'},'PUBLICATION_OWNED_ROUTE_REQUIRED'],
    [{success:false,skipped:true,status:'ready',reason:'already_claimed'},'PUBLICATION_ALREADY_CLAIMED'],
    [{success:false,skipped:true,status:'ready',reason:'waiting'},'PUBLICATION_WAITING'],
    [{success:false,skipped:true,status:'ready'},'PUBLICATION_PREREQUISITE_NOT_READY']
] as const) test(`returned dispatcher outcome ${code}`,()=>{
    const result=projectDirectPublicationResult(value); assert.equal(result.diagnostic?.code,code);
    assert.doesNotMatch(JSON.stringify(result),/secret/);
    assert.equal(result.payload.success,value.success);
    if(code==='PUBLICATION_BROWSER_HANDOFF_REQUIRED') assert.equal(result.isError,false);
    if(code==='PUBLICATION_OWNED_ROUTE_REQUIRED') assert.equal(result.payload.required_command,'ba_publish_owned_task');
});
test('invalid required command and raw skip reason are not reflected',()=>{
    const result=projectDirectPublicationResult({success:false,reason:'exact_owned_task_route_required',required_command:'ba_send secret',error:'secret'});
    assert.equal(result.payload.required_command,undefined); assert.doesNotMatch(JSON.stringify(result),/secret/);
});
