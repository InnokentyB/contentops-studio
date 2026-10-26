const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {review}=require(path.join(process.env.SHARED_BROWSER_DIST||'/opt/planner/dist','../ops/terminal-operation-review/review.cjs'));
const args=JSON.stringify({code:'var b=await cua.getBrowser("synthetic"); var t=await b.createBrowserTab("https://www.linkedin.com/company/synthetic/admin/page-posts/published/"); await t.getAXState();',title:'sensitive-local-only'});
const scope={threadId:'thread',turnId:'turn',browserId:'synthetic',profileUrl:'https://www.linkedin.com/company/synthetic/admin/page-posts/published/'};
function rows(extra){return [{ordinal:1,timestamp:'2026-10-25T10:00:00.000Z',type:'event_msg',payload:{type:'task_started',turn_id:'turn'}},
 {ordinal:2,type:'response_item',payload:{type:'function_call',namespace:'mcp__cua_repl',name:'js',call_id:'op',internal_chat_message_metadata_passthrough:{turn_id:'turn'},arguments:args}},
 {ordinal:3,type:'event_msg',payload:{type:'item_completed',turn_id:'turn',thread_id:'thread',started_at_ms:1,completed_at_ms:2,item:{type:'McpToolCall',server:'cua_repl',tool:'js',id:'op',status:'completed'}}},
 ...(extra?[{ordinal:4,type:'response_item',payload:{...extra,call_id:'outside',internal_chat_message_metadata_passthrough:{turn_id:'turn'}}}]:[]),
 {ordinal:extra?5:4,timestamp:'2026-10-25T10:00:01.000Z',type:'event_msg',payload:{type:'task_complete',turn_id:'turn'}}].map(r=>JSON.stringify(r))}
test('local producer keeps raw programs local and emits non-authoritative typed observations',async()=>{
 const result=await review(rows(),scope);assert.equal(result.operations[0].classification,'SUPPORTED_READ_ONLY');
 assert.equal(result.submissionPermitted,false);assert.equal(result.custodyGranted,false);assert.doesNotMatch(JSON.stringify(result),/sensitive-local-only|await cua|argumentsJson/);
});
test('local producer accounts for function AND custom-tool external transports',async()=>{
 for(const type of ['function_call','custom_tool_call']){const result=await review(rows({type,name:'exec_command',arguments:'sensitive command',input:'sensitive command'}),scope);assert.equal(result.external.length,1);assert.equal(result.external[0].classification,'UNREVIEWED_EXTERNAL_TRANSPORT');assert.doesNotMatch(JSON.stringify(result),/sensitive command/)}
});
test('local source shapes expose only known methods and argument types, never source literals or arbitrary names',async()=>{
 const input=rows().map(line=>JSON.parse(line));input[1].payload.arguments=JSON.stringify({code:'var localSecretName=await cua.createBrowserTab("synthetic","'+scope.profileUrl+'",{sessionName:"private-session-name"}); await localSecretName.getAXState();',title:'private-title'});
 const result=await review(input.map(row=>JSON.stringify(row)),scope),shapes=result.operations[0].shapes;
 assert.equal(result.operations[0].classification,'SUPPORTED_READ_ONLY');
 assert.equal(shapes[0].method,'createBrowserTab');assert.equal(shapes[0].receiver,'cua');assert.deepEqual(shapes[0].arguments[2].keys,['sessionName']);
 assert.doesNotMatch(JSON.stringify(result),/private-session-name|localSecretName|private-title|https:|await cua/);
});
test('external structural diagnostics do not grant authority or export literals and unknown method names',async()=>{
 const result=await review(rows({type:'custom_tool_call',name:'exec',input:'const secret=await tools.mcp__synthetic__ba_get_publication_task({taskId:12345}); text(secret); privateCallable("private-value")'}),scope);
 assert.equal(result.external[0].classification,'UNREVIEWED_EXTERNAL_TRANSPORT');
 assert.equal(result.external[0].shapes[0].method,'ba_get_publication_task');
 assert.equal(result.external[0].shapes[2].method,'UNRECOGNIZED');
 assert.doesNotMatch(JSON.stringify(result),/secret|synthetic__|12345|privateCallable|private-value/);
});
test('a call inside the original window cannot disappear because its turn binding is missing',async()=>{
 const input=rows({type:'custom_tool_call',name:'exec',input:'text("control")'}).map(line=>JSON.parse(line));delete input[3].payload.internal_chat_message_metadata_passthrough;
 await assert.rejects(()=>review(input.map(row=>JSON.stringify(row)),scope),/TERMINAL_SOURCE_SCOPE_INCOMPLETE/);
});
