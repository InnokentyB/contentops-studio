const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),path=require('node:path');
const url=new URL(process.env.DATABASE_URL||'http://invalid');assert.equal(url.hostname,'synthetic-db');assert.equal(url.pathname,'/shared_browser_synthetic');assert.equal(url.username,'synthetic');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {prisma:db,pool}=require(path.join(base,'db.js'));
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'),{Client}=require('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {registerBrowserPublicationTools}=require(path.join(base,'mcp/tools/browser_publication_tools.js'));
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
async function fixture(t){
 const nonce=randomUUID(),user=await db.user.create({data:{email:'synthetic-'+nonce+'@example.invalid',password_hash:'synthetic-no-login',name:'Synthetic'}});
 const project=await db.project.create({data:{name:'Synthetic diagnosis',slug:'synthetic-'+nonce}});
 t.after(async()=>{await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
 await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,type:'linkedin',name:'synthetic-company',config:{api_key:'private-fixture-token'}}});
 const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',status:'publishing',publication_mode:'browser_required',draft_text:'private fixture body',content_revision:1,accepted_revision:1,text_state:'accepted',visual_state:'NO_VISUAL_NEEDED'}});
 const actorId='user:'+user.id,key='synthetic-'+nonce;
 const work=await db.workItem.create({data:{project_id:project.id,content_item_id:task.id,item_key:nonce,kind:'browser_publish',state:'claimed',assignee_role:'browser_publisher',input_context_version:1,lease_token:'private-fixture-lease',lease_actor_id:actorId,lease_expires_at:new Date(Date.now()+60000)}});
 const attempt=await db.deliveryAttempt.create({data:{project_id:project.id,content_item_id:task.id,channel_id:channel.id,status:'pending',idempotency_key:key,requires_manual_confirmation:true}});
 await db.workflowEvent.create({data:{project_id:project.id,content_item_id:task.id,work_item_id:work.id,actor_id:actorId,command:'ba_start_browser_submission',idempotency_key:key,after_state:{attempt_id:attempt.id,submission_permitted:false}}});
 return{user,project,task,work,attempt,key,actorId};
}
async function read(s){
 const server=new McpServer({name:'synthetic-real-db-diagnosis',version:'1'});registerBrowserPublicationTools(server);
 const client=new Client({name:'synthetic-owner',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(a);await client.connect(b);return await withPublicationPrincipal({userId:s.user.id,actorId:s.actorId,projectId:s.project.id,profile:'owner'},()=>client.callTool({name:'ba_diagnose_browser_publication',arguments:{projectId:s.project.id,taskId:s.task.id,actorId:s.actorId}}));}
 finally{await client.close();await server.close();}
}
async function state(s){return{task:await db.contentItem.findUnique({where:{id:s.task.id}}),work:await db.workItem.findUnique({where:{id:s.work.id}}),attempts:await db.deliveryAttempt.findMany({where:{project_id:s.project.id}}),audits:await db.workflowEvent.findMany({where:{project_id:s.project.id}})};}
for(const kind of ['active','expired','permit','revoked'])test('actual PostgreSQL registered diagnosis: '+kind,async t=>{
 const s=await fixture(t);
 if(kind==='expired')await db.workItem.update({where:{id:s.work.id},data:{lease_expires_at:new Date(Date.now()-1000)}});
 if(kind==='permit')await db.workflowEvent.create({data:{project_id:s.project.id,content_item_id:s.task.id,work_item_id:s.work.id,actor_id:s.actorId,command:'ba_pre_submit_browser_submission',idempotency_key:s.key,after_state:{attempt_id:s.attempt.id,submission_permitted:true}}});
 if(kind==='revoked')await db.projectMember.delete({where:{project_id_user_id:{project_id:s.project.id,user_id:s.user.id}}});
 const before=await state(s),r=await read(s),d=r.structuredContent||JSON.parse(r.content[0].text);
 if(kind==='revoked'){assert.equal(r.isError,true);assert.equal(d.code,'OWNER_REQUIRED');}
 else{assert.notEqual(r.isError,true);assert.equal(d.submission_permitted,false);assert.equal(d.next_action,kind==='active'?'continue_existing_preparation':kind==='expired'?'recover_existing_preparation':'reconcile_existing_attempt');if(kind==='active')assert.equal(d.execution_state.code,'BROWSER_PREPARATION_ACTIVE');if(kind==='expired')assert.equal(d.execution_state.code,'BROWSER_PREPARATION_LEASE_EXPIRED');}
 assert.deepEqual(await state(s),before);
 for(const secret of ['private-fixture-token','private-fixture-lease','private fixture body',s.key])assert.ok(!JSON.stringify(r).includes(secret));
});
test.after(async()=>{await db.$disconnect();await pool.end();});
