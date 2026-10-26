const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {classifyExternalExec,canonicalArgumentsSha256}=require('./census.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const sorted=x=>x&&typeof x==='object'?Array.isArray(x)?x.map(sorted):Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const hash=x=>sha(JSON.stringify(sorted(x)));
const snapshot={projectId:10,taskId:123,contentRevision:1,bodySha256:sha('synthetic body')};
const binding={plannerServer:'contentops_publisher',projectId:10,taskId:123,attemptId:456,workItemId:789,actorId:'user:17',keySha256:sha('synthetic-key'),leaseSha256:sha('synthetic-lease'),snapshotSha256:hash(snapshot)};
function native(tool,args,id='inner-1',ordinal=20){return {callId:id,ordinal,server:binding.plannerServer,tool,status:'completed',argumentsSha256:hash(args),parentCallId:'outer-1'};}
function input(code,records=[]){return {callId:'outer-1',ordinal:1,namespace:null,toolName:'exec',rawInput:code,completion:{callId:'outer-1',ordinal:100,status:'completed'},nativeBindings:records};}
function call(tool,args){return `tools.mcp__contentops_publisher__${tool}(${JSON.stringify(args)})`;}
function read(){const args={projectId:10,taskId:123};return input(`text(await ${call('ba_get_publication_task',args)});`,[native('ba_get_publication_task',args)]);}
function start(){const args={projectId:10,taskId:123,actorId:'user:17',workItemId:789,idempotencyKey:'synthetic-key',leaseToken:'synthetic-lease',snapshot,approvalReference:'synthetic approval',apply:false};const n=native('ba_start_browser_submission',args);Object.assign(n,{resultAttemptId:456,resultSubmissionPermitted:false,resultRetryAllowed:false});return {args,n,value:input(`const result=await ${call('ba_start_browser_submission',args)}; text(result);`,[n])};}
const classify=x=>classifyExternalExec(x,binding),deny=x=>assert.equal(classify(x).classification,'DENIED');
test('bound awaited Planner read is a non-authoritative read classification',()=>{
 const r=classify(read());assert.equal(r.classification,'READ_ONLY');assert.equal(r.effectScope,'TARGET_TASK');assert.deepEqual(r.matchedNativeCallIds,['inner-1']);assert.equal(r.inputSha256,sha(read().rawInput));
});
test('awaited Promise.all accounts for each native leaf exactly once',()=>{
 const a={projectId:10,taskId:123},b={projectId:10};
 const r=classify(input(`const r=await Promise.all([${call('ba_get_publication_task',a)},${call('ba_get_agent_workspace_manifest',b)}]); text(JSON.stringify(r));`,[native('ba_get_publication_task',a),native('ba_get_agent_workspace_manifest',b,'inner-2',21)]));
 assert.equal(r.classification,'READ_ONLY');assert.equal(r.matchedNativeCallIds.length,2);
});
test('only the exact original application-start result is supported preparation',()=>{
 const {value}=start(),r=classify(value);assert.equal(r.classification,'TARGET_START_ONLY');assert.equal(r.effectScope,'TARGET_TASK');assert.equal(JSON.stringify(r).includes('synthetic-key'),false);assert.equal(JSON.stringify(r).includes('synthetic-lease'),false);
});
test('start must match original task, work, key, lease, package and returned attempt',()=>{
 for(const mutate of [x=>x.args.taskId++,x=>x.args.workItemId++,x=>x.args.idempotencyKey+='foreign',x=>x.args.leaseToken+='foreign',x=>x.args.snapshot={...x.args.snapshot,contentRevision:2},x=>x.n.resultAttemptId++,x=>x.n.resultSubmissionPermitted=true]){
  const s=start();mutate(s);s.n.argumentsSha256=hash(s.args);s.value.rawInput=`text(await ${call('ba_start_browser_submission',s.args)});`;deny(s.value);
 }
});
test('provider-capable tool is denied even with matching successful native receipt',()=>{
 const args={projectId:10,taskId:123};for(const name of ['ba_pre_submit_browser_submission','ba_confirm_browser_submission','ba_publish_publication_task'])deny(input(`text(await ${call(name,args)});`,[native(name,args)]));
});
test('spelling or matching outer output cannot replace native transport binding',()=>{const v=read();v.nativeBindings=[];deny(v);});
test('foreign server or mismatched native arguments are denied',()=>{
 for(const mutate of [v=>v.nativeBindings[0].server='foreign',v=>v.nativeBindings[0].argumentsSha256=sha('foreign'),v=>v.nativeBindings[0].parentCallId='different-parent']){const v=read();mutate(v);deny(v);}
});
test('shell, fetch, dynamic tool selection, detached work and callback chains refuse',()=>{
 for(const code of ['await tools.exec_command({cmd:"anything"});','await fetch("https://example.invalid");','await tools[name]({});',call('ba_get_publication_task',{projectId:10,taskId:123})+';',call('ba_get_publication_task',{projectId:10,taskId:123})+'.then(text);','setTimeout(()=>{},1);'])deny(input(code,read().nativeBindings));
});
test('raw input is parsed without executing it or leaking its contents',()=>{
 globalThis.__externalCensusProbe=0;deny(input('globalThis.__externalCensusProbe++;'));assert.equal(globalThis.__externalCensusProbe,0);delete globalThis.__externalCensusProbe;
 const args={projectId:10,taskId:123,memo:'SECRET_SENTINEL_NOT_FOR_EXPORT'},v=input(`text(await ${call('ba_get_publication_task',args)});`,[native('ba_get_publication_task',args)]),r=classify(v);
 assert.equal(r.classification,'READ_ONLY');assert.equal(JSON.stringify(r).includes(args.memo),false);assert.equal('rawInput' in r,false);
});
test('actual missing namespace stays null; wrong namespace or completion refuses',()=>{
 for(const mutate of [v=>v.namespace='guessed',v=>delete v.namespace,v=>v.completion.callId='foreign',v=>v.completion.status='running',v=>v.completion.ordinal=0]){const v=read();mutate(v);deny(v);}
});
test('no extra, duplicated, failed or out-of-frame native calls are silently ignored',()=>{
 for(const mutate of [v=>v.nativeBindings.push({...v.nativeBindings[0],callId:'extra'}),v=>v.nativeBindings.push(v.nativeBindings[0]),v=>v.nativeBindings[0].status='failed',v=>v.nativeBindings[0].ordinal=101]){const v=read();mutate(v);deny(v);}
});
test('reserved runtime objects, getters and source syntax errors cannot bypass analysis',()=>{
 for(const code of ['const tools={}; text(1);','text({get value(){throw Error("hidden")}});','text({ok:1}); /*','const r=await Promise.all([fetch("https://example.invalid")]); text(r);'])deny(input(code));
});
test('constant control output is accounted for without invented service calls',()=>{
 const r=classify(input('const summary={ok:true,count:2}; text(JSON.stringify(summary));'));assert.equal(r.classification,'CONTROL_OUTPUT_ONLY');assert.deepEqual(r.matchedNativeCallIds,[]);
});
test('canonical argument hashes survive property ordering, not changed values',()=>{
 assert.equal(canonicalArgumentsSha256({b:2,a:{z:1,x:0}}),canonicalArgumentsSha256({a:{x:0,z:1},b:2}));assert.notEqual(canonicalArgumentsSha256({a:1}),canonicalArgumentsSha256({a:2}));
});
test('canonical JSON never invokes an accessor while computing evidence hashes',()=>{
 let calls=0;const values=[];Object.defineProperty(values,'0',{get(){calls++;return 1}});values.length=1;
 assert.throws(()=>canonicalArgumentsSha256(values));assert.equal(calls,0);
});
test('unknown JSON execution wrappers are not silently treated as the agreed JavaScript exec ABI',()=>{
 deny(input(JSON.stringify({code:'text(1);',unreviewedHook:'unknown'})));
});
