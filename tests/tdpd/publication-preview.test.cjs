const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({transpileOnly:true});
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport} = require('@modelcontextprotocol/sdk/inMemory.js');
const dbModule = require('../../src/db.ts');
const {createPlannerMcpServer} = require('../../src/mcp/shared.ts');

const principal = {userId:2,actorId:'user:2',projectId:21,profile:'publisher'};
const args = {projectId:21,taskId:7001};
function project(row, select) {
  if (row === null) return null;
  const out = {};
  for (const [key, choice] of Object.entries(select)) {
    if (choice === true) out[key] = row[key] ?? null;
    else if (row[key] !== null && row[key] !== undefined && choice.select) {
      out[key] = Array.isArray(row[key]) ? row[key].map(item=>project(item,choice.select)) : project(row[key],choice.select);
    } else out[key] = row[key] ?? null;
  }
  return out;
}
function fixture(options={}) {
  const reads=[];
  const channel={id:31,project_id:21,type:'linkedin',is_active:true};
  Object.defineProperty(channel,'config',{get(){throw Error('SECRET_CONFIG_READ');}});
  const row={id:7001,project_id:21,channel_id:31,type:'post',draft_text:'Accepted text',content_revision:2,
    accepted_revision:2,text_state:'accepted',visual_mode:'optional',visual_state:'NO_VISUAL_NEEDED',visual_decision_version:1,
    visual_placement:'feed',selected_asset_id:null,status:'ready_for_execution',handoff_state:'ready',publication_mode:'browser_required',
    schedule_at:new Date('2026-10-19T09:00:00Z'),publish_at:new Date('2026-10-19T09:00:00Z'),published_link:null,
    channel,selected_asset:null,publication_fact:null,
    art_direction_decisions:[{id:41,project_id:21,content_item_id:7001,channel:'linkedin',placement:'feed',decision:'NO_VISUAL_NEEDED',decision_version:1,source_content_revision:2,status:'active'}],...options.row};
  const tx={
    $executeRaw:async strings=>{assert.equal(strings.join(''),'SET TRANSACTION READ ONLY');reads.push('read-only');return 0;},
    $queryRaw:async()=>[{publication_hold:options.hold||false,visual_reassessment_pending:options.visualRequest||false}],
    projectMember:{findUnique:async input=>{reads.push(['member',input]);return options.noMembership?null:{id:1};}},
    contentItem:{findFirst:async input=>{reads.push(['task',input]);return options.noTask?null:project(row,input.select);}},
    deliveryAttempt:{count:async()=>options.attempts||0,findFirst:async()=>options.attempt||null},
    workItem:{count:async()=>options.activeWork||0}
  };
  const db={$transaction:async(run,policy)=>{assert.equal(policy.timeout,5000);assert.equal(policy.isolationLevel,'RepeatableRead');if(options.dbError)throw Error('private-provider-token');return run(tx);}};
  return {db,reads,row};
}
async function clientRun(options,run) {
  const f=fixture(options);const oldDefault=dbModule.default;const oldNamed=dbModule.prisma;
  dbModule.default=f.db;dbModule.prisma=f.db;
  const server=createPlannerMcpServer({profile:options.profile||'publisher',principal:options.missingPrincipal?undefined:{...principal,...options.principal}});
  const client=new Client({name:'preview-operator',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
  try{await server.connect(a);await client.connect(b);await run(client,f);}
  finally{await client.close();await server.close();dbModule.default=oldDefault;dbModule.prisma=oldNamed;}
}
test('P01 actual Publisher MCP exposes pure preview, no external send authority',async()=>clientRun({},async(client,f)=>{
  const listing=await client.listTools();const tool=listing.tools.find(t=>t.name==='ba_preview_publication_task');
  assert.ok(tool,'Missing independent read-only publication preview');
  assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  const result=await client.callTool({name:tool.name,arguments:args});assert.notEqual(result.isError,true);
  assert.equal(result.structuredContent.provider_readiness,'NOT_CHECKED');assert.equal(result.structuredContent.submission_permitted,false);
  assert.equal(result.structuredContent.mutates_state,false);assert.equal(result.structuredContent.validation,'LOCAL_VALID');
  assert.ok(f.reads.includes('read-only'));assert.ok(!JSON.stringify(result).includes('Accepted text'));
}));
test('P02 forged actor cannot override trusted session and wrong project never reads task',async()=>clientRun({},async(client,f)=>{
  const r=await client.callTool({name:'ba_preview_publication_task',arguments:{...args,projectId:22,actorId:'user:999'}});
  assert.equal(r.isError,true);assert.equal(r.structuredContent.code,'PREVIEW_PROJECT_SCOPE_MISMATCH');assert.equal(f.reads.length,0);
}));
for(const [label,options,code] of [['missing principal',{missingPrincipal:true},'PREVIEW_AUTHENTICATED_PRINCIPAL_REQUIRED'],['nonmember',{noMembership:true},'PREVIEW_PROJECT_ACCESS_DENIED'],['not found',{noTask:true},'PREVIEW_TASK_NOT_FOUND'],['DB failure',{dbError:true},'PREVIEW_DEPENDENCY_UNAVAILABLE']]){
  test('P03/P04/P09 '+label,async()=>clientRun(options,async(client)=>{const r=await client.callTool({name:'ba_preview_publication_task',arguments:args});assert.equal(r.isError,true);assert.equal(r.structuredContent.code,code);assert.ok(!JSON.stringify(r).includes('private-provider-token'));}));
}
test('P06 uncertain original attempt gives reconciliation guidance without retries',async()=>clientRun({attempts:1,attempt:{id:91,status:'pending',requires_manual_confirmation:true}},async(client)=>{
  const r=await client.callTool({name:'ba_preview_publication_task',arguments:args});const p=r.structuredContent;
  assert.equal(p.validation,'BLOCKED');assert.equal(p.retry_allowed,false);assert.ok(p.blockers.some(b=>b.code==='PREVIEW_RECONCILIATION_REQUIRED'));assert.match(JSON.stringify(p.blockers),/reconcil/i);
}));
for(const provider of ['vk','dzen'])test('P07 '+provider+' never infers independent adapter readiness',async()=>clientRun({row:{channel:{id:31,project_id:21,type:provider,is_active:true}}},async(client)=>{
  const r=await client.callTool({name:'ba_preview_publication_task',arguments:args});assert.equal(r.structuredContent.provider_readiness,'NOT_CHECKED');assert.ok(r.structuredContent.blockers.some(b=>b.code==='PREVIEW_INDEPENDENT_ADAPTER_NOT_CHECKED'));
}));
test('P08 stale expected accepted revision blocks preview package',async()=>clientRun({},async(client)=>{
  const r=await client.callTool({name:'ba_preview_publication_task',arguments:{...args,expectedAcceptedRevision:1}});assert.ok(r.structuredContent.blockers.some(b=>b.code==='PREVIEW_EXPECTED_PACKAGE_CHANGED'));
}));
test('P10 other profiles cannot discover preview; existing live tool stays destructive',async()=>clientRun({profile:'editor',principal:{profile:'editor'}},async(client)=>{
  const tools=(await client.listTools()).tools;assert.ok(!tools.some(t=>t.name==='ba_preview_publication_task'));
}));
test('P02 same-project actor spoof uses authenticated membership',async()=>clientRun({},async(client,f)=>{
  const r=await client.callTool({name:'ba_preview_publication_task',arguments:{...args,actorId:'user:999'}});
  assert.equal(r.structuredContent.validation,'LOCAL_VALID');
  assert.equal(f.reads.find(read=>Array.isArray(read)&&read[0]==='member')[1].where.project_id_user_id.user_id,2);
}));
for(const [label,row,code] of [
  ['claimed executor',{},'PREVIEW_WORK_ALREADY_CLAIMED'],
  ['existing fact',{publication_fact:{id:80}},'PREVIEW_ALREADY_PUBLISHED'],
  ['terminal state',{status:'cancelled'},'PREVIEW_TASK_TERMINAL'],
  ['unsupported provider',{channel:{id:31,project_id:21,type:'private-token-provider',is_active:true}},'PREVIEW_ROUTE_UNSUPPORTED'],
  ['stale visual',{visual_state:'APPROVED',selected_asset_id:61,selected_asset:{id:61,project_id:22,content_item_id:7001,content_revision:2,decision_id:41,placement:'feed',status:'approved'}},'PREVIEW_CURRENT_APPROVED_VISUAL_REQUIRED']
])test('P05 '+label,async()=>clientRun({row,activeWork:label==='claimed executor'?1:0},async(client)=>{
  const r=await client.callTool({name:'ba_preview_publication_task',arguments:args});
  assert.equal(r.structuredContent.validation,'BLOCKED');assert.ok(r.structuredContent.blockers.some(b=>b.code===code));
  assert.ok(!JSON.stringify(r).includes('private-token-provider'));
}));
test('P05 current approved visual is checked without asset URLs or provenance',async()=>{
  const asset={id:61,project_id:21,content_item_id:7001,content_revision:2,decision_id:41,placement:'feed',status:'approved'};
  for(const field of ['file_url','provenance','quality_report'])Object.defineProperty(asset,field,{get(){throw Error('PRIVATE_ASSET_FIELD_READ');}});
  await clientRun({row:{visual_state:'APPROVED',selected_asset_id:61,selected_asset:asset,
    art_direction_decisions:[{id:41,project_id:21,content_item_id:7001,channel:'linkedin',placement:'feed',decision:'VISUAL_REQUIRED',decision_version:1,source_content_revision:2,status:'active'}]}},async(client)=>{
    const r=await client.callTool({name:'ba_preview_publication_task',arguments:args});
    assert.equal(r.structuredContent.validation,'LOCAL_VALID');assert.equal(r.structuredContent.asset_durability,'NOT_CHECKED');
  });
});
for(const options of [{row:{handoff_state:'blocked'}},{row:{status:'planned'}},{hold:true},
  {row:{art_direction_decisions:[{id:41,project_id:21,content_item_id:7001,channel:'threads',placement:'feed',decision:'NO_VISUAL_NEEDED',decision_version:1,source_content_revision:2,status:'active'}]}}]){
  test('P11 blocked handoff, hold or wrong-placement decision never passes local validation '+JSON.stringify(options),async()=>clientRun(options,async client=>{
    const r=await client.callTool({name:'ba_preview_publication_task',arguments:args});assert.equal(r.structuredContent.validation,'BLOCKED');
  }));
}
