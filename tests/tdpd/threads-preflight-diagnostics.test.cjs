const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {fixture,base}=require('./threads-api.fixture.cjs');
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.ts'));
const {ThreadsService}=require(path.join(base,'services/threads.service.ts'));
const {ThreadsProviderError}=require(path.join(base,'services/threads_provider_error.ts'));
const {threadsDiagnosticResult}=require(path.join(base,'mcp/tools/threads_diagnostic_result.ts'));
const singleton=require(path.join(base,'services/threads_generic_release.service.ts')).default;
const {registerTaskPublicationTools}=require(path.join(base,'mcp/tools/task_publication_tools.ts'));
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
async function invoke(t,f){
 t.mock.method(singleton,'publish',f.service.publish.bind(f.service));
 const server=new McpServer({name:'threads-preflight',version:'1'});registerTaskPublicationTools(server);
 const client=new Client({name:'operator',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(a);await client.connect(b);return await withPublicationPrincipal({userId:Number(f.send.actorId.slice(5)),actorId:f.send.actorId,projectId:f.send.projectId,profile:'publisher'},()=>client.callTool({name:'ba_publish_threads_task',arguments:f.send}));}
 finally{await client.close();await server.close();}
}
const secret='synthetic-private-token-DO-NOT-LOG';
const cases=[
 ['unauthorized',401,'THREADS_PROVIDER_AUTH_REQUIRED'],['forbidden',403,'THREADS_PROVIDER_PERMISSION_REQUIRED'],
 ['rate limited',429,'THREADS_PROVIDER_RATE_LIMITED'],['unavailable',503,'THREADS_PROVIDER_UNAVAILABLE'],
 ['invalid JSON',200,'THREADS_PROVIDER_INVALID_RESPONSE'],['network',null,'THREADS_PROVIDER_UNAVAILABLE'],
 ['timeout','timeout','THREADS_PROVIDER_TIMEOUT'],['cancelled read','abort','THREADS_PROVIDER_TIMEOUT']
];
for(const [name,status,expected]of cases)test(`preclaim ${name} exposes safe cause and preserves zero sends/attempts`,async t=>{
 const f=fixture();await f.service.release(f.release);const transport=new ThreadsService();
 f.deps.threads.getOwnPosts=transport.getOwnPosts.bind(transport);const methods=[],logs=[];
 t.mock.method(global,'fetch',async(_url,init)=>{methods.push(init.method||'GET');
  if(status===null)throw Error(secret);if(status==='timeout'||status==='abort')throw new DOMException(secret,status==='abort'?'AbortError':'TimeoutError');
  if(status===200)return new Response(secret,{status:200});return new Response(secret,{status});
 });
 t.mock.method(console,'warn',line=>logs.push(line));
 const result=await invoke(t,f);
 const payload=JSON.parse(result.content[0].text);
 assert.deepEqual(result.structuredContent,payload);
 assert.equal(payload.code,expected);assert.equal(result.isError,true);assert.equal(payload.retry_allowed,false);
 assert.equal(payload.provider.operation,'read_own_posts');assert.equal(payload.provider.stage,'provider_history');
 if(typeof status==='number')assert.equal(payload.provider.http_status,status);
 assert.match(payload.reasons[0].action,/administrator|Wait|wait|provider|service/i);
 assert.equal(f.attempts.length,0);assert.equal(f.rows.length,0);assert.equal(f.calls,0);assert.deepEqual(methods,['GET']);
 assert.equal(f.task.status,'ready_for_execution');assert.equal(logs.length,1);
 assert.equal(JSON.parse(logs[0]).code,expected);assert.ok(!JSON.stringify({result,logs}).includes(secret));
});
for(const [name,code,operation,status]of [
 ['operation','THREADS_PROVIDER_REQUEST_FAILED',secret,401],
 ['status','THREADS_PROVIDER_REQUEST_FAILED','read_own_posts',secret],
 ['code',secret,'read_own_posts',401]
])test(`untrusted provider ${name} remains masked rather than serialized`,async t=>{
 const logs=[];t.mock.method(console,'warn',line=>logs.push(line));
 const result=await threadsDiagnosticResult(async()=>{throw new ThreadsProviderError(code,operation,status);});
 const payload=JSON.parse(result.content[0].text);assert.equal(payload.code,'THREADS_REQUEST_FAILED');
 assert.equal(payload.provider,undefined);assert.ok(!JSON.stringify({result,logs}).includes(secret));
});
test('dry run remains local and never claims provider verification',async()=>{
 const f=fixture();await f.service.release(f.release);f.deps.threads.getOwnPosts=async()=>{throw Error('unexpected provider read');};
 const result=await f.service.publish({...f.send,dryRun:true});assert.equal(result.mode,'dry_run');
 assert.equal(f.attempts.length,0);assert.equal(f.calls,0);
});
