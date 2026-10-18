'use strict';
require('ts-node/register/transpile-only');
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
let provider='telegram',reads=0,legacyCalls=0;
const db={contentItem:{findFirst:async()=>{reads++;return {channel:{type:provider,project_id:71}};}},projectMember:{findUnique:async()=>({id:1})},$queryRaw:async()=>[],$transaction:async run=>run(db)};
const load=Module._load;Module._load=function(name,parent,...args){
 if(name.endsWith('/db')&&parent?.filename.includes('/src/'))return {__esModule:true,default:db};
 if(name.endsWith('telegram_task_publication.service'))return {__esModule:true,default:{execute:async input=>{legacyCalls++;return {state:'legacy',task_id:input.taskId};}}};
 if(name.endsWith('threads_task_publication.service'))return {__esModule:true,default:{isThreadsTask:async()=>provider==='threads',execute:async input=>{legacyCalls++;return {state:'legacy_threads',task_id:input.taskId};}}};
 return load.call(this,name,parent,...args);
};
const {registerTaskPublicationTools}=require('../../src/mcp/tools/task_publication_tools.ts');
require('../../src/services/publication_owned_route.ts');Module._load=load;
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {withPublicationPrincipal}=require('../../src/mcp/publication-principal.ts');
const server=new McpServer({name:'default-publication-route',version:'1'});registerTaskPublicationTools(server);
const callback=server._registeredTools.ba_publish_publication_task.handler;
function value(r){return JSON.parse(r.content.find(c=>c.type==='text').text);}
test('DA02 actual registered default command preserves legacy non-Dzen stdio without new principal',async()=>{
 provider='telegram';const result=await callback({projectId:71,taskId:4001,dryRun:true},{});
 assert.equal(result.isError,undefined);assert.equal(value(result).state,'legacy');assert.equal(legacyCalls,1);
});
test('DA02 default command preserves Threads selection without inferring an owned principal',async()=>{
 provider='threads';const result=await callback({projectId:71,taskId:4001,dryRun:true},{});assert.equal(value(result).state,'legacy_threads');
});
test('DA02 missing owned principal cannot fall through to any legacy executor',async()=>{
 provider='dzen';const prior=legacyCalls;await assert.rejects(callback({projectId:71,taskId:4001,dryRun:true},{}),/PRINCIPAL/);assert.equal(legacyCalls,prior);
});
test('DA02 token-bound foreign project rejects before provider metadata lookup',async()=>{
 const before=reads;await assert.rejects(withPublicationPrincipal({actorId:'user:701',userId:701,profile:'owner',projectId:72},()=>callback({projectId:71,taskId:4001,dryRun:true},{})),/SCOPE_MISMATCH/);assert.equal(reads,before);
});

test('DA02 owned-only release fields cannot fall through to legacy providers',async()=>{provider='telegram';const before=legacyCalls;await assert.rejects(callback({projectId:71,taskId:4001,operation:'release',dryRun:true},{}),/PROVIDER_OPERATION_UNSUPPORTED/);assert.equal(legacyCalls,before);});
