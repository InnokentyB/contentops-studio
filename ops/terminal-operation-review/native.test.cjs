const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'native.cjs'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const {canonicalArgumentsSha256}=require('../terminal-external-census-20261026/census.cjs');
const snapshot={projectId:7,taskId:123,contentRevision:1},binding={projectId:7,taskId:123,attemptId:456,workItemId:789,actorId:'user:17',keySha256:sha('key'),leaseSha256:sha('lease'),snapshotSha256:canonicalArgumentsSha256(snapshot)};
const args={projectId:7,taskId:123,workItemId:789,actorId:'user:17',idempotencyKey:'key',leaseToken:'lease',snapshot,approvalReference:'synthetic',apply:false};
const meta={turn_id:'turn'},response=(ordinal,type,payload)=>({ordinal,type:'response_item',payload:{type,...payload}}),event=(ordinal,item)=>({ordinal,type:'event_msg',payload:{type:'item_completed',turn_id:'turn',thread_id:'thread',item}});
function records(){return [response(2,'custom_tool_call',{name:'exec',call_id:'outer',input:`text(await tools.mcp__synthetic_planner__ba_start_browser_submission(${JSON.stringify(args)}));`,internal_chat_message_metadata_passthrough:meta}),
 event(4,{type:'McpToolCall',id:'native-start',server:'synthetic_planner',tool:'ba_start_browser_submission',arguments:args,status:'completed',result:{content:[{type:'text',text:JSON.stringify({attempt_id:456,submission_permitted:false,retry_allowed:false})}]}}),
 response(6,'custom_tool_call_output',{call_id:'outer',output:'Script completed\nWall time: 0.1 seconds\nOutput:\nsynthetic'})];}
function run(rows=records()){
 assert.equal(fs.existsSync(file),true,'native binding extraction must exist');const index=require(file).createNativeSourceIndex({turnId:'turn',threadId:'thread',targetBinding:binding});for(const row of rows)index.observe(row);
 return index.finish({startOrdinal:1,endOrdinal:8,cuaCallIds:[]});
}
test('local extraction binds original start to actual native metadata and final exec envelope',()=>{
 const r=run();assert.equal(r.external[0].semantic.classification,'TARGET_START_ONLY');assert.equal(r.originalStartBinding.callId,'native-start');assert.equal(r.originalStartBinding.ordinal,4);assert.deepEqual(r.unaccountedNativeCallIds,[]);
 assert.doesNotMatch(JSON.stringify(r),/synthetic_planner|leaseToken|idempotencyKey|approvalReference|text\(await/);
});
test('an output alone without native start metadata cannot invent its server or result',()=>{
 const r=run(records().filter(row=>row.ordinal!==4));assert.equal(r.external[0].semantic.classification,'DENIED');assert.equal(r.originalStartBinding,null);
});
test('yielded exec, missing native arguments, false result or a failed leaf stays denied',()=>{
 for(const mutate of [rows=>rows[2].payload.output='Script running with cell ID 7',rows=>delete rows[1].payload.item.arguments,rows=>rows[1].payload.item.result.content[0].text=JSON.stringify({attempt_id:457,submission_permitted:false,retry_allowed:false}),rows=>rows[1].payload.item.status='failed']){
  const rows=records();mutate(rows);assert.equal(run(rows).external[0].semantic.classification,'DENIED');
 }
});
test('extra direct native capabilities cannot disappear outside the outer execution census',()=>{
 const rows=records();rows.push(event(7,{type:'McpToolCall',id:'outside',server:'other',tool:'unknown',arguments:{},status:'completed'}));assert.deepEqual(run(rows).unaccountedNativeCallIds,['outside']);
});
