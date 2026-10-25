const {test}=require('node:test');const assert=require('node:assert/strict');const {collect}=require('./collect.cjs');
const binding={turnId:'turn-example',threadId:'thread-example'};
function fixture(end='turn_aborted') {return [
 {ordinal:1,type:'event_msg',payload:{type:'task_started',turn_id:binding.turnId}},
 {ordinal:2,type:'response_item',payload:{type:'function_call',namespace:'mcp__cua_repl',name:'js',call_id:'call-example',arguments:'SECRET_SOURCE_TEXT',internal_chat_message_metadata_passthrough:{turn_id:binding.turnId}}},
 {ordinal:3,type:'event_msg',payload:{type:'item_completed',turn_id:binding.turnId,thread_id:binding.threadId,started_at_ms:1,completed_at_ms:2,item:{type:'McpToolCall',id:'call-example',server:'cua_repl',tool:'js',status:'completed'}}},
 {ordinal:4,type:'event_msg',payload:{type:end,turn_id:binding.turnId}}];}
const run=rows=>collect(rows.map(x=>JSON.stringify(x)),binding);
test('completed original calls in an aborted turn produce observations only, without raw arguments',async()=>{const r=await run(fixture());assert.equal(r.operations.length,1);assert.equal(r.submissionPermitted,false);assert.equal(r.nativeQueueDrainProven,false);assert.equal(JSON.stringify(r).includes('SECRET_SOURCE_TEXT'),false);});
test('normal completed turn and failed operation are terminal observations',async()=>{const f=fixture('task_complete');f[2].payload.item.status='failed';assert.equal((await run(f)).operations[0].status,'failed');});
test('missing final event rejects rather than treating turn abort as drained',async()=>{await assert.rejects(run(fixture().filter(x=>x.ordinal!==3)),/TERMINAL_SOURCE_ARCHIVE_INVALID/);});
test('ordinal gap fails closed',async()=>{const f=fixture();f[1].ordinal=20;await assert.rejects(run(f),/TERMINAL_SOURCE_ARCHIVE_INVALID/);});
test('mismatched operation identity fails closed',async()=>{const f=fixture();f[2].payload.item.id='another-call';await assert.rejects(run(f),/TERMINAL_SOURCE_ARCHIVE_INVALID/);});
test('wrong source thread is rejected',async()=>{const f=fixture();f[2].payload.thread_id='another-thread';await assert.rejects(run(f),/TERMINAL_SOURCE_ARCHIVE_INVALID/);});
test('running operation cannot be normalized into a completed one',async()=>{const f=fixture();f[2].payload.item.status='running';await assert.rejects(run(f),/TERMINAL_SOURCE_ARCHIVE_INVALID/);});
test('duplicate terminal operation and missing turn end fail closed',async()=>{const f=fixture();f.splice(3,0,{...f[2],ordinal:4});f[4].ordinal=5;await assert.rejects(run(f),/TERMINAL_SOURCE_ARCHIVE_INVALID/);await assert.rejects(run(fixture().slice(0,-1)),/TERMINAL_SOURCE_ARCHIVE_INVALID/);});
