const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
const {isToolAllowedForProfile}=require(path.join(base,'mcp/capabilities.js'));
const {scopeRemoteMcpRequest}=require(path.join(base,'mcp/remote-auth.js'));
const {registerPreparationHeartbeatTools,PREPARATION_HEARTBEAT_COMMAND}=require(path.join(base,'mcp/tools/browser_preparation_heartbeat_tools.js'));
const publisher={userId:17,actorId:'user:17',projectId:10,profile:'publisher'};
const args={projectId:10,taskId:314,attemptId:27,workItemId:92,idempotencyKey:'private-heartbeat-original-key',leaseToken:'private-heartbeat-lease-do-not-echo',generation:1};
const safe={generation:1,leaseExpiresAtMs:123456789,submission_permitted:false,retry_allowed:false};
async function connected(principal=publisher,renew=async()=>safe){
 const calls=[],service={renew:async input=>{calls.push(input);return renew(input)}},server=new McpServer({name:'synthetic-heartbeat',version:'1'});
 registerPreparationHeartbeatTools(server,principal,service);
 const client=new Client({name:'synthetic-publisher',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 return{server,client,calls,close:async()=>{await client.close();await server.close();},call:(input=args,current=principal)=>withPublicationPrincipal(current,()=>client.callTool({name:PREPARATION_HEARTBEAT_COMMAND,arguments:input}))};
}
test('only authenticated project-scoped Publisher discovers the heartbeat mutation',async()=>{
 for(const principal of [null,{...publisher,profile:'owner'},{...publisher,profile:'writer'},{...publisher,projectId:undefined},{...publisher,actorId:'user:999'}]){
  const b=await connected(principal);try{await assert.rejects(b.client.listTools(),e=>e.code===-32601)}finally{await b.close()}
 }
 const b=await connected();try{const tools=(await b.client.listTools()).tools;const t=tools.find(t=>t.name===PREPARATION_HEARTBEAT_COMMAND);assert.ok(t);assert.equal(t.annotations.readOnlyHint,false);assert.equal('actorId'in t.inputSchema.properties,false);assert.equal('profile'in t.inputSchema.properties,false);}finally{await b.close()}
});
test('capability and remote scope admit Publisher only, never Owner or a foreign project',()=>{
 for(const role of ['owner','writer','editor','planner','strategist','art_director','growth_analyst','organization_researcher'])assert.equal(isToolAllowedForProfile(role,PREPARATION_HEARTBEAT_COMMAND),false,role);
 assert.equal(isToolAllowedForProfile('publisher',PREPARATION_HEARTBEAT_COMMAND),true);
 const request=projectId=>({method:'tools/call',params:{name:PREPARATION_HEARTBEAT_COMMAND,arguments:{...args,projectId}}});
 assert.equal(scopeRemoteMcpRequest(request(10),publisher).allowed,true);
 const denied=scopeRemoteMcpRequest(request(11),publisher);assert.equal(denied.allowed,false);assert.equal(denied.reason,'project_scope_mismatch');
});
test('SDK heartbeat binds actual current actor and serializes only safe renewal fields',async()=>{
 const b=await connected(publisher,async input=>({...safe,leaseToken:input.leaseToken,idempotencyKey:input.idempotencyKey,unexpected:'private service data'}));
 try{const r=await b.call();assert.equal(r.isError,false);assert.deepEqual(JSON.parse(r.content[0].text),safe);assert.deepEqual(b.calls,[{...args,actorId:publisher.actorId}]);assert.equal(JSON.stringify(r).includes(args.leaseToken),false);assert.equal(JSON.stringify(r).includes(args.idempotencyKey),false);}finally{await b.close()}
});
test('current null, changed actor/profile/project and unscoped identity cannot reuse session authority',async()=>{
 const b=await connected();try{for(const p of [null,{...publisher,userId:18,actorId:'user:18'},{...publisher,profile:'owner'},{...publisher,projectId:11},{...publisher,projectId:undefined}]){const r=await b.call(args,p);assert.equal(r.isError,true);assert.equal(JSON.stringify(r).includes(args.leaseToken),false);}assert.equal(b.calls.length,0);}finally{await b.close()}
});
test('bad scope, invalid generation and caller actor cannot reach renewal service',async()=>{
 const b=await connected();try{for(const input of [{...args,projectId:11},{...args,generation:-1},{...args,actorId:'user:999'},{...args,profile:'publisher'}]){try{const r=await b.call(input);assert.equal(r.isError,true)}catch(e){assert.match(String(e),/invalid|argument|schema|validation|MCP error/i)}}assert.equal(b.calls.length,0);}finally{await b.close()}
});
test('safe refusal preserves reason and remediation without reflecting raw lease/errors',async()=>{
 const warn=console.warn,logs=[];console.warn=x=>logs.push(x);
 const b=await connected(publisher,async()=>{throw Error('[HEARTBEAT_LEASE_EXPIRED] '+args.leaseToken+' '+args.idempotencyKey)});
 try{const r=await b.call(),p=JSON.parse(r.content[0].text);assert.equal(r.isError,true);assert.equal(p.code,'HEARTBEAT_LEASE_EXPIRED');assert.equal(p.retry_allowed,false);assert.match(p.reasons[0].action,/existing|same/i);assert.equal((JSON.stringify(r)+JSON.stringify(logs)).includes(args.leaseToken),false);assert.equal((JSON.stringify(r)+JSON.stringify(logs)).includes(args.idempotencyKey),false);}finally{console.warn=warn;await b.close()}
});
test('actual Planner factory wires heartbeat discovery only for its authenticated Publisher session',async()=>{
 const {createPlannerMcpServer}=require(path.join(base,'mcp/shared.js'));
 for(const principal of [publisher,{...publisher,profile:'owner'},{...publisher,profile:'writer'},{...publisher,projectId:undefined},null]){
  const profile=principal?.profile||'owner',server=createPlannerMcpServer({profile,principal}),client=new Client({name:'synthetic-composition',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  try{await server.connect(a);await client.connect(b);const found=(await client.listTools()).tools.some(t=>t.name===PREPARATION_HEARTBEAT_COMMAND);assert.equal(found,principal===publisher);}finally{await client.close();await server.close()}
 }
});
