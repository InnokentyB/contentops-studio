require('ts-node/register/transpile-only');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function context(){const file=path.join(root,'src/mcp/publication-principal.ts');assert.equal(fs.existsSync(file),true,'DA02 trusted principal context behavior absent');return require(file);}
const owner={userId:701,actorId:'user:701',projectId:71,profile:'owner'};
test('DA02 actual scoped publication request keeps token identity without caller actor field',async()=>{
 const c=context(),{scopeRemoteMcpRequest}=require('../../src/mcp/remote-auth.ts');
 assert.equal(c.currentPublicationPrincipal(),null);
 await c.withPublicationPrincipal(owner,async()=>{
  const result=scopeRemoteMcpRequest({method:'tools/call',params:{name:'ba_publish_publication_task',arguments:{projectId:71,taskId:4001,dryRun:true}}},owner);
  assert.equal(result.allowed,true);assert.equal(c.requirePublicationPrincipal(71).actorId,owner.actorId);
  assert.equal(result.body.params.arguments.actorId,undefined,'context must not be an untrusted schema field');
  assert.throws(()=>c.requirePublicationPrincipal(72),/SCOPE|PRINCIPAL/);
 });assert.equal(c.currentPublicationPrincipal(),null);
});
test('DA02 concurrent async requests cannot inherit another tenant or caller actor',async()=>{
 const c=context(),other={...owner,userId:702,actorId:'user:702',projectId:72};
 await Promise.all([owner,other].map(p=>c.withPublicationPrincipal(p,async()=>{await new Promise(r=>setTimeout(r,5));assert.equal(c.requirePublicationPrincipal(p.projectId).actorId,p.actorId);})));assert.equal(c.currentPublicationPrincipal(),null);
 assert.throws(()=>c.requirePublicationPrincipal(71),/PRINCIPAL/);
 assert.throws(()=>c.withPublicationPrincipal({...owner,actorId:'user:999'},()=>{}),/PRINCIPAL/);
});
test('DA02 local stdio principal is configured identity, not first owner or request data',()=>{
 const c=context();assert.equal(c.configuredPublicationPrincipal({}),null);
 assert.deepEqual(c.configuredPublicationPrincipal({MCP_PRINCIPAL_USER_ID:'701'}),{userId:701,actorId:'user:701',profile:'owner'});
 assert.equal(c.configuredPublicationPrincipal({MCP_PRINCIPAL_USER_ID:'invalid'}),null);
});
test('DA05 existing publication task command routes arbitrary Dzen data before legacy IDs and Telegram',async()=>{
 const {executePublicationTaskByChannel}=require('../../src/mcp/tools/task_publication_tools.ts');const calls=[];
 const result=await executePublicationTaskByChannel({projectId:71,taskId:4001,dryRun:true},{
  owned:async args=>{calls.push(['owned',args.taskId]);return {state:'preview',task_id:args.taskId};},
  isDzenTask:()=>false,dzen:{execute:async()=>{throw Error('legacy');}},
  threads:{isThreadsTask:async()=>{throw Error('wrong provider');},execute:async()=>({})},telegram:{execute:async()=>{throw Error('telegram fallback');}}
 });assert.deepEqual(calls,[['owned',4001]]);assert.equal(result.state,'preview');
});
test('DA23 registered existing MCP command rejects transport, session and forged actor input',()=>{
 const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');const {registerTaskPublicationTools}=require('../../src/mcp/tools/task_publication_tools.ts');
 const server=new McpServer({name:'owned-local-boundary',version:'1'});registerTaskPublicationTools(server);
 const schema=server._registeredTools.ba_publish_publication_task.inputSchema;
 for(const field of ['transport','session','actorId','allowed','receipt'])assert.equal(schema.safeParse({projectId:71,taskId:4001,[field]:'forged'}).success,false,field);
 assert.equal(schema.safeParse({projectId:71,taskId:4001,operation:'release',dryRun:true,approvalReference:'human fixture'}).success,true);
});
