const {test,after}=require('node:test');const assert=require('node:assert/strict');
const {db,pool,setup,receipt}=require('../fixtures/owned-publication-store.cjs');
after(async()=>{await db.$disconnect();await pool.end();});
test('L01/L02 two unrelated owner packages release and publish through same service',async()=>{
 for(let i=0;i<2;i++){
  const f=await setup();const rel=await f.service().execute(await f.bound(),f.principal);assert.equal(rel.state,'released');
  const pub=await f.bound('publish');delete pub.approvalReference;pub.idempotencyKey='publish-'+f.task.id;
  const result=await f.service().execute(pub,f.principal);assert.equal(result.state,'published');assert.equal(f.calls.publish,1);
  assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),1);assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),1);
  const claimEvent=await db.workflowEvent.findFirst({where:{content_item_id:f.task.id,command:'owned_publication.claim'}});assert.equal(claimEvent.after_state.actor_id,f.principal.actorId);
  const job=await db.connectorDispatchJob.findFirst({where:{content_item_id:f.task.id}});assert.equal(job.state,'confirmed');assert.equal(job.binding.protocol,'owned_provider_v1');assert.equal(job.binding.provider,'dzen');
 }
});
test('L03 dryRun defaults true and foreign/role/stale bindings have zero effect',async()=>{
 const f=await setup();const request=await f.bound();delete request.dryRun;const result=await f.service().execute(request,f.principal);assert.equal(result.state,'preview');assert.equal(f.calls.publish+f.calls.inventory,0);assert.equal(await db.workItem.count({where:{content_item_id:f.task.id}}),0);
 for(const principal of [{...f.principal,projectId:f.project.id+10000},{...f.principal,actorId:'user:999999'}, {...f.principal,profile:'publisher'}])await assert.rejects(f.service().execute(await f.bound(),principal));
 const stale=await f.bound();stale.expectedAcceptedRevision++;await assert.rejects(f.service().execute(stale,f.principal));assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),0);
});
test('L04 parallel keys have one claim and one submit permit; all later calls reconcile',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const a=await f.bound('publish');delete a.approvalReference;const b={...a,idempotencyKey:'other-key'};
 const rs=await Promise.allSettled([f.service().execute(a,f.principal),f.service().execute(b,f.principal)]);assert.ok(rs.some(r=>r.status==='fulfilled'));assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),1);assert.equal(f.calls.publish,1);
});
test('L05 started/unknown legacy attempt blocks new release, job and send',async()=>{
 const f=await setup();await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,status:'pending',mode:'automatic',idempotency_key:'legacy-key'}});
 await assert.rejects(f.service().execute(await f.bound(),f.principal));assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),0);assert.equal(f.calls.publish,0);
});
test('L06 retained receipt survives drift and fact failure; same attempt finalizes after repair',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const a=await f.bound('publish');delete a.approvalReference;
 const p=await f.getStore().inspect(a,f.principal);const c=await f.getStore().claim(a,f.principal,await f.adapter.inventory(p));await f.getStore().start(a,f.principal,c);await f.getStore().submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:c.package.accountId});
 await db.contentItem.update({where:{id:f.task.id},data:{draft_text:'drift'}});await f.getStore().saveReceipt(c,receipt(c));await assert.rejects(f.getStore().confirm(a,f.principal,c));assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);
 await db.contentItem.update({where:{id:f.task.id},data:{draft_text:p.body}});const r=await f.getStore().confirm(a,f.principal,c);assert.equal(r.state,'published');assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),1);
});
const {legacy}=require('../fixtures/owned-publication-store.cjs');
test('L07 legacy retained receipt is adopted into original attempt without new job/release/send',async()=>{
 const f=await setup(),old=await legacy(f,true),attempt=await old.createAttempt();
 const req={projectId:f.project.id,taskId:f.task.id,operation:'reconcile',dryRun:false,idempotencyKey:attempt.idempotency_key,attemptId:attempt.id};
 const r=await f.service().execute(req,f.principal);assert.equal(r.state,'published');assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),1);assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),0);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.release'}}),0);assert.equal(f.calls.publish+f.calls.readback,0);
});
test('L08 original valid legacy release is consumed without renewed approval identity',async()=>{
 const f=await setup(),old=await legacy(f);const pub=await f.bound('publish');delete pub.approvalReference;pub.idempotencyKey='consume-legacy-'+f.task.id;
 const r=await f.service().execute(pub,f.principal);assert.equal(r.state,'published');const job=await db.connectorDispatchJob.findFirst({where:{content_item_id:f.task.id}});assert.equal(job.binding.release_id,old.release.id);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.release'}}),0);
});
test('L09 lost receipt recovery reads only committed native object and never submits again',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const a=await f.bound('publish');delete a.approvalReference;
 const p=await f.getStore().inspect(a,f.principal),c=await f.getStore().claim(a,f.principal,await f.adapter.inventory(p));await f.getStore().start(a,f.principal,c);await f.getStore().submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:p.accountId});
 f.adapter.readback=async original=>{f.calls.readback++;assert.equal(original.nativeObjectId,'Synthetic'+c.attemptId);return receipt(original);};
 const req={projectId:f.project.id,taskId:f.task.id,operation:'reconcile',dryRun:false,idempotencyKey:c.key,attemptId:c.attemptId};const r=await f.service().execute(req,f.principal);assert.equal(r.state,'published');assert.equal(f.calls.readback,1);assert.equal(f.calls.publish,0);await assert.rejects(f.getStore().submit(a,f.principal,c,{objectId:'Foreign',accountId:p.accountId}));
});
function separate(data){return new Promise((resolve,reject)=>{const child=require('node:child_process').fork(require.resolve('../fixtures/owned-publication-race-child.cjs'),[],{stdio:['ignore','ignore','pipe','ipc']});let message;child.on('message',m=>message=m);child.on('error',reject);child.on('exit',code=>message?resolve(message):reject(Error('child failed '+code)));child.send(data);});}
test('L10 separate PostgreSQL processes serialize generic/generic and legacy CAS pattern races',async()=>{
 for(const old of [false,true]){const f=await setup();await f.service().execute(await f.bound(),f.principal);const a=await f.bound('publish');delete a.approvalReference;const p=await f.getStore().inspect(a,f.principal),inventory=await f.adapter.inventory(p),base={request:a,principal:f.principal,manifest:p.manifest,inventory};
 const rs=await Promise.all([separate(base),separate({...base,legacy:old,request:{...a,idempotencyKey:'competitor'}})]);assert.equal(rs.filter(x=>x.ok).length,1);assert.ok(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}})<=1);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).status,'publishing');}
});
test('L11 real mixed-provider queue selection excludes generic binding before legacy VK decoder',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);
 const vk=await db.socialChannel.create({data:{project_id:f.project.id,type:'vk',name:'Synthetic vk',config:{}}});
 const task=await db.contentItem.create({data:{project_id:f.project.id,channel_id:vk.id,type:'vk_post'}});const asset=await db.imageAsset.create({data:{project_id:f.project.id,content_item_id:task.id,prompt:'synthetic'}});const wi=await db.workItem.create({data:{project_id:f.project.id,content_item_id:task.id,item_key:'synthetic-vk',kind:'browser_publish',state:'available',assignee_role:'publisher'}});
 const legacyJob=await db.connectorDispatchJob.create({data:{project_id:f.project.id,content_item_id:task.id,channel_id:vk.id,work_item_id:wi.id,content_revision:1,selected_asset_id:asset.id,package_sha256:'a'.repeat(64),binding:{legacy:'vk'},idempotency_key:'synthetic-vk'}});
 const {legacyProviderJobWhere}=require('../../src/services/publication_provider_queue');const rows=await db.connectorDispatchJob.findMany({where:{project_id:f.project.id,...legacyProviderJobWhere('vk')}});assert.deepEqual(rows.map(j=>j.id),[legacyJob.id]);
});
async function releasedClaim(f){await f.service().execute(await f.bound(),f.principal);const a=await f.bound('publish');delete a.approvalReference;const pkg=await f.getStore().inspect(a,f.principal);const c=await f.getStore().claim(a,f.principal,await f.adapter.inventory(pkg));return {a,c,pkg};}
async function submitted(f){const state=await releasedClaim(f);await f.getStore().start(state.a,f.principal,state.c);await f.getStore().submit(state.a,f.principal,state.c,{objectId:'Synthetic'+state.c.attemptId,accountId:state.pkg.accountId});return state;}
test('L12 denied/incomplete inventory never creates attempt or mutates release job',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const a=await f.bound('publish');delete a.approvalReference;
 f.adapter.authorize=async()=>{throw Error('policy unknown');};await assert.rejects(f.service().execute(a,f.principal),/policy unknown/);
 f.adapter.authorize=async()=>{};f.adapter.inventory=async p=>({complete:false,absent:true,accountId:p.accountId,packageDigest:p.digest,checkedAt:new Date().toISOString()});await assert.rejects(f.service().execute(a,f.principal),/INVENTORY_INCOMPLETE/);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);assert.equal((await db.connectorDispatchJob.findFirst({where:{content_item_id:f.task.id}})).state,'released');assert.equal(f.calls.publish,0);
});
test('L13 start and Submit are single-use and lease expiry never permits resend',async()=>{
 const f=await setup(),{a,c}=await releasedClaim(f);await f.getStore().start(a,f.principal,c);await assert.rejects(f.getStore().start(a,f.principal,c));
 await assert.rejects(f.getStore().submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:'foreign'}));await f.getStore().submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:c.package.accountId});await assert.rejects(f.getStore().submit(a,f.principal,c,{objectId:'Changed',accountId:c.package.accountId}));
 await db.connectorDispatchJob.update({where:{id:c.jobId},data:{canonical_lease_expires_at:new Date(0)}});assert.equal((await f.service().execute({...a,idempotencyKey:'new-key'},f.principal)).state,'verification_required');assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),1);
});
test('L14 post-submit role/manifest/package drift retains receipt and blocks fact until repair',async()=>{
 const f=await setup(),{a,c}=await submitted(f);const original=c.package.body;await db.projectMember.update({where:{project_id_user_id:{project_id:f.project.id,user_id:f.u.id}},data:{role:'viewer'}});await db.contentItem.update({where:{id:f.task.id},data:{draft_text:'changed',quality_report:{publication_hold:true}}});
 await f.getStore().saveReceipt(c,receipt(c));assert.ok(await f.getStore().retained(c));await assert.rejects(f.getStore().confirm(a,f.principal,c));assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);
 await db.projectMember.update({where:{project_id_user_id:{project_id:f.project.id,user_id:f.u.id}},data:{role:'owner'}});await db.contentItem.update({where:{id:f.task.id},data:{draft_text:original,quality_report:{}}});assert.equal((await f.getStore().confirm(a,f.principal,c)).state,'published');
});
test('L15 claim and receipt audit failures roll back all related PostgreSQL transitions',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const a=await f.bound('publish');delete a.approvalReference;const pkg=await f.getStore().inspect(a,f.principal),inventory=await f.adapter.inventory(pkg);
 const functionName='synthetic_fail_'+f.task.id;
 await pool.query(`CREATE FUNCTION planner.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.content_item_id=${f.task.id} AND NEW.command='owned_publication.claim' THEN RAISE EXCEPTION 'synthetic claim fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${functionName} BEFORE INSERT ON planner.workflow_events FOR EACH ROW EXECUTE FUNCTION planner.${functionName}()`);
 try{await assert.rejects(f.getStore().claim(a,f.principal,inventory),/synthetic claim fault/);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).status,'ready_for_execution');}finally{await pool.query(`DROP TRIGGER ${functionName} ON planner.workflow_events; DROP FUNCTION planner.${functionName}()`);}
 const c=await f.getStore().claim(a,f.principal,inventory);await f.getStore().start(a,f.principal,c);await f.getStore().submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:pkg.accountId});
 await pool.query(`CREATE FUNCTION planner.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.content_item_id=${f.task.id} AND NEW.command='owned_publication.receipt' THEN RAISE EXCEPTION 'synthetic receipt fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${functionName} BEFORE INSERT ON planner.workflow_events FOR EACH ROW EXECUTE FUNCTION planner.${functionName}()`);
 try{await assert.rejects(f.getStore().saveReceipt(c,receipt(c)),/synthetic receipt fault/);assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'pending');assert.equal((await db.connectorDispatchJob.findUnique({where:{id:c.jobId}})).state,'submit_consumed');}finally{await pool.query(`DROP TRIGGER ${functionName} ON planner.workflow_events; DROP FUNCTION planner.${functionName}()`);}
});
test('L16 afterWrite fault rolls back fact, attempt, job-link and audit while receipt survives',async()=>{
 const f=await setup(),{a,c}=await submitted(f);await f.getStore().saveReceipt(c,receipt(c));const {OwnedPublicationStore}=require('../../src/services/owned_publication_store');
 const broken=new OwnedPublicationStore({...f.dependencies,facts:{record:args=>f.dependencies.facts.record({...args,afterWrite:async(tx,id)=>{await args.afterWrite(tx,id);throw Error('synthetic job-link fault');}})}});
 await assert.rejects(broken.confirm(a,f.principal,c),/synthetic job-link fault/);assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'verification_required');const job=await db.connectorDispatchJob.findUnique({where:{id:c.jobId}});assert.equal(job.state,'receipt_retained');assert.equal(job.publication_fact_id,null);assert.ok(await f.getStore().retained(c));
 const rs=await Promise.all([f.getStore().confirm(a,f.principal,c),f.getStore().confirm(a,f.principal,c)]);assert.ok(rs.every(r=>r.state==='published'));const complete=await db.connectorDispatchJob.findUnique({where:{id:c.jobId}});assert.equal(complete.publication_fact_id,(await db.publicationFact.findFirst({where:{content_item_id:f.task.id}})).id);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.completed'}}),1);
});
test('L17 wrong native receipt fields/object/time/extra payload stay noncanonical',async()=>{
 const f=await setup(),{a,c}=await submitted(f);const valid=receipt(c);
 for(const patch of [{objectId:'Different',url:'https://dzen.ru/a/Different'},{accountId:'foreign'},{bodySha256:'a'.repeat(64)},{assetSha256:'b'.repeat(64)},{title:'changed'},{publishedAt:'2026-10-01T12:00:00.000Z'},{cookie:'forbidden'}])await assert.rejects(f.getStore().saveReceipt(c,{...valid,...patch}));assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'pending');
 await f.getStore().saveReceipt(c,valid);await assert.rejects(f.getStore().saveReceipt(c,{...valid,observedAt:new Date(Date.parse(valid.observedAt)+1).toISOString()}));assert.equal((await f.getStore().confirm(a,f.principal,c)).state,'published');
});
test('L18 release replay retains original identity after consumption; stale release/queue binding rejected',async()=>{
 const f=await setup(),releaseRequest=await f.bound();const first=await f.service().execute(releaseRequest,f.principal);const pub=await f.bound('publish');delete pub.approvalReference;assert.equal((await f.service().execute(pub,f.principal)).state,'published');const repeated=await f.service().execute(releaseRequest,f.principal);assert.equal(repeated.release_id,first.release_id);assert.equal(repeated.job_id,first.job_id);assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),1);
 const other=await setup();await other.service().execute(await other.bound(),other.principal);const a=await other.bound('publish');delete a.approvalReference;const job=await db.connectorDispatchJob.findFirst({where:{content_item_id:other.task.id}});await db.connectorDispatchJob.update({where:{id:job.id},data:{binding:{...job.binding,package:{...job.binding.package,accountId:'tampered'}}}});await assert.rejects(other.service().execute(a,other.principal),/JOB_CONFLICT/);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:other.task.id}}),0);
});
test('L19 legacy stale manifest and multiple attempts freeze rather than renew or adopt',async()=>{
 const f=await setup(),old=await legacy(f,true),attempt=await old.createAttempt();await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,status:'pending',idempotency_key:'another'}});
 assert.equal((await f.service().execute({projectId:f.project.id,taskId:f.task.id,operation:'reconcile',dryRun:false,attemptId:attempt.id,idempotencyKey:attempt.idempotency_key},f.principal)).state,'verification_required');assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),0);
 const another=await setup(),prior=await legacy(another);await db.workflowEvent.update({where:{id:prior.release.id},data:{before_state:{approval_reference:another.request.approvalReference,manifest_checksum:'stale'}}});const req=await another.bound('publish');delete req.approvalReference;await assert.rejects(another.service().execute(req,another.principal),/LEGACY_RELEASE_CONFLICT/);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:another.task.id}}),0);
});
test('L20 generic and legacy ambiguous aggregate history freezes fact/readback but retains original receipt',async()=>{
 for(const origin of ['generic','legacy'])for(const extra of ['attempt','job']){
  const f=await setup();let c,a;
  if(origin==='generic'){const started=await submitted(f);c=started.c;a=started.a;}
  else{const old=await legacy(f,true),attempt=await old.createAttempt();a={projectId:f.project.id,taskId:f.task.id,operation:'reconcile',dryRun:false,attemptId:attempt.id,idempotencyKey:attempt.idempotency_key};c=await f.getStore().loadClaim(a,f.principal);}
  if(extra==='attempt')await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,status:'pending',idempotency_key:'foreign-key'}});
  else{
   const wi=await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:'foreign-job-'+f.task.id,kind:'provider_publish',state:'available',assignee_role:'publisher'}});
   await db.connectorDispatchJob.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,work_item_id:wi.id,content_revision:4,selected_asset_id:f.asset.id,package_sha256:'f'.repeat(64),binding:{protocol:'owned_provider_v1',provider:'dzen'},idempotency_key:'foreign-job-'+f.task.id}});
  }
  // New evidence may be retained even after a conflicting history appears.
  if(origin==='generic')await f.getStore().saveReceipt(c,receipt(c));assert.ok(await f.getStore().retained(c));
  const request={projectId:f.project.id,taskId:f.task.id,operation:'reconcile',dryRun:false,attemptId:c.attemptId,idempotencyKey:c.key};
  assert.equal((await f.service().execute(request,f.principal)).state,'verification_required');assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);assert.equal(f.calls.readback,0);assert.equal(f.calls.publish,0);
 }
});
test('L21 current owner-release revocation and manifest drift block start/submit without refreshing claim',async()=>{
 const f=await setup(),{a,c}=await releasedClaim(f);await db.contentItem.update({where:{id:f.task.id},data:{publication_mode:'approval_required'}});await assert.rejects(f.getStore().start(a,f.principal,c),/PACKAGE_NOT_ELIGIBLE/);await db.contentItem.update({where:{id:f.task.id},data:{publication_mode:'owner_released'}});await f.getStore().start(a,f.principal,c);
 const {OwnedPublicationStore}=require('../../src/services/owned_publication_store');const drifted=new OwnedPublicationStore({...f.dependencies,manifest:async()=>({checksum:'sha256:'+'d'.repeat(64)})});await assert.rejects(drifted.submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:c.package.accountId}),/PACKAGE_CONFLICT/);
 await db.contentItem.update({where:{id:f.task.id},data:{publication_mode:'approval_required'}});await assert.rejects(f.getStore().submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:c.package.accountId}),/PACKAGE_NOT_ELIGIBLE/);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.submit_consumed'}}),0);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),1);
});
test('L22 historical-only outcome markers deny new release/inventory/claim/send with empty canonical history',async()=>{
 const markers=[{published_link:'https://dzen.ru/a/SyntheticOld'},...['dzen_publish_claim','dzen_publication_pending'].map(k=>({quality_report:{[k]:true}})),...['provider_call_started','provider_result_uncertain','provider_confirmed_fact_pending'].map(state=>({quality_report:{publication_task_delivery:{state}}})),{quality_report:{retirement:{provider_result_uncertain:true}}}];
 for(const marker of markers){const f=await setup();const release=await f.bound();await db.contentItem.update({where:{id:f.task.id},data:marker});await assert.rejects(f.service().execute(release,f.principal),/HISTORICAL_OUTCOME/);const pub={...release,operation:'publish'};delete pub.approvalReference;await assert.rejects(f.service().execute(pub,f.principal),/HISTORICAL_OUTCOME/);assert.equal(f.calls.inventory+f.calls.publish,0);assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),0);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);}
});
test('L23 receipt serialization retry is DB-only, retains evidence and never re-enters native adapter',async()=>{
 const f=await setup(),{a,c}=await submitted(f);const {OwnedPublicationStore}=require('../../src/services/owned_publication_store');const {Prisma}=require('@prisma/client');let calls=0;
 const syntheticDb=new Proxy(db,{get(target,key){if(key==='$transaction')return (...args)=>{calls++;if(calls===1)throw new Prisma.PrismaClientKnownRequestError('synthetic serialization rollback',{code:'P2034',clientVersion:'synthetic'});return target.$transaction(...args);};return target[key];}});
 const store=new OwnedPublicationStore({...f.dependencies,db:syntheticDb});await store.saveReceipt(c,receipt(c));assert.equal(calls,2);assert.ok(await store.retained(c));assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.receipt'}}),1);assert.equal(f.calls.publish+f.calls.readback,0);assert.equal((await store.confirm(a,f.principal,c)).state,'published');
});
test('L24 concurrent uncertainty and receipt persistence retain evidence; stale Submit cannot resume',async()=>{
 const f=await setup(),{a,c}=await submitted(f);const outcomes=await Promise.allSettled([f.getStore().freeze(c,'OWNED_PROVIDER_OUTCOME_UNCERTAIN'),f.getStore().saveReceipt(c,receipt(c))]);assert.equal(outcomes[1].status,'fulfilled');assert.ok(await f.getStore().retained(c));await assert.rejects(f.getStore().submit(a,f.principal,c,{objectId:'Synthetic'+c.attemptId,accountId:c.package.accountId}));assert.equal((await f.getStore().confirm(a,f.principal,c)).state,'published');assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).error_message,null);assert.equal((await db.connectorDispatchJob.findUnique({where:{id:c.jobId}})).blocker_code,null);
});
test('L25 exhausted receipt DB retries and failed uncertainty audit return honest held result without resend',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const req=await f.bound('publish');delete req.approvalReference;
 const {OwnedPublicationStore}=require('../../src/services/owned_publication_store'),{OwnedPublicationService}=require('../../src/services/owned_publication_service'),{Prisma}=require('@prisma/client');let retries=0;
 const down=new Proxy(db,{get(target,key){if(key==='$transaction')return()=>{retries++;throw new Prisma.PrismaClientKnownRequestError('synthetic storage unavailable',{code:'P2034',clientVersion:'synthetic'});};return target[key];}});
 class FaultyStore extends OwnedPublicationStore{saveReceipt(c,r){return new OwnedPublicationStore({...f.dependencies,db:down}).saveReceipt(c,r);}async freeze(){throw Error('synthetic audit storage unavailable');}}
 const result=await new OwnedPublicationService({store:new FaultyStore(f.dependencies),adapter:f.adapter}).execute(req,f.principal);assert.equal(result.state,'verification_required');assert.equal(result.blocker,'OWNED_EVIDENCE_STORAGE_UNAVAILABLE');assert.equal(result.retry_allowed,false);assert.equal(retries,3);assert.equal(f.calls.publish,1);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.receipt'}}),0);assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);assert.equal((await f.service().execute({...req,idempotencyKey:'new-after-outage'},f.principal)).state,'verification_required');assert.equal(f.calls.publish,1);
});
test('L26 foreign-actor historical receipt cannot supply immutable server custody',async()=>{
 const f=await setup(),old=await legacy(f,true),attempt=await old.createAttempt();const event=await db.workflowEvent.findFirst({where:{project_id:f.project.id,content_item_id:f.task.id,command:'ba_publish_dzen_task'+f.task.id+':receipt'}});await db.workflowEvent.update({where:{id:event.id},data:{actor_id:f.principal.actorId}});
 const req={projectId:f.project.id,taskId:f.task.id,operation:'reconcile',dryRun:false,idempotencyKey:attempt.idempotency_key,attemptId:attempt.id};const result=await f.service().execute(req,f.principal);assert.equal(result.state,'verification_required');assert.equal(f.calls.readback+f.calls.publish,0);assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);
});
function phaseDelay(ms,budget){return new Promise((resolve,reject)=>{let timer;const abort=()=>{clearTimeout(timer);budget?.signal.removeEventListener('abort',abort);reject(Error('synthetic phase aborted'));};if(budget?.signal.aborted)return abort();timer=setTimeout(()=>{budget?.signal.removeEventListener('abort',abort);resolve();},ms);budget?.signal.addEventListener('abort',abort,{once:true});});}
test('L27 one invocation deadline spans inventory+publish; aborted adapter has no late Submit or fact',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const req=await f.bound('publish');delete req.approvalReference;const {OwnedPublicationService}=require('../../src/services/owned_publication_service');let submittedCount=0;let sharedBudget;
 f.adapter.inventory=async(p,budget)=>{sharedBudget=budget;await phaseDelay(100,budget);return {complete:true,absent:true,accountId:p.accountId,packageDigest:p.digest,checkedAt:new Date().toISOString()};};
 f.adapter.publish=async(c,hooks,budget)=>{assert.equal(budget,sharedBudget);await hooks.beforeMutation();await phaseDelay(250,budget);submittedCount++;await hooks.beforeSubmit({objectId:'Synthetic'+c.attemptId,accountId:c.package.accountId});return receipt(c);};
 const start=Date.now();const result=await new OwnedPublicationService({store:f.getStore(),adapter:f.adapter,workBudgetMs:250}).execute(req,f.principal);assert.equal(result.state,'verification_required');assert.equal(result.blocker,'OWNED_INVOCATION_TIMED_OUT');assert.ok(Date.now()-start<1000);await phaseDelay(300);assert.equal(submittedCount,0);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.submit_consumed'}}),0);assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);
});
test('L28 invocation deadline cancels PostgreSQL query and rolls back instead of allowing late release writes',async()=>{
 const f=await setup(),req=await f.bound();const {OwnedPublicationService}=require('../../src/services/owned_publication_service'),{OwnedPublicationStore}=require('../../src/services/owned_publication_store');
 const slow=new OwnedPublicationStore({...f.dependencies,manifest:async(projectId,userId,tx)=>{await tx.$queryRaw`SELECT true AS waited FROM pg_sleep(1)`;return f.dependencies.manifest();}});
 const start=Date.now(),result=await new OwnedPublicationService({store:slow,adapter:f.adapter,workBudgetMs:100}).execute(req,f.principal);assert.equal(result.state,'blocked');assert.equal(result.blocker,'OWNED_INVOCATION_TIMED_OUT');assert.ok(Date.now()-start<700);await phaseDelay(250);assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),0);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.release'}}),0);
});
test('L29 actual PostgreSQL ownership helpers preserve release/job/legacy histories despite removed markers',async()=>{
 const guard=require('../../src/services/publication_owned_guard');
 for(const kind of ['release','job','attempt','uncertain']){
  const f=await setup();
  if(kind==='release'){await f.service().execute(await f.bound(),f.principal);await db.contentItem.update({where:{id:f.task.id},data:{quality_report:{},publication_mode:'approval_required'}});}
  else if(kind==='job'){const wi=await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:'test-job-'+f.task.id,kind:'provider_publish',state:'available',assignee_role:'publisher'}});await db.connectorDispatchJob.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,work_item_id:wi.id,content_revision:4,selected_asset_id:f.asset.id,package_sha256:'a'.repeat(64),binding:{protocol:'owned_provider_v1',provider:'dzen'},idempotency_key:'test-job-'+f.task.id}});}
  else if(kind==='attempt')await db.deliveryAttempt.create({data:{project_id:f.project.id,content_item_id:f.task.id,channel_id:f.channel.id,status:'pending',idempotency_key:'legacy'}});
  else await db.contentItem.update({where:{id:f.task.id},data:{quality_report:{retirement:{provider_result_uncertain:true}}}});
  const scope={projectId:f.project.id,taskId:f.task.id};assert.equal(await guard.hasOwnedPublicationHistory(db,scope),true);
  if(kind==='release'||kind==='job')assert.equal((await db.contentItem.updateMany({where:{id:f.task.id,...guard.ownedPublicationMutableWhere()},data:{draft_text:'forbidden'}})).count,0);
  await assert.rejects(db.$transaction(async tx=>{await guard.lockOwnedPublicationTask(tx,scope);await guard.assertOwnedPublicationMutable(tx,scope);await tx.contentItem.update({where:{id:f.task.id},data:{draft_text:'forbidden'}});}),/OWNED_LIFECYCLE_IMMUTABLE/);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).draft_text,f.task.draft_text);
 }
});
test('L30 actual update/prepare/week repair apply+rollback reject held histories without losing ownership',async()=>{
 process.env.TELEGRAM_BOT_TOKEN='000000000:synthetic-test-token';const tasks=require('../../src/services/mcp_publication/tasks'),{WeekPackageRepairService}=require('../../src/services/week_package_repair.service');
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const before=await db.contentItem.findUnique({where:{id:f.task.id}});
 await assert.rejects(tasks.updatePublicationContent({projectId:f.project.id,taskId:f.task.id,body:'forbidden',expectedRevision:4}),/OWNED_LIFECYCLE_IMMUTABLE/);await assert.rejects(tasks.preparePublicationTask(f.project.id,f.task.id),/OWNED_LIFECYCLE_IMMUTABLE/);
 const repair=new WeekPackageRepairService();await assert.rejects(repair.apply({projectId:f.project.id,actorId:f.principal.actorId,moves:[{contentItemId:f.task.id,weekStart:'2026-10-19',weekEnd:'2026-10-25'}],reason:'synthetic',idempotencyKey:'synthetic-repair'}),/OWNED_LIFECYCLE_IMMUTABLE/);
 await db.workflowEvent.create({data:{project_id:f.project.id,actor_id:f.principal.actorId,command:'week_package.repair.applied',idempotency_key:'synthetic-prior-repair',after_state:{applied:[{content_item_id:f.task.id,from_week_package_id:null,to_week_package_id:null}]}}});await assert.rejects(repair.rollback({projectId:f.project.id,actorId:f.principal.actorId,applyIdempotencyKey:'synthetic-prior-repair',idempotencyKey:'synthetic-rollback'}),/OWNED_LIFECYCLE_IMMUTABLE/);
 assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),before);assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),1);
});
test('L31 separate actual content-writer and release processes contend on the canonical row lock',async()=>{
 const f=await setup(),request=await f.bound(),manifest=request.expectedManifestChecksum;let ready=0,readyResolve;const bothReady=new Promise(r=>readyResolve=r);
 function launch(extra){let child;const done=new Promise((resolve,reject)=>{child=require('node:child_process').fork(require.resolve('../fixtures/owned-publication-race-child.cjs'),[],{stdio:['ignore','ignore','pipe','ipc']});let result;child.on('message',message=>{if(message.ready){if(++ready===2)readyResolve();}else result=message;});child.on('error',reject);child.on('exit',code=>result?resolve(result):reject(Error('writer child failed '+code)));child.send({request,principal:f.principal,manifest,...extra});});return done;}
 let outcomes;
 await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM planner.content_items WHERE id=${f.task.id} FOR UPDATE`;outcomes=[launch({release:true}),launch({writer:true})];await bothReady;await phaseDelay(150);},{timeout:15000});
 const result=await Promise.all(outcomes);assert.equal(result.filter(r=>r.ok).length,1);const jobs=await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),item=await db.contentItem.findUnique({where:{id:f.task.id}});if(jobs===1)assert.equal(item.draft_text,f.task.draft_text);else assert.equal(item.draft_text,'synthetic concurrent edit');assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);
});
test('L32 actual fact authorization SELECT obeys invocation deadline and preserves receipt on rollback',async()=>{
 const f=await setup(),{a,c}=await submitted(f);await f.getStore().saveReceipt(c,receipt(c));const {runOwnedInvocation}=require('../../src/services/owned_publication_invocation'),{OwnedPublicationStore}=require('../../src/services/owned_publication_store');let enteredFact=false;
 const store=new OwnedPublicationStore({...f.dependencies,facts:{record:args=>{enteredFact=true;return f.dependencies.facts.record(args);}}});
 let unlock,locked;const gate=new Promise(r=>unlock=r),acquired=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$executeRawUnsafe('LOCK TABLE planner.project_members IN ACCESS EXCLUSIVE MODE');locked();await gate;},{timeout:5000});await acquired;
 const safety=setTimeout(unlock,1200),controller=new AbortController(),deadline=Date.now()+100,timer=setTimeout(()=>controller.abort(),100),started=Date.now();
 try{await assert.rejects(runOwnedInvocation({deadline,signal:controller.signal},()=>store.confirm(a,f.principal,c)),/OWNED_INVOCATION_TIMED_OUT/);assert.equal(enteredFact,true);assert.ok(Date.now()-started<700,'authorization SELECT must be cancelled before the fixture safety unlock');}
 finally{clearTimeout(timer);clearTimeout(safety);controller.abort();unlock();await blocker;}
 await phaseDelay(150);assert.ok(await f.getStore().retained(c));assert.equal(await db.publicationFact.count({where:{content_item_id:f.task.id}}),0);assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'verification_required');assert.equal((await db.connectorDispatchJob.findUnique({where:{id:c.jobId}})).state,'receipt_retained');assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).status,'publishing');
});
test('L33 actual production facade rejects missing/foreign principal and scoped foreign task before native work',async()=>{
 const {tryOwnedPublicationTask}=require('../../src/services/publication_owned_route'),{withPublicationPrincipal}=require('../../src/mcp/publication-principal');const f=await setup(),foreign=await setup(),request={projectId:f.project.id,taskId:f.task.id,dryRun:true};
 await assert.rejects(tryOwnedPublicationTask(request),/PRINCIPAL_REQUIRED/);
 await assert.rejects(withPublicationPrincipal(f.principal,()=>tryOwnedPublicationTask({...request,projectId:foreign.project.id,taskId:foreign.task.id})),/SCOPE_MISMATCH/);
 await assert.rejects(withPublicationPrincipal(f.principal,()=>tryOwnedPublicationTask({...request,taskId:foreign.task.id})),/TASK_NOT_FOUND/);
 const unscoped={userId:f.u.id,actorId:f.principal.actorId,profile:'owner'};
 await assert.rejects(withPublicationPrincipal(unscoped,()=>tryOwnedPublicationTask({projectId:foreign.project.id,taskId:foreign.task.id,dryRun:true})),/Access denied/);
 const preview=await withPublicationPrincipal(f.principal,()=>tryOwnedPublicationTask(request));assert.equal(preview.state,'preview');assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),0);
});
test('L34 registered REST material writers reject owned history before fixer/upload/native work',async t=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const {rest,multipart}=require('../fixtures/owned-publication-rest.cjs'),{app,calls}=await rest(t,f);const before=await db.contentItem.findUnique({where:{id:f.task.id}}),asset=await db.imageAsset.findUnique({where:{id:f.asset.id}});
 for(const [method,path,payload]of[['PUT','content',{body:'forbidden'}],['POST','prepare-handoff',{}],['POST','fix-with-critic',{}],['POST','critic-check',{}],['POST','generate-image',{}]]){const r=await app.inject({method,url:`/api/publication-tasks/${f.task.id}/${path}`,payload});assert.equal(r.statusCode,409,path+' '+r.body);assert.match(r.body,/OWNED_LIFECYCLE_IMMUTABLE/);}
 const upload=await app.inject({method:'POST',url:`/api/publication-tasks/${f.task.id}/upload-image`,...multipart()});assert.equal(upload.statusCode,409,upload.body);assert.deepEqual(calls,{critic:0,fixer:0,storage:0,art:0,generator:0});assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),before);assert.deepEqual(await db.imageAsset.findUnique({where:{id:f.asset.id}}),asset);
});
test('L35 ordinary nonowned REST content/prepare/fixer/upload behavior remains available',async t=>{
 const f=await setup(),{rest,multipart}=require('../fixtures/owned-publication-rest.cjs'),{app,calls}=await rest(t,f);
 const content=await app.inject({method:'PUT',url:`/api/publication-tasks/${f.task.id}/content`,payload:{body:'Ordinary edited text'}});assert.equal(content.statusCode,200,content.body);assert.equal(content.json().content_revision,5);
 const prepare=await app.inject({method:'POST',url:`/api/publication-tasks/${f.task.id}/prepare-handoff`,payload:{}});assert.equal(prepare.statusCode,200,prepare.body);
 const fixed=await app.inject({method:'POST',url:`/api/publication-tasks/${f.task.id}/fix-with-critic`,payload:{}});assert.equal(fixed.statusCode,200,fixed.body);assert.equal(fixed.json().updated_text,'Fixed synthetic body');
 const upload=await app.inject({method:'POST',url:`/api/publication-tasks/${f.task.id}/upload-image`,...multipart()});assert.equal(upload.statusCode,200,upload.body);assert.equal(calls.storage,1);assert.equal(calls.fixer,1);assert.equal((await db.imageAsset.findUnique({where:{id:f.asset.id}})).file_url,'https://example.invalid/replacement.png');
});
test('L36 REST upload rechecks under lock when owner release commits during storage work',async t=>{
 const f=await setup(),release=await f.bound();const {rest,multipart}=require('../fixtures/owned-publication-rest.cjs'),{app}=await rest(t,f,{beforeUpload:()=>f.service().execute(release,f.principal)});const asset=await db.imageAsset.findUnique({where:{id:f.asset.id}});
 const response=await app.inject({method:'POST',url:`/api/publication-tasks/${f.task.id}/upload-image`,...multipart()});assert.equal(response.statusCode,409,response.body);assert.deepEqual(await db.imageAsset.findUnique({where:{id:f.asset.id}}),asset);assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),1);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).publication_mode,'owner_released');
});
test('L37 actual top-level retirement uncertainty marker blocks release/send and REST edits',async t=>{
 const f=await setup(),release=await f.bound();await db.contentItem.update({where:{id:f.task.id},data:{quality_report:{provider_result_uncertain:true}}});await assert.rejects(f.service().execute(release,f.principal),/HISTORICAL_OUTCOME/);const pub={...release,operation:'publish'};delete pub.approvalReference;await assert.rejects(f.service().execute(pub,f.principal),/HISTORICAL_OUTCOME/);
 const {rest}=require('../fixtures/owned-publication-rest.cjs'),{app,calls}=await rest(t,f);const response=await app.inject({method:'PUT',url:`/api/publication-tasks/${f.task.id}/content`,payload:{body:'forbidden'}});assert.equal(response.statusCode,409,response.body);assert.equal(f.calls.inventory+f.calls.publish,0);assert.equal(calls.fixer+calls.storage,0);
});
test('L38 exposed image generation and review refuse owned aggregates without asset/work mutations',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);const service=require('../../src/services/image_asset.service').default;const before=await db.contentItem.findUnique({where:{id:f.task.id}}),asset=await db.imageAsset.findUnique({where:{id:f.asset.id}});
 await assert.rejects(service.generateImageAsset({projectId:f.project.id,actorId:f.principal.actorId,contentItemId:f.task.id,decisionId:f.asset.decision_id,prompt:'synthetic',altText:'synthetic',fileUrl:'https://example.invalid/new.png'}),/OWNED_LIFECYCLE_IMMUTABLE/);
 await assert.rejects(service.reviewImageAsset({projectId:f.project.id,actorId:f.principal.actorId,assetId:f.asset.id,decision:'rejected'}),/OWNED_LIFECYCLE_IMMUTABLE/);assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),before);assert.deepEqual(await db.imageAsset.findUnique({where:{id:f.asset.id}}),asset);assert.equal(await db.imageAsset.count({where:{content_item_id:f.task.id}}),1);
});
test('L39 ordinary image generation and approval preserve visual workflow with atomic asset/work rollback',async()=>{
 const f=await setup(),service=require('../../src/services/image_asset.service').default;const args={projectId:f.project.id,actorId:f.principal.actorId,contentItemId:f.task.id,decisionId:f.asset.decision_id,prompt:'synthetic approved visual',altText:'synthetic image',fileUrl:'https://example.invalid/new.png'};
 const candidate=await service.generateImageAsset(args);assert.equal(candidate.asset_version,2);assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).visual_state,'IN_REVIEW');assert.equal(await db.workItem.count({where:{content_item_id:f.task.id,kind:'visual_review'}}),1);
 await service.reviewImageAsset({projectId:f.project.id,actorId:f.principal.actorId,assetId:candidate.asset_id,decision:'approved'});const item=await db.contentItem.findUnique({where:{id:f.task.id}});assert.equal(item.selected_asset_id,candidate.asset_id);assert.equal(item.handoff_state,'ready');assert.equal(item.visual_state,'APPROVED');
 const functionName='synthetic_visual_'+f.task.id;await pool.query(`CREATE FUNCTION planner.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.content_item_id=${f.task.id} AND NEW.kind='visual_review' THEN RAISE EXCEPTION 'synthetic visual work fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${functionName} BEFORE INSERT ON planner.work_items FOR EACH ROW EXECUTE FUNCTION planner.${functionName}()`);
 try{await assert.rejects(service.generateImageAsset(args),/synthetic visual work fault/);assert.equal(await db.imageAsset.count({where:{content_item_id:f.task.id}}),2);assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),item);}finally{await pool.query(`DROP TRIGGER ${functionName} ON planner.work_items; DROP FUNCTION planner.${functionName}()`);}
});
test('L40 storage failure incident after concurrent release preserves owned task and accepted asset',async t=>{
 const f=await setup(),release=await f.bound(),storage=require('../../src/services/storage.service').default;let before;const asset=await db.imageAsset.findUnique({where:{id:f.asset.id}});
 t.mock.method(storage,'uploadFileFromBuffer',async()=>{await f.service().execute(release,f.principal);before=await db.contentItem.findUnique({where:{id:f.task.id}});throw Error('synthetic storage unavailable');});
 await assert.rejects(require('../../src/services/image_asset.service').default.generateImageAsset({projectId:f.project.id,actorId:f.principal.actorId,contentItemId:f.task.id,decisionId:f.asset.decision_id,prompt:'synthetic',altText:'synthetic',fileDataBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=',mimeType:'image/png'}),/synthetic storage unavailable/);
 assert.ok(before);assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),before);assert.deepEqual(await db.imageAsset.findUnique({where:{id:f.asset.id}}),asset);const state=await require('../../src/services/visual_storage_incident.service').getVisualStorageIngestState(f.project.id);assert.equal(state.blocked,true);assert.equal(state.reason,'storage_ingest_failed');assert.equal(await db.connectorDispatchJob.count({where:{content_item_id:f.task.id}}),1);
});
test('L41 automatic art acceptance/backfill and generic work approval preserve owned aggregate; ordinary approval works',async()=>{
 const f=await setup();await f.service().execute(await f.bound(),f.principal);await db.projectSettings.create({data:{project_id:f.project.id,key:'art_direction_pipeline_enabled',value:'true'}});const art=require('../../src/services/art_direction.service').default,{WorkQueueService}=require('../../src/services/work_queue.service'),queue=new WorkQueueService();
 const before=await db.contentItem.findUnique({where:{id:f.task.id}}),asset=await db.imageAsset.findUnique({where:{id:f.asset.id}}),job=await db.connectorDispatchJob.findFirst({where:{content_item_id:f.task.id}}),wi=await db.workItem.findUnique({where:{id:job.work_item_id}}),events=await db.workflowEvent.count({where:{content_item_id:f.task.id}});
 assert.equal(await db.$transaction(tx=>art.acceptContentRevision(tx,f.task.id,f.principal.actorId)),null);assert.equal((await art.backfillProject(f.project.id,f.principal.actorId)).art_direction_work_items,0);
 await assert.rejects(queue.decideApproval({projectId:f.project.id,actorId:f.principal.actorId,workItemId:wi.id,resultVersion:wi.result_version,decision:'approved',idempotencyKey:'owned-approval-'+wi.id}),/OWNED_LIFECYCLE_IMMUTABLE/);
 assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),before);assert.deepEqual(await db.imageAsset.findUnique({where:{id:f.asset.id}}),asset);assert.deepEqual(await db.connectorDispatchJob.findUnique({where:{id:job.id}}),job);assert.deepEqual(await db.workItem.findUnique({where:{id:wi.id}}),wi);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id}}),events);assert.equal(await db.approvalDecision.count({where:{work_item_id:wi.id}}),0);
 const ordinary=await setup(),work=await db.workItem.create({data:{project_id:ordinary.project.id,content_item_id:ordinary.task.id,item_key:'ordinary-'+ordinary.task.id,kind:'provider_publish',state:'waiting_approval',assignee_role:'publisher',result_version:1}});
 await queue.decideApproval({projectId:ordinary.project.id,actorId:ordinary.principal.actorId,workItemId:work.id,resultVersion:1,decision:'approved',idempotencyKey:'ordinary-'+work.id});assert.equal((await db.workItem.findUnique({where:{id:work.id}})).state,'completed');assert.equal((await db.contentItem.findUnique({where:{id:ordinary.task.id}})).status,'approved');assert.equal(await db.approvalDecision.count({where:{work_item_id:work.id}}),1);
});
test('L42 leased art replacement and source attachment preserve released cover; deliberate BLOCKED hold remains audited',async()=>{
 const f=await setup(),art=require('../../src/services/art_direction.service').default;await db.artDirectionDecision.update({where:{id:f.asset.decision_id},data:{decision:'SOURCE_REQUIRED'}});const release=await f.bound();await f.service().execute(release,f.principal);
 const work=await db.workItem.create({data:{project_id:f.project.id,content_item_id:f.task.id,item_key:'art-'+f.task.id,kind:'art_direction',state:'claimed',assignee_role:'art_director',input_context_version:4,lease_actor_id:f.principal.actorId,lease_token:'synthetic-art-lease',lease_expires_at:new Date(Date.now()+60000)}});
 const before=await db.contentItem.findUnique({where:{id:f.task.id}}),decision=await db.artDirectionDecision.findUnique({where:{id:f.asset.decision_id}}),asset=await db.imageAsset.findUnique({where:{id:f.asset.id}}),job=await db.connectorDispatchJob.findFirst({where:{content_item_id:f.task.id}}),events=await db.workflowEvent.count({where:{content_item_id:f.task.id}});
 const input={projectId:f.project.id,workItemId:work.id,actorId:f.principal.actorId,leaseToken:'synthetic-art-lease',idempotencyKey:'positive-art-'+work.id,decision:{decision:'NO_VISUAL_NEEDED',source_content_revision:4,channel:'dzen',placement:'article_cover',reason:'synthetic replacement'}};
 await assert.rejects(art.submitDecision(input),/OWNED_LIFECYCLE_IMMUTABLE/);await assert.rejects(art.attachVisualSource({projectId:f.project.id,actorId:f.principal.actorId,contentItemId:f.task.id,fileUrl:'https://example.invalid/new-source.png',provenance:{kind:'synthetic'}}),/OWNED_LIFECYCLE_IMMUTABLE/);
 assert.deepEqual(await db.contentItem.findUnique({where:{id:f.task.id}}),before);assert.deepEqual(await db.artDirectionDecision.findUnique({where:{id:decision.id}}),decision);assert.deepEqual(await db.imageAsset.findUnique({where:{id:asset.id}}),asset);assert.deepEqual(await db.workItem.findUnique({where:{id:work.id}}),work);assert.deepEqual(await db.connectorDispatchJob.findUnique({where:{id:job.id}}),job);assert.equal(await db.imageAsset.count({where:{content_item_id:f.task.id}}),1);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id}}),events);
 await art.submitDecision({...input,idempotencyKey:'hold-art-'+work.id,decision:{...input.decision,decision:'BLOCKED',reason:'synthetic deliberate safety hold'}});assert.equal((await db.contentItem.findUnique({where:{id:f.task.id}})).visual_state,'BLOCKED');assert.equal((await db.artDirectionDecision.findUnique({where:{id:decision.id}})).status,'superseded');assert.deepEqual(await db.imageAsset.findUnique({where:{id:asset.id}}),asset);assert.deepEqual(await db.connectorDispatchJob.findUnique({where:{id:job.id}}),job);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id}}),events+1);assert.equal(await db.workflowEvent.count({where:{content_item_id:f.task.id,command:'owned_publication.release'}}),1);
 const pub={...release,operation:'publish'};delete pub.approvalReference;await assert.rejects(f.service().execute(pub,f.principal),/PACKAGE_NOT_ELIGIBLE/);assert.equal(f.calls.publish,0);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:f.task.id}}),0);
});
