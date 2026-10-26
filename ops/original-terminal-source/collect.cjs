const {createHash}=require('node:crypto');
const {createReadStream}=require('node:fs');
const {createInterface}=require('node:readline');
const digest=x=>createHash('sha256').update(x).digest('hex');
const invalid=()=>{throw new Error('TERMINAL_SOURCE_ARCHIVE_INVALID');};
/** Read-only archive observation. Never supplies custody, provider absence or permission. */
async function collect(lines,{turnId,threadId}) {
 if(typeof turnId!=='string'||!turnId||typeof threadId!=='string'||!threadId)invalid();
 let start=null,end=null,lastOrdinal=null,bytes=0;
 const calls=new Map(),results=new Map();
 for await(const line of lines){
  const lineBytes=Buffer.byteLength(line);bytes+=lineBytes;if(bytes>512*1024*1024||lineBytes>16*1024*1024)invalid();
  if(!line.trim())continue;
  let row;try{row=JSON.parse(line);}catch{invalid();}
  const p=row.payload??{},target=p.turn_id===turnId;
  const declaration=row.type==='response_item'&&p.type==='function_call'&&p.namespace==='mcp__cua_repl'&&p.name==='js'&&p.internal_chat_message_metadata_passthrough?.turn_id===turnId;
  const terminal=row.type==='event_msg'&&p.type==='item_completed'&&target&&p.item?.type==='McpToolCall'&&['cua_repl','mcp__cua_repl'].includes(p.item.server);
  if(row.type==='event_msg'&&p.type==='task_started'&&target){
   if(start||end||!Number.isSafeInteger(row.ordinal))invalid();
   start={ordinal:row.ordinal,timestamp:row.timestamp};lastOrdinal=row.ordinal;
  }else if(start&&!end){
   if(!Number.isSafeInteger(row.ordinal)||row.ordinal!==lastOrdinal+1)invalid();lastOrdinal=row.ordinal;
  }
  if(declaration||terminal){
   if(!start||end)invalid();
   const id=declaration?p.call_id:p.item.id;
   if(typeof id!=='string'||!id||id.length>200)invalid();
   if(declaration){
    if(calls.has(id)||calls.size>=10000)invalid();
    calls.set(id,{callId:id,ordinal:row.ordinal,argumentsSha256:digest(typeof p.arguments==='string'?p.arguments:JSON.stringify(p.arguments??null))});
   }else{
    if(results.has(id)||p.thread_id!==threadId||p.item.tool!=='js'||!['completed','failed'].includes(p.item.status))invalid();
    if(!Number.isFinite(p.started_at_ms)||!Number.isFinite(p.completed_at_ms)||p.completed_at_ms<p.started_at_ms)invalid();
    results.set(id,{status:p.item.status,terminalOrdinal:row.ordinal,completedAtMs:p.completed_at_ms});
   }
  }
  if(row.type==='event_msg'&&target&&['task_complete','turn_aborted'].includes(p.type)){
   if(!start||end)invalid();end={ordinal:row.ordinal,timestamp:row.timestamp,kind:p.type};
  }
 }
 if(!start||!end||calls.size===0||calls.size!==results.size)invalid();
 const operations=[];
 for(const [id,call]of calls){const result=results.get(id);if(!result||result.terminalOrdinal<=call.ordinal)invalid();operations.push({...call,...result});}
 return {schemaVersion:1,kind:'LOCAL_ARCHIVE_TERMINAL_OBSERVATION',turnId,threadId,start,end,operations,
  custodyGranted:false,nativeQueueDrainProven:false,providerAbsenceProven:false,submissionPermitted:false};
}
module.exports={collect};
if(require.main===module){
 const [archive,turnId,threadId,...extra]=process.argv.slice(2);
 if(!archive||extra.length){process.stderr.write('TERMINAL_SOURCE_ARGUMENTS_INVALID\n');process.exitCode=1;}
 else{const stream=createReadStream(archive);const lines=createInterface({input:stream,crlfDelay:Infinity});
  stream.on('error',()=>{process.stderr.write('TERMINAL_SOURCE_READ_FAILED\n');process.exitCode=1;lines.close();});
  collect(lines,{turnId,threadId}).then(result=>{if(!process.exitCode)process.stdout.write(JSON.stringify(result)+'\n');}).catch(()=>{process.stderr.write('TERMINAL_SOURCE_ARCHIVE_INVALID\n');process.exitCode=1;}).finally(()=>stream.destroy());
 }
}
