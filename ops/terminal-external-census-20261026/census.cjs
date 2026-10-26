const ts=require('typescript'),{createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(x).digest('hex');
const reads=new Set(['ba_get_publication_task','ba_get_publication_fact','ba_get_work_item_context','ba_get_agent_workspace_manifest','ba_diagnose_browser_publication','ba_list_work_items','ba_list_publication_tasks','ba_get_publication_task_resources','ba_list_project_channels','ba_read_publication_plan_asset','ba_get_agent_chat_bootstrap']);
const providerCapable=new Set(['ba_pre_submit_browser_submission','ba_confirm_browser_submission','ba_publish_publication_task','ba_execute_publication_task','ba_reconcile_browser_submission']);
const reserved=new Set(['tools','Promise','JSON','text','image','globalThis','process','require']);
class Refusal extends Error {constructor(code){super(code);this.code=code;}}
const refuse=code=>{throw new Refusal(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
/** Same deterministic JSON projection for local native argument metadata and source literals. */
function canonicalArgumentsSha256(value){
 let count=0;const seen=new Set();
 function walk(v,depth){
  if(++count>10000||depth>32)refuse('ARGUMENT_LIMIT');
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(!v||typeof v!=='object'||seen.has(v))refuse('ARGUMENT_VALUE_UNSUPPORTED');
  seen.add(v);let result;
  if(Array.isArray(v)){
   if(v.length>10000)refuse('ARGUMENT_LIMIT');result=[];
   for(let i=0;i<v.length;i++){const item=Object.getOwnPropertyDescriptor(v,String(i));if(!item||!('value' in item))refuse('ARGUMENT_VALUE_UNSUPPORTED');result.push(walk(item.value,depth+1));}
  }
  else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))refuse('ARGUMENT_VALUE_UNSUPPORTED');
   result=Object.create(null);const descriptors=Object.getOwnPropertyDescriptors(v);
   for(const key of Object.keys(descriptors).sort()){
    if(['__proto__','constructor','prototype'].includes(key)||!('value' in descriptors[key]))refuse('ARGUMENT_VALUE_UNSUPPORTED');
    result[key]=walk(descriptors[key].value,depth+1);
   }
  }
  seen.delete(v);return result;
 }
 return sha(JSON.stringify(walk(value,0)));
}
/** Pure local observation, never a source-registration, authentication or send decision. */
function classifyExternalExec(input,binding){
 const raw=typeof input?.rawInput==='string'?input.rawInput:'';
 const base={callId:id(input?.callId)?input.callId:'INVALID_CALL_ID',inputSha256:sha(raw),status:['completed','failed','running'].includes(input?.completion?.status)?input.completion.status:'unknown',classification:'DENIED',effectScope:'UNKNOWN',reasonCode:'INVALID_INPUT',matchedNativeCallIds:[]};
 try{return analyze(input,binding,base);}catch(error){return {...base,reasonCode:error instanceof Refusal?error.code:'CLASSIFIER_FAILURE'};}
}
function analyze(input,binding,base){
 if(!input||!id(input.callId)||input.namespace!==null||input.toolName!=='exec'||!positive(input.ordinal)||typeof input.rawInput!=='string'||Buffer.byteLength(input.rawInput)>262144)refuse('EXEC_FRAME_INVALID');
 const end=input.completion;
 if(!end||end.callId!==input.callId||end.status!=='completed'||!positive(end.ordinal)||end.ordinal<=input.ordinal)refuse('EXEC_COMPLETION_UNVERIFIED');
 if(!binding||!id(binding.plannerServer)||!['projectId','taskId','attemptId','workItemId'].every(k=>positive(binding[k])))refuse('TARGET_BINDING_INVALID');
 if(!Array.isArray(input.nativeBindings)||input.nativeBindings.length>200)refuse('NATIVE_BINDING_INVALID');
 const records=input.nativeBindings,ids=new Set(),used=new Set();
 for(const r of records){
  if(!r||!id(r.callId)||ids.has(r.callId)||!id(r.server)||!id(r.tool)||!digest(r.argumentsSha256)||r.status!=='completed'||!positive(r.ordinal)||r.ordinal<=input.ordinal||r.ordinal>=end.ordinal||(r.parentCallId!==undefined&&r.parentCallId!==input.callId))refuse('NATIVE_BINDING_INVALID');
  ids.add(r.callId);
 }
 // The agreed ABI is the actual JavaScript custom exec input, not an inferred wrapper.
 const code=input.rawInput;
 const compiled=ts.transpileModule(code,{fileName:'external-source.js',reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,allowJs:true}});
 if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))refuse('EXEC_SYNTAX_INVALID');
 const source=ts.createSourceFile('external-source.js',code,ts.ScriptTarget.ES2020,true,ts.ScriptKind.JS);
 let nodes=0;const pending=[source];while(pending.length){const n=pending.pop();if(++nodes>10000)refuse('EXEC_AST_LIMIT');ts.forEachChild(n,child=>{pending.push(child);});}
 const values=new Map(),scopes=new Set(),opaque=Symbol('native-result');let starts=0,calls=0;
 const prefix='mcp__'+binding.plannerServer.replace(/[^A-Za-z0-9_]/g,'_')+'__';
 function data(node,depth=0){
  if(!node||depth>32)refuse('ARGUMENT_VALUE_UNSUPPORTED');
  if(ts.isParenthesizedExpression(node))return data(node.expression,depth+1);
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
  if(ts.isNumericLiteral(node))return Number(node.text.replace(/_/g,''));
  if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
  if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.MinusToken&&ts.isNumericLiteral(node.operand))return -Number(node.operand.text);
  if(ts.isIdentifier(node)&&values.has(node.text)&&values.get(node.text)!==opaque)return values.get(node.text);
  if(ts.isArrayLiteralExpression(node))return node.elements.map(x=>data(x,depth+1));
  if(ts.isObjectLiteralExpression(node)){
   const result=Object.create(null);
   for(const p of node.properties){
    if(!ts.isPropertyAssignment(p)||(!ts.isIdentifier(p.name)&&!ts.isStringLiteral(p.name)&&!ts.isNumericLiteral(p.name)))refuse('ARGUMENT_VALUE_UNSUPPORTED');
    const key=p.name.text;if(['__proto__','constructor','prototype'].includes(key)||Object.hasOwn(result,key))refuse('ARGUMENT_VALUE_UNSUPPORTED');result[key]=data(p.initializer,depth+1);
   }return result;
  }refuse('ARGUMENT_VALUE_UNSUPPORTED');
 }
 function resultPath(node){
  if(ts.isIdentifier(node))return values.get(node.text)===opaque;
  if(ts.isPropertyAccessExpression(node))return !['__proto__','constructor','prototype'].includes(node.name.text)&&resultPath(node.expression);
  return ts.isElementAccessExpression(node)&&resultPath(node.expression)&&(ts.isNumericLiteral(node.argumentExpression)||ts.isStringLiteral(node.argumentExpression))&&!['__proto__','constructor','prototype'].includes(node.argumentExpression.text);
 }
 function startBinding(args,record){
  const allowed=new Set(['projectId','taskId','actorId','snapshot','approvalReference','idempotencyKey','apply','workItemId','leaseSeconds','leaseToken']);
  if(Object.keys(args).some(k=>!allowed.has(k))||args.projectId!==binding.projectId||args.taskId!==binding.taskId||args.workItemId!==binding.workItemId||typeof args.idempotencyKey!=='string'||typeof args.leaseToken!=='string'||!digest(binding.keySha256)||!digest(binding.leaseSha256)||!digest(binding.snapshotSha256)||sha(args.idempotencyKey.trim())!==binding.keySha256||sha(args.leaseToken)!==binding.leaseSha256||canonicalArgumentsSha256(args.snapshot)!==binding.snapshotSha256)refuse('ORIGINAL_START_MISMATCH');
  if(typeof args.actorId!=='string'||!/^user:[1-9]\d*$/.test(args.actorId)||(binding.actorId!==undefined&&args.actorId!==binding.actorId)||record.resultAttemptId!==binding.attemptId||record.resultSubmissionPermitted!==false||record.resultRetryAllowed!==false)refuse('ORIGINAL_START_RESULT_UNVERIFIED');
 }
 function tool(node){
  if(!ts.isCallExpression(node)||!ts.isPropertyAccessExpression(node.expression)||!ts.isIdentifier(node.expression.expression)||node.expression.expression.text!=='tools'||!node.expression.name.text.startsWith(prefix))refuse('CALLEE_UNBOUND');
  const name=node.expression.name.text.slice(prefix.length);
  if(providerCapable.has(name))refuse('PROVIDER_CAPABLE_TOOL');
  if(!reads.has(name)&&name!=='ba_start_browser_submission')refuse('TOOL_NOT_ALLOWED');
  if(node.arguments.length>1)refuse('ARGUMENT_VALUE_UNSUPPORTED');
  const args=node.arguments.length?data(node.arguments[0]):Object.create(null);
  if(!args||typeof args!=='object'||Array.isArray(args))refuse('ARGUMENT_VALUE_UNSUPPORTED');
  const fingerprint=canonicalArgumentsSha256(args),record=records.find(r=>!used.has(r.callId)&&r.server===binding.plannerServer&&r.tool===name&&r.argumentsSha256===fingerprint);
  if(!record)refuse('NATIVE_TRANSPORT_UNVERIFIED');used.add(record.callId);calls++;
  if(name==='ba_start_browser_submission'){startBinding(args,record);starts++;scopes.add('TARGET_TASK');}
  else scopes.add(args.projectId===binding.projectId?(args.taskId===binding.taskId?'TARGET_TASK':'TARGET_PROJECT'):args.projectId===undefined?'CONTROL':'OTHER_SCOPE');
  return opaque;
 }
 function awaited(node){
  if(!ts.isCallExpression(node))refuse('AWAIT_EFFECT_UNSUPPORTED');
  if(ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='Promise'&&['all','allSettled'].includes(node.expression.name.text)){
   if(node.arguments.length!==1||!ts.isArrayLiteralExpression(node.arguments[0]))refuse('DYNAMIC_ASYNC_UNSUPPORTED');
   for(const child of node.arguments[0].elements)tool(ts.isAwaitExpression(child)?child.expression:child);return opaque;
  }return tool(node);
 }
 function value(node,logging=false){
  if(ts.isAwaitExpression(node))return awaited(node.expression);
  if(logging&&resultPath(node))return opaque;
  if(logging&&ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='JSON'&&node.expression.name.text==='stringify'&&node.arguments.length===1)return value(node.arguments[0],true);
  return data(node);
 }
 for(const statement of source.statements){
  if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations){
   if(!ts.isIdentifier(d.name)||reserved.has(d.name.text)||values.has(d.name.text)||!d.initializer)refuse('BINDING_REDECLARATION_UNSUPPORTED');values.set(d.name.text,value(d.initializer));
  }else if(ts.isExpressionStatement(statement)){
   const expr=statement.expression;
   if(ts.isAwaitExpression(expr))awaited(expr.expression);
   else if(ts.isCallExpression(expr)&&ts.isIdentifier(expr.expression)&&['text','image'].includes(expr.expression.text)&&expr.arguments.length===1)value(expr.arguments[0],true);
   else refuse('EXEC_STATEMENT_UNSUPPORTED');
  }else if(!ts.isEmptyStatement(statement))refuse('EXEC_STATEMENT_UNSUPPORTED');
 }
 if(used.size!==records.length)refuse('UNACCOUNTED_NATIVE_CALL');
 return {...base,classification:starts?'TARGET_START_ONLY':calls?'READ_ONLY':'CONTROL_OUTPUT_ONLY',effectScope:starts?'TARGET_TASK':scopes.size===1?[...scopes][0]:scopes.size?'MULTIPLE_APP_READ_SCOPES':'CONTROL',reasonCode:starts?'EXACT_ORIGINAL_APPLICATION_START':calls?'BOUND_AWAITED_PLANNER_READ':'STATIC_CONTROL_OUTPUT',matchedNativeCallIds:[...used]};
}
module.exports={classifyExternalExec,canonicalArgumentsSha256};
