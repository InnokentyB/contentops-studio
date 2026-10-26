const {createHash}=require('node:crypto');
const {createReadStream,readFileSync}=require('node:fs');
const path=require('node:path');
const {createInterface}=require('node:readline');
const {collect}=require('../original-terminal-source/collect.cjs');
const {createTerminalReadVerifier}=require('../../dist/services/browser_terminal_source_semantics.js');
const {terminalSourceShape}=require('../../dist/services/browser_terminal_source_shape.js');
const {terminalExternalShape}=require('../../dist/services/browser_terminal_external_shape.js');
const {createNativeSourceIndex}=require('./native.cjs');
const sha=value=>createHash('sha256').update(value).digest('hex');
function programHashes(){
 const files={collector:'../original-terminal-source/collect.cjs',producer:'review.cjs',semantics:'../../dist/services/browser_terminal_source_semantics.js',document:'../../dist/services/browser_terminal_source_document.js',shape:'../../dist/services/browser_terminal_source_shape.js',external:'../../dist/services/browser_terminal_external_shape.js',native:'native.cjs',census:'../terminal-external-census-20261026/census.cjs'};
 return Object.fromEntries(Object.entries(files).map(([name,file])=>[name,sha(readFileSync(path.join(__dirname,file)))]));
}
/** Local-only archive processing: raw program arguments never enter the result or error output. */
async function review(lines,scope){
 const programs=new Map(),external=[],externalIds=new Set(),outputs=new Map(),records=createHash('sha256'),nativeIndex=createNativeSourceIndex(scope);
 let insideOriginal=false;
 async function* checked(){
  for await(const line of lines){
   if(Buffer.byteLength(line)>16*1024*1024)throw Error('TERMINAL_LOCAL_SOURCE_INVALID');
   records.update(line+'\n');
   const row=JSON.parse(line),p=row.payload??{};
   if(row.type==='event_msg'&&p.type==='task_started'&&p.turn_id===scope.turnId)insideOriginal=true;
   if(insideOriginal&&row.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)&&p.internal_chat_message_metadata_passthrough?.turn_id!==scope.turnId)throw Error('TERMINAL_SOURCE_SCOPE_INCOMPLETE');
   nativeIndex.observe(row);
   if(row.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(p.type)&&externalIds.has(p.call_id)){
    if(outputs.has(p.call_id))throw Error('TERMINAL_LOCAL_SOURCE_INVALID');
    outputs.set(p.call_id,{ordinal:row.ordinal,outputSha256:sha(typeof p.output==='string'?p.output:JSON.stringify(p.output??null))});
   }
   if(row.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)&&p.internal_chat_message_metadata_passthrough?.turn_id===scope.turnId){
    if(p.namespace==='mcp__cua_repl'&&p.name==='js'){
     if(programs.size>=100||programs.has(p.call_id))throw Error('TERMINAL_LOCAL_SOURCE_INVALID');
     const argumentsJson=typeof p.arguments==='string'?p.arguments:JSON.stringify(p.arguments??null);
     if(Buffer.byteLength(argumentsJson)>262144)throw Error('TERMINAL_LOCAL_SOURCE_INVALID');
     programs.set(p.call_id,argumentsJson);
    }else{
     if(external.length>=200)throw Error('TERMINAL_LOCAL_SOURCE_INVALID');
     if(externalIds.has(p.call_id))throw Error('TERMINAL_LOCAL_SOURCE_INVALID');externalIds.add(p.call_id);
     let shapes=[];
     try{shapes=terminalExternalShape(typeof p.input==='string'?p.input:typeof p.arguments==='string'?p.arguments:JSON.stringify(p.arguments??null));}catch{shapes=[{method:'UNRECOGNIZED',family:'UNRECOGNIZED',argumentKinds:[]}];}
     external.push({callId:p.call_id,ordinal:row.ordinal,argumentsSha256:sha(typeof p.input==='string'?p.input:typeof p.arguments==='string'?p.arguments:JSON.stringify(p.arguments??null)),transportSha256:sha(JSON.stringify([p.namespace??null,p.name??null])),classification:'UNREVIEWED_EXTERNAL_TRANSPORT',shapes});
    }
   }
   yield line;
   if(row.type==='event_msg'&&['task_complete','turn_aborted'].includes(p.type)&&p.turn_id===scope.turnId)insideOriginal=false;
  }
 }
 const observation=await collect(checked(),scope),operations=[],verifyTerminalReadSource=createTerminalReadVerifier(scope.browserId,scope.profileUrl);
 for(const op of observation.operations){
  const args=programs.get(op.callId);if(typeof args!=='string'||sha(args)!==op.argumentsSha256)throw Error('TERMINAL_LOCAL_SOURCE_INVALID');
  let classification='UNSUPPORTED_OPERATION';
  try{if(op.status==='completed'){verifyTerminalReadSource(args);classification='SUPPORTED_READ_ONLY';}}
  catch{classification='UNSUPPORTED_OPERATION';}
  let shapes=[];
  try{shapes=terminalSourceShape(args,scope.profileUrl);}catch{shapes=[{method:'UNRECOGNIZED',receiver:'LOCAL_OR_DYNAMIC',arguments:[]}];}
  operations.push({...op,classification,shapes});
 }
 const native=nativeIndex.finish({startOrdinal:observation.start.ordinal,endOrdinal:observation.end.ordinal,cuaCallIds:observation.operations.map(op=>op.callId)});
 if(native.external.length!==external.length)throw Error('TERMINAL_NATIVE_CENSUS_INCOMPLETE');
 return {schemaVersion:1,kind:'LOCAL_TERMINAL_SEMANTICS_OBSERVATION',threadId:scope.threadId,turnId:scope.turnId,start:observation.start,end:observation.end,
  operations,external:external.map(op=>{const frame=native.external.find(v=>v.callId===op.callId);if(!frame)throw Error('TERMINAL_NATIVE_CENSUS_INCOMPLETE');return {...op,matchingOutput:outputs.get(op.callId)??null,completionOrdinal:frame.completionOrdinal,semantic:frame.semantic};}),
  originalStartBinding:native.originalStartBinding,unaccountedNativeCallIds:native.unaccountedNativeCallIds,nativeWireKinds:native.nativeWireKinds,
  recordsSha256:records.digest('hex'),programHashes:programHashes(),profileSha256:sha(scope.profileUrl),browserSha256:sha(scope.browserId),custodyGranted:false,nativeQueueDrainProven:false,providerAbsenceProven:false,submissionPermitted:false};
}
module.exports={review,programHashes};
if(require.main===module){
 const [archive,threadId,turnId,browserId,profileUrl,targetFile,...extra]=process.argv.slice(2);
 if(!archive||!threadId||!turnId||!browserId||!profileUrl||extra.length){process.stderr.write('TERMINAL_LOCAL_ARGUMENTS_INVALID\n');process.exitCode=1;}
 else{
  const input=createReadStream(archive),lines=createInterface({input,crlfDelay:Infinity});
  input.on('error',()=>{process.stderr.write('TERMINAL_LOCAL_SOURCE_READ_FAILED\n');process.exitCode=1;lines.close();});
  let targetBinding;
  try{if(targetFile){const decoded=JSON.parse(readFileSync(targetFile,'utf8'));targetBinding=decoded?.target_binding??decoded;}}catch{process.stderr.write('TERMINAL_TARGET_BINDING_INVALID\n');process.exitCode=1;input.destroy();lines.close();}
  if(!process.exitCode)review(lines,{threadId,turnId,browserId,profileUrl,targetBinding}).then(result=>{if(!process.exitCode)process.stdout.write(JSON.stringify(result)+'\n');}).catch(()=>{process.stderr.write('TERMINAL_LOCAL_SOURCE_INVALID\n');process.exitCode=1;}).finally(()=>input.destroy());
 }
}
