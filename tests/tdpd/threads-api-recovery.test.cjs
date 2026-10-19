const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
require('ts-node/register/transpile-only');const base=process.env.THREADS_SOURCE||'/source/src';
const {digest,verifyThreadsRecovery}=require(path.join(base,'services/threads_api_contract.ts'));
const {reserveThreadsRead,threadsPhaseJournal,assertThreadsFinalizer}=require(path.join(base,'services/threads_api_store.ts'));
const start=new Date('2026-10-19T10:00:00Z'),end=new Date('2026-10-19T10:00:10Z');
const snapshot={projectId:61,taskId:62,channelId:63,actorId:'user:64',manifestChecksum:'sha256:'+'a'.repeat(64),revision:1,
 bodySha256:digest('accepted'),releaseKey:'release',releaseSha256:'b'.repeat(64),userId:'789',username:'tester'};
const post={id:'123',username:'tester',text:'accepted',permalink:'https://www.threads.net/@tester/post/abc',timestamp:'2026-10-19T10:00:01Z',media_type:'TEXT_POST',is_reply:false};
function fixture(overrides={}){
 const row={id:1,project_id:61,content_item_id:62,attempt_id:65,transport:'threads_api',contract_version:1,row_version:0,generation:1,
 state:'provider_id_recorded',package_sha256:snapshot.bodySha256,release_sha256:snapshot.releaseSha256,snapshot,
 post_id:'123',container_id:'456',publish_started_at:start,observed_at:end,rounds:0,requests_used:0,deadline_at:null,
 lease_sha256:null,lease_expires_at:null,next_read_at:null,...overrides};
 const match=where=>Object.entries(where).every(([k,v])=>v===undefined||row[k]===v);
 const tx={apiDeliveryRecovery:{findFirst:async({where})=>match(where)?{...row}:null,updateMany:async({where,data})=>{
 if(!match(where))return {count:0};for(const[k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+v.increment:v;return{count:1};}},
 publicationFact:{findFirst:async()=>null},workflowEvent:{create:async()=>({id:1})}};
 return{row,tx,scope:{projectId:61,taskId:62,attemptId:65}};
}
test('T04 known-object full identity verifies',()=>assert.equal(verifyThreadsRecovery({id:'789',username:'tester'},post,snapshot,'123',start,end).id,'123'));
for(const[field,value]of [['id','124'],['text','changed'],['username','other'],['media_type','IMAGE'],['is_reply',true],['timestamp','2026-10-20T10:00:00Z'],['permalink','https://www.threads.net/@tester/post/abc?token=secret']]){
 test('T06 mismatched '+field+' cannot confirm',()=>assert.throws(()=>verifyThreadsRecovery({id:'789',username:'tester'},{...post,[field]:value},snapshot,'123',start,end),/READBACK_MISMATCH/));
}
test('T06 original account is mandatory',()=>assert.throws(()=>verifyThreadsRecovery({id:'999',username:'tester'},post,snapshot,'123',start,end),/ACCOUNT_MISMATCH/));
test('T05 missing original ID never schedules provider read',async()=>{const f=fixture({post_id:null});await assert.rejects(reserveThreadsRead(f.tx,f.scope,end.getTime()),/IDENTITY_UNAVAILABLE/);assert.equal(f.row.requests_used,0);});
test('T08 durable budget, backoff and active lease survive reinvocation',async()=>{
 const f=fixture();const a=await reserveThreadsRead(f.tx,f.scope,end.getTime());assert.ok(a.lease);assert.equal(f.row.requests_used,2);assert.equal(f.row.rounds,1);
 await assert.rejects(reserveThreadsRead(f.tx,f.scope,end.getTime()+1),/IN_PROGRESS/);
 f.row.lease_sha256=null;f.row.lease_expires_at=null;
 await assert.rejects(reserveThreadsRead(f.tx,f.scope,end.getTime()+1),/BACKOFF/);
 f.row.rounds=3;await assert.rejects(reserveThreadsRead(f.tx,f.scope,end.getTime()+40_000),/BUDGET_EXHAUSTED/);
 assert.equal(f.row.requests_used,2);
});
test('T07 wrong tenant reads nothing',async()=>{const f=fixture();await assert.rejects(reserveThreadsRead(f.tx,{...f.scope,projectId:99},end.getTime()),/CAPABILITY_UNAVAILABLE/);assert.equal(f.row.requests_used,0);});
test('T07 stale or foreign finalizer lease cannot confirm',async()=>{const f=fixture({lease_sha256:'current',lease_expires_at:new Date(end.getTime()+1000)});
 await assert.rejects(assertThreadsFinalizer(f.tx,f.scope,'123','old',end.getTime()),/CONFLICT/);
 await assert.rejects(assertThreadsFinalizer(f.tx,f.scope,'123','current',end.getTime()+2000),/CONFLICT/);
});
test('T03 phase replay and generation change prevent next side effect',async()=>{
 const f=fixture({state:'claimed'});const j=threadsPhaseJournal(run=>run(f.tx),f.scope,async()=>{},()=>end.getTime());
 await j.beforeCreate();await assert.rejects(j.beforeCreate(),/CONFLICT/);await j.containerCreated('456');
 f.row.generation=2;await assert.rejects(j.beforePublish(),/CONFLICT/);assert.equal(f.row.state,'container_ready');
});
test('T09 existing different task/provider object cannot be claimed',async()=>{const f=fixture();f.tx.publicationFact.findFirst=async()=>({id:9});await assert.rejects(assertThreadsFinalizer(f.tx,f.scope,'123',null,end.getTime()),/CONFLICT/);});
