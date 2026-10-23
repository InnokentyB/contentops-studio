const test=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');const path=require('node:path');
const url=new URL(process.env.DATABASE_URL||'http://invalid');
assert.equal(url.hostname,'synthetic-db');assert.equal(url.pathname,'/shared_browser_synthetic');assert.equal(url.username,'synthetic');
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_KEY='synthetic-only';process.env.TELEGRAM_BOT_TOKEN='synthetic-only';
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {prisma:db,pool}=require(path.join(base,'db.js'));
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
const {registerTaskPublicationTools}=require(path.join(base,'mcp/tools/task_publication_tools.js'));
const handlers=new Map();registerTaskPublicationTools({registerTool(name,_options,handler){handlers.set(name,handler);}});
const command='ba_prepare_approved_publication';
test.after(async()=>{await db.$disconnect();await pool.end();});
async function fixture(t){
 const nonce=randomUUID();
 const user=await db.user.create({data:{email:'readiness-'+nonce+'@example.invalid',password_hash:'not-a-login',name:'Synthetic'}});
 const project=await db.project.create({data:{name:'Synthetic preparation',slug:'synthetic-'+nonce}});
 t.after(async()=>{await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
 await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
 await db.projectSettings.create({data:{project_id:project.id,key:'art_direction_pipeline_enabled',value:'true'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,name:'synthetic_telegram',type:'telegram',is_active:true,config:{platform:'telegram',content_language:'ru',api_key:'synthetic-secret-must-not-leak'}}});
 const task=await db.contentItem.create({data:{project_id:project.id,channel_id:channel.id,type:'publication',item_key:nonce,
  title:'Synthetic accepted title',brief:'Current operator brief',draft_text:'Accepted synthetic body',text_state:'accepted',content_revision:1,accepted_revision:1,
  visual_mode:'auto_assess',visual_state:'APPROVED',visual_placement:'feed',visual_decision_version:1,handoff_state:'ready',status:'approved',publication_mode:'approval_required',
  schedule_at:new Date('2026-10-23T11:07:34Z'),publish_at:new Date('2026-10-23T11:07:34Z'),quality_report:{content_language:'ru',execution_mode:'assisted',publication_route:'connector_auto',handoff_bundle:{stale:true}}}});
 const decision=await db.artDirectionDecision.create({data:{project_id:project.id,content_item_id:task.id,decision_version:1,source_content_revision:1,channel:'telegram',placement:'feed',decision:'GENERATE',reason:'Synthetic existing review',actor_id:'user:'+user.id}});
 const asset=await db.imageAsset.create({data:{project_id:project.id,content_item_id:task.id,decision_id:decision.id,content_revision:1,placement:'feed',status:'approved',prompt:'Synthetic',file_url:'https://example.invalid/synthetic.jpg',reviewed_by:'synthetic-reviewer',reviewed_at:new Date('2026-10-22T12:00:00Z'),review_reason:'Existing review',qa_report:{approved:true}}});
 await db.contentItem.update({where:{id:task.id},data:{selected_asset_id:asset.id}});
 const principal={userId:user.id,actorId:'user:'+user.id,projectId:project.id,profile:'publisher'};
 return{user,project,channel,task,asset,decision,principal};
}
async function prepare(s,principal=s.principal){
 const result=await withPublicationPrincipal(principal,()=>handlers.get('ba_prepare_publication_task')({projectId:s.project.id,taskId:s.task.id}));
 if(result.isError)throw Error(result.content[0].text);
 return result;
}
function payload(result){return JSON.parse(result.content[0].text);}
async function current(s){return db.contentItem.findUnique({where:{id:s.task.id}});}
async function auditCount(s){return db.workflowEvent.count({where:{project_id:s.project.id,content_item_id:s.task.id,command}});}
test('registered MCP prepares the exact approved package, audits once, preserves review and cannot send',async t=>{
 const s=await fixture(t),before=await current(s),asset=await db.imageAsset.findUnique({where:{id:s.asset.id}});
 const result=payload(await prepare(s)),after=await current(s);
 assert.equal(after.status,'ready_for_execution');assert.equal(after.publication_mode,'approval_required');
 for(const key of ['draft_text','content_revision','accepted_revision','selected_asset_id','visual_state','visual_decision_version','brief'])assert.deepEqual(after[key],before[key]);
 assert.deepEqual(await db.imageAsset.findUnique({where:{id:s.asset.id}}),asset);
 for(const key of ['content_language','execution_mode','publication_route'])assert.equal(after.quality_report[key],before.quality_report[key]);
 assert.equal(after.quality_report.handoff_bundle.publication.body,before.draft_text);
 assert.equal(after.quality_report.handoff_bundle.task.schedule_at,before.schedule_at.toISOString());
 assert.equal(await auditCount(s),1);assert.equal(result.item.status,'ready_for_execution');
 assert.ok(!JSON.stringify(result).includes('synthetic-secret-must-not-leak'));
 const event=await db.workflowEvent.findFirst({where:{project_id:s.project.id,command}});
 assert.equal(event.actor_id,s.principal.actorId);assert.equal(event.after_state.publication_authorized,false);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),0);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),0);
 const replay=payload(await prepare(s));assert.ok(!JSON.stringify(replay).includes('synthetic-secret-must-not-leak'));
 assert.deepEqual(await current(s),after);assert.equal(await auditCount(s),1);
});
for(const state of ['ready_for_execution','owner_released'])test('preserve existing '+state+' behavior without readiness writes',async t=>{
 const s=await fixture(t);await db.contentItem.update({where:{id:s.task.id},data:state==='owner_released'?{status:'ready_for_execution',publication_mode:state}:{status:state}});
 const before=await current(s);await prepare(s,null);assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('drafted task is not implicitly accepted or promoted',async t=>{
 const s=await fixture(t);await db.contentItem.update({where:{id:s.task.id},data:{status:'drafted'}});
 const before=await current(s);await prepare(s);assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
for(const deny of ['missing principal','foreign project','revoked member','viewer','demo'])test('deny readiness mutation for '+deny,async t=>{
 const s=await fixture(t);let principal=s.principal;
 if(deny==='missing principal')principal=null;
 if(deny==='foreign project')principal={...principal,projectId:s.project.id+100000};
 if(deny==='revoked member')await db.projectMember.delete({where:{project_id_user_id:{project_id:s.project.id,user_id:s.user.id}}});
 if(deny==='viewer')await db.projectMember.update({where:{project_id_user_id:{project_id:s.project.id,user_id:s.user.id}},data:{role:'viewer'}});
 if(deny==='demo')await db.user.update({where:{id:s.user.id},data:{is_demo:true}});
 const before=await current(s);await assert.rejects(prepare(s,principal));assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
for(const deny of ['rejected asset','inactive decision','wrong decision revision','required without visual','stale asset'])test('deny invalid visual '+deny+' even when pipeline flag disabled',async t=>{
 const s=await fixture(t);await db.projectSettings.update({where:{project_id_key:{project_id:s.project.id,key:'art_direction_pipeline_enabled'}},data:{value:'false'}});
 if(deny==='rejected asset')await db.imageAsset.update({where:{id:s.asset.id},data:{status:'rejected'}});
 if(deny==='inactive decision')await db.artDirectionDecision.update({where:{id:s.decision.id},data:{status:'superseded'}});
 if(deny==='wrong decision revision')await db.artDirectionDecision.update({where:{id:s.decision.id},data:{source_content_revision:2}});
 if(deny==='required without visual')await db.contentItem.update({where:{id:s.task.id},data:{visual_mode:'required',visual_state:'NO_VISUAL_NEEDED',selected_asset_id:null}});
 if(deny==='stale asset')await db.imageAsset.update({where:{id:s.asset.id},data:{content_revision:2}});
 const before=await current(s);await assert.rejects(prepare(s));assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
for(const deny of ['hold','uncertainty','attempt','release','executor','lease','storage'])test('deny existing authority or blocker: '+deny,async t=>{
 const s=await fixture(t);
 if(deny==='hold'||deny==='uncertainty')await db.contentItem.update({where:{id:s.task.id},data:{quality_report:deny==='hold'?{publication_hold:{reason:'synthetic'}}:{provider_result_uncertain:true}}});
 if(deny==='attempt')await db.deliveryAttempt.create({data:{project_id:s.project.id,content_item_id:s.task.id,channel_id:s.channel.id,status:'pending',attempt_number:1,idempotency_key:'synthetic-old'}});
 if(deny==='release')await db.workflowEvent.create({data:{project_id:s.project.id,content_item_id:s.task.id,actor_id:s.principal.actorId,command:'ba_release_approved_telegram_task',idempotency_key:'synthetic-old'}});
 if(deny==='executor'||deny==='lease')await db.workItem.create({data:{project_id:s.project.id,content_item_id:s.task.id,item_key:'synthetic-blocker',kind:deny==='executor'?'browser_publish':'content_review',state:deny==='lease'?'claimed':'available',assignee_role:'publisher',lease_token:deny==='lease'?'synthetic-private-lease':null}});
 if(deny==='storage')await db.projectSettings.create({data:{project_id:s.project.id,key:'visual_storage_ingest_state',value:JSON.stringify({blocked:true,reason:'synthetic_storage'})}});
 const before=await current(s);await assert.rejects(prepare(s));assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('audit failure rolls back prepared state and handoff',async t=>{
 const s=await fixture(t),before=await current(s),original=db.$transaction.bind(db);
 db.$transaction=(run,options)=>original(tx=>run(new Proxy(tx,{get(target,key){if(key==='workflowEvent')return{...target.workflowEvent,create:async()=>{throw Error('synthetic audit rejection');}};return target[key];}})),options);
 try{await assert.rejects(prepare(s));}finally{db.$transaction=original;}
 assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('valid no-visual decision can prepare without creating a review',async t=>{
 const s=await fixture(t);await db.artDirectionDecision.update({where:{id:s.decision.id},data:{decision:'NO_VISUAL_NEEDED'}});
 await db.contentItem.update({where:{id:s.task.id},data:{visual_state:'NO_VISUAL_NEEDED',selected_asset_id:null}});
 await prepare(s);assert.equal((await current(s)).status,'ready_for_execution');assert.equal(await auditCount(s),1);
});
test('canonical publication fact cannot be reopened by preparation',async t=>{
 const s=await fixture(t);await db.publicationFact.create({data:{project_id:s.project.id,content_item_id:s.task.id,channel_id:s.channel.id,artifact_kind:'post',outcome:'published',confirmation_mode:'automatic',confirmed_by:s.principal.actorId}});
 const before=await current(s);await assert.rejects(prepare(s));assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('CAS failure rolls back and returns an actionable bounded diagnostic',async t=>{
 const s=await fixture(t),before=await current(s),original=db.$transaction.bind(db);
 db.$transaction=(run,options)=>original(tx=>run(new Proxy(tx,{get(target,key){if(key==='contentItem')return{...target.contentItem,updateMany:async()=>({count:0})};return target[key];}})),options);
 try{await assert.rejects(prepare(s),error=>/PREPARE_READINESS_PACKAGE_CONFLICT/.test(error.message)&&/Read the current task/.test(error.message));}finally{db.$transaction=original;}
 assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('concurrent package change between read and lock is preserved and never promoted',async t=>{
 const s=await fixture(t),original=db.$transaction.bind(db);let changed=false;
 db.$transaction=async(run,options)=>{
  if(!changed){changed=true;await db.contentItem.update({where:{id:s.task.id},data:{draft_text:'A different current package'}});}
  return original(run,options);
 };
 try{await assert.rejects(prepare(s),/PREPARE_READINESS_PACKAGE_CONFLICT/);}finally{db.$transaction=original;}
 const after=await current(s);assert.equal(after.status,'approved');assert.equal(after.draft_text,'A different current package');assert.equal(await auditCount(s),0);
});
test('racing preparation commits at most one audit and no send authority',async t=>{
 const s=await fixture(t),results=await Promise.allSettled([prepare(s),prepare(s)]);
 assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal((await current(s)).status,'ready_for_execution');
 assert.equal(await auditCount(s),1);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),0);
});
test('a different transport retains existing approval preservation behavior',async t=>{
 const s=await fixture(t);await db.socialChannel.update({where:{id:s.channel.id},data:{type:'reddit',config:{platform:'reddit'}}});
 const before=await current(s);await prepare(s,null);assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('an unfinished persisted visual reassessment cannot be skipped',async t=>{
 const s=await fixture(t);await db.workflowEvent.create({data:{project_id:s.project.id,content_item_id:s.task.id,actor_id:s.principal.actorId,command:'ba_request_publication_visual_reassessment',after_state:{binding:{version:1}}}});
 const before=await current(s);await assert.rejects(prepare(s));assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('MCP returns a specific safe cause and correction for a scope mismatch',async t=>{
 const s=await fixture(t),principal={...s.principal,projectId:s.project.id+100000};
 const result=await withPublicationPrincipal(principal,()=>handlers.get('ba_prepare_publication_task')({projectId:s.project.id,taskId:s.task.id}));
 assert.equal(result.isError,true);const diagnostic=payload(result);
 assert.equal(diagnostic.code,'PREPARE_READINESS_SCOPE_MISMATCH');assert.equal(diagnostic.retry_allowed,false);
 assert.match(diagnostic.reasons[0].action,/authorized preparation profile/);
 assert.ok(!JSON.stringify(result).includes('synthetic-secret-must-not-leak'));assert.equal(await auditCount(s),0);
});
for(const kind of ['hold','invalid reassessment'])test('MCP diagnoses '+kind+' without an opaque publication error',async t=>{
 const s=await fixture(t);
 if(kind==='hold')await db.contentItem.update({where:{id:s.task.id},data:{quality_report:{publication_hold:{reason:'synthetic'}}}});
 else await db.workflowEvent.create({data:{project_id:s.project.id,content_item_id:s.task.id,actor_id:s.principal.actorId,command:'ba_request_publication_visual_reassessment',after_state:{binding:{version:1}}}});
 const result=await withPublicationPrincipal(s.principal,()=>handlers.get('ba_prepare_publication_task')({projectId:s.project.id,taskId:s.task.id}));
 assert.equal(result.isError,true);const diagnostic=payload(result);
 assert.equal(diagnostic.code,kind==='hold'?'PREPARE_READINESS_HOLD_ACTIVE':'PREPARE_READINESS_VISUAL_BINDING_INVALID');
 assert.ok(diagnostic.reasons[0].action.length>20);assert.equal(diagnostic.retry_allowed,false);
});
test('imported handoff preserves exact accepted content and never returns or persists account secrets',async t=>{
 const s=await fixture(t),slot=s.task.schedule_at.toISOString();
 await db.projectSettings.createMany({data:[
  {project_id:s.project.id,key:'publication_plan_meta',value:JSON.stringify({plan_id:'synthetic-plan'})},
  {project_id:s.project.id,key:'publication_plan_assets',value:'{}'},
  {project_id:s.project.id,key:'publication_plan_accounts',value:JSON.stringify({synthetic_telegram:{platform:'telegram',api_key:'synthetic-import-secret',bot_token:'synthetic-bot-secret'}})}
 ]});
 await db.contentItem.update({where:{id:s.task.id},data:{assets:{action:{id:'synthetic-action',action_type:'telegram_post:publish',scheduled_at:slot}}}});
 const result=payload(await prepare(s)),after=await current(s);
 assert.equal(after.status,'ready_for_execution');assert.equal(result.bundle.task.schedule_at,slot);
 assert.equal(result.bundle.publication.body,s.task.draft_text);
 for(const secret of ['synthetic-import-secret','synthetic-bot-secret']){
  assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(after.quality_report.handoff_bundle).includes(secret));
 }
 const replay=payload(await prepare(s));assert.ok(!JSON.stringify(replay).includes('synthetic-bot-secret'));
});
test('concurrent asset replacement is rejected even with an unchanged millisecond timestamp',async t=>{
 const s=await fixture(t),original=db.$transaction.bind(db);let changed=false;
 db.$transaction=async(run,options)=>{
  if(!changed){changed=true;await db.imageAsset.update({where:{id:s.asset.id},data:{file_url:'https://example.invalid/replaced.jpg',updated_at:s.asset.updated_at}});}
  return original(run,options);
 };
 try{await assert.rejects(prepare(s),/PREPARE_READINESS_PACKAGE_CONFLICT/);}finally{db.$transaction=original;}
 assert.equal((await current(s)).status,'approved');assert.equal(await auditCount(s),0);
});
test('an imported stale slot cannot silently become ready',async t=>{
 const s=await fixture(t);
 await db.projectSettings.createMany({data:[
  {project_id:s.project.id,key:'publication_plan_meta',value:JSON.stringify({plan_id:'synthetic-plan'})},
  {project_id:s.project.id,key:'publication_plan_assets',value:'{}'},
  {project_id:s.project.id,key:'publication_plan_accounts',value:JSON.stringify({synthetic_telegram:{platform:'telegram'}})}
 ]});
 await db.contentItem.update({where:{id:s.task.id},data:{assets:{action:{id:'synthetic-action',action_type:'telegram_post:publish',scheduled_at:'2026-10-22T11:07:34.000Z'}}}});
 const before=await current(s);await assert.rejects(prepare(s),/PREPARE_READINESS_SCHEDULE_CONFLICT/);
 assert.deepEqual(await current(s),before);assert.equal(await auditCount(s),0);
});
test('read-only preparation also sanitizes legacy stored handoff and asset metadata without rewriting it',async t=>{
 const s=await fixture(t);
 await db.imageAsset.update({where:{id:s.asset.id},data:{provenance:{authorization:'synthetic-old-asset-secret',source:'synthetic'},qa_report:{headers:{cookie:'synthetic-old-cookie'}}}});
 await db.contentItem.update({where:{id:s.task.id},data:{status:'ready_for_execution',quality_report:{handoff_bundle:{account:{details:{bot_token:'synthetic-old-handoff-secret'}}}}}});
 const before=await current(s),assetBefore=await db.imageAsset.findUnique({where:{id:s.asset.id}}),result=payload(await prepare(s,null));
 for(const secret of ['synthetic-old-asset-secret','synthetic-old-cookie','synthetic-old-handoff-secret'])assert.ok(!JSON.stringify(result).includes(secret));
 assert.deepEqual(await current(s),before);assert.deepEqual(await db.imageAsset.findUnique({where:{id:s.asset.id}}),assetBefore);assert.equal(await auditCount(s),0);
});
test('lost commit acknowledgement is reported as unconfirmed, then reconciled without another preparation audit',async t=>{
 const s=await fixture(t),original=db.$transaction.bind(db);
 db.$transaction=async(run,options)=>{await original(run,options);throw Error('synthetic lost commit acknowledgement');};
 try{await assert.rejects(prepare(s),/PREPARE_READINESS_TRANSACTION_UNCONFIRMED/);}finally{db.$transaction=original;}
 assert.equal((await current(s)).status,'ready_for_execution');assert.equal(await auditCount(s),1);
 await prepare(s);assert.equal(await auditCount(s),1);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.task.id}}),0);
});
