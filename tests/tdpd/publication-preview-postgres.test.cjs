const test=require('node:test');const assert=require('node:assert/strict');const{randomUUID}=require('node:crypto');
require('ts-node/register/transpile-only');const{Client}=require('@modelcontextprotocol/sdk/client/index.js');
const{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');const{createPlannerMcpServer}=require('../../src/mcp/shared.ts');
const{prisma:db,pool}=require('../../src/db.ts');const{previewPublicationTask}=require('../../src/services/publication_preview.service.ts');
const{readPublicationPreview}=require('../../src/services/publication_preview_repository.ts');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'synthetic-db');assert.equal(url.pathname,'/preview_reliability_synthetic');
const savedFetch=global.fetch;let externalCalls=0;global.fetch=async()=>{externalCalls++;throw Error('SYNTHETIC-FORBIDDEN-PROVIDER-CALL');};
test.after(async()=>{global.fetch=savedFetch;await db.$disconnect();await pool.end();});
async function setup(t){
 const nonce=randomUUID(),user=await db.user.create({data:{email:`preview-${nonce}@example.invalid`,name:'Synthetic preview',password_hash:'not-a-login'}});
 const project=await db.project.create({data:{name:'Synthetic preview',slug:`preview-${nonce}`}});
 t.after(async()=>{await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
 await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,name:'Synthetic threads',type:'threads',is_active:true,
 config:{access_token:'SYNTHETIC-PREVIEW-SECRET',nested:{cookie:'SYNTHETIC-PREVIEW-COOKIE'}}}});
 const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',draft_text:'Synthetic accepted text',
 item_key:nonce,content_revision:1,accepted_revision:1,text_state:'accepted',visual_state:'NO_VISUAL_NEEDED',visual_mode:'auto_assess',
 visual_placement:'feed',visual_decision_version:1,status:'ready_for_execution',handoff_state:'ready',publication_mode:'owner_released',
 quality_report:{private_token:'SYNTHETIC-QUALITY-SECRET',publication_hold:false}}});
 await db.artDirectionDecision.create({data:{project_id:project.id,content_item_id:task.id,source_content_revision:1,decision_version:1,
 decision:'NO_VISUAL_NEEDED',channel:'threads',placement:'feed',status:'active',actor_id:`user:${user.id}`,reason:'Synthetic'}});
 return{user,project,task,args:{projectId:project.id,taskId:task.id},principal:{userId:user.id,actorId:`user:${user.id}`,projectId:project.id,profile:'publisher'}};
}
async function counts(s){return Promise.all([db.workflowEvent.count({where:{project_id:s.project.id}}),db.workItem.count({where:{project_id:s.project.id}}),
 db.deliveryAttempt.count({where:{project_id:s.project.id}}),db.publicationFact.count({where:{project_id:s.project.id}})]);}
test('PG01 actual MCP preview reads no secrets and creates no lifecycle mutations',async t=>{
 const s=await setup(t),before=await counts(s);const server=createPlannerMcpServer({profile:'publisher',principal:s.principal});
 const client=new Client({name:'preview-postgres',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(a);await client.connect(b);const result=await client.callTool({name:'ba_preview_publication_task',arguments:{...s.args,actorId:'user:999999'}});
 assert.notEqual(result.isError,true);assert.equal(result.structuredContent.validation,'LOCAL_VALID');assert.equal(result.structuredContent.submission_permitted,false);
 assert.ok(!/SYNTHETIC-(?:PREVIEW|QUALITY)/.test(JSON.stringify(result)));assert.deepEqual(await counts(s),before);assert.equal(externalCalls,0);
 const row=await db.contentItem.findUnique({where:{id:s.task.id}});assert.equal(row.updated_at.getTime(),s.task.updated_at.getTime());
 }finally{await client.close();await server.close();}
});
test('PG02 real repository projection never materializes credential/report payload',async t=>{
 const s=await setup(t);const result=await readPublicationPreview(s.args,s.user.id);
 assert.equal(Object.hasOwn(result.task.channel,'config'),false);assert.equal(Object.hasOwn(result.task,'quality_report'),false);
 assert.ok(!JSON.stringify(result).includes('SYNTHETIC-PREVIEW-SECRET'));assert.ok(!JSON.stringify(result).includes('SYNTHETIC-QUALITY-SECRET'));
});
test('PG03 database enforces READ ONLY transaction even if a dependency attempts DDL',async t=>{
 const s=await setup(t),saved=db.$transaction.bind(db);db.$transaction=(run,options)=>saved(async tx=>run(new Proxy(tx,{get(target,key){
 if(key==='projectMember')return{...target.projectMember,findUnique:async()=>{await tx.$executeRawUnsafe('CREATE TABLE planner.preview_forbidden_write(id INTEGER)');}};
 return target[key];}})),options);
 try{await assert.rejects(readPublicationPreview(s.args,s.user.id),/read-only transaction/);}
 finally{db.$transaction=saved;}
 const rows=await db.$queryRaw`SELECT to_regclass('planner.preview_forbidden_write') IS NULL AS absent`;assert.equal(rows[0].absent,true);
});
test('PG04 forged trusted principal and foreign tenant fail before task disclosure',async t=>{
 const s=await setup(t);await assert.rejects(previewPublicationTask(s.args,{...s.principal,actorId:'user:999999'}),/AUTHENTICATED_PRINCIPAL/);
 await assert.rejects(previewPublicationTask({...s.args,projectId:s.project.id+1000000},s.principal),/PROJECT_SCOPE_MISMATCH/);
 await assert.rejects(readPublicationPreview({...s.args,projectId:s.project.id+1000000},s.user.id),/PROJECT_ACCESS_DENIED/);
 assert.deepEqual(await counts(s),[0,0,0,0]);
});
test('PG05 hold SQL safely projects truthiness and local lifecycle blockers',async t=>{
 const s=await setup(t);await db.contentItem.update({where:{id:s.task.id},data:{quality_report:{publication_hold:{reason:'SYNTHETIC-QUALITY-SECRET'}},handoff_state:'blocked'}});
 const result=await previewPublicationTask(s.args,s.principal);assert.equal(result.validation,'BLOCKED');
 assert.ok(result.blockers.some(b=>b.code==='PREVIEW_PUBLICATION_HOLD'));assert.ok(result.blockers.some(b=>b.code==='PREVIEW_HANDOFF_NOT_READY'));
 assert.ok(!JSON.stringify(result).includes('SYNTHETIC-QUALITY-SECRET'));
});
test('PG06 malformed report cannot remove a hold or leak raw content',async t=>{
 const s=await setup(t);
 for(const quality_report of ['SYNTHETIC-MALFORMED-REPORT',[],false]){
 await db.contentItem.update({where:{id:s.task.id},data:{quality_report}});
 const result=await previewPublicationTask(s.args,s.principal);assert.equal(result.validation,'BLOCKED');
 assert.ok(result.blockers.some(b=>b.code==='PREVIEW_PUBLICATION_HOLD'));assert.ok(!JSON.stringify(result).includes('SYNTHETIC-MALFORMED-REPORT'));
 }
});
