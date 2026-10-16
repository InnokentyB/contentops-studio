const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
require('ts-node/register/transpile-only');
const {PrismaClient}=require('@prisma/client');
const {PrismaPg}=require('@prisma/adapter-pg');
const {Pool}=require('pg');
const url=process.env.DZEN1002_TEST_DATABASE_URL;
assert.ok(url && /^postgresql:\/\/dzen_synthetic:dzen_synthetic_only@127\.0\.0\.1:\d+\/dzen_store_test$/.test(url),'explicit isolated synthetic localhost test DB required');
const pool=new Pool({connectionString:url});
const db=new PrismaClient({adapter:new PrismaPg(pool)});
let Store,P,store,a;
before(async()=>{
  const dbPath=require.resolve('../../src/db'); require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{__esModule:true,default:db,prisma:db,pool}};
  P={manifest:'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7',bodySha256:'570bf2c102911ae4fc678ad453bb0289e48cf4e6161e874d6e39811e2527e9bb',assetSha256:'003dae64a6087ee456bb9af583b78955c6a6738de294ca7cf75c83b151d06a12',providerChannelId:'6a8029aba055ec36033bf81c',schedule:'2026-10-13T11:30:00.000Z'};
  Store=function(deps){let instance;return new Proxy({dependencies:deps},{get:(target,key)=>key==='dependencies'?deps:(...args)=>{instance ||= new (require('../../src/services/dzen1002_runtime_store').Dzen1002RuntimeStore)(deps);return instance[key](...args);}});};
  a={projectId:10,taskId:1002,actorId:'user:1',expectedManifestChecksum:P.manifest,idempotencyKey:'synthetic-send'};
  store=new Store({db,loadManifest:async()=>({checksum:P.manifest,project:{slug:'analystcraft-2'}}),hashBody:b=>b==='synthetic article'?P.bodySha256:'bad',now:()=>new Date('2026-10-16T12:00:00Z'),facts:new (require('../../src/services/publication_fact.service').PublicationFactService)()});
});
beforeEach(async()=>{
 await db.project.deleteMany({where:{id:10}}); await db.user.deleteMany({where:{id:1}});
 await db.user.create({data:{id:1,email:'synthetic@invalid.test',name:'Synthetic',password_hash:'not-a-credential'}});
 await db.project.create({data:{id:10,name:'Synthetic',slug:'analystcraft-2'}});
 await db.projectMember.create({data:{project_id:10,user_id:1,role:'owner'}});
 await db.socialChannel.create({data:{id:116,project_id:10,name:'synthetic_dzen',type:'dzen',config:{channel_id:P.providerChannelId}}});
 await db.contentItem.create({data:{id:1002,project_id:10,channel_id:116,type:'zen_article',title:'Synthetic title',draft_text:'synthetic article',content_revision:3,accepted_revision:3,text_state:'accepted',visual_state:'APPROVED',visual_placement:'article_cover',visual_decision_version:2,handoff_state:'ready',publication_mode:'owner_released',status:'ready_for_execution',schedule_at:new Date(P.schedule),publish_at:new Date(P.schedule)}});
 await db.artDirectionDecision.create({data:{id:300,project_id:10,content_item_id:1002,decision_version:2,source_content_revision:3,channel:'dzen',placement:'article_cover',decision:'VISUAL_REQUIRED',reason:'synthetic',actor_id:a.actorId}});
 await db.imageAsset.create({data:{id:151,project_id:10,content_item_id:1002,decision_id:300,content_revision:3,placement:'article_cover',prompt:'synthetic',file_url:'https://example.invalid/cover.png',status:'approved',provenance:{planner_storage:{sha256:P.assetSha256}}}});
 await db.contentItem.update({where:{id:1002},data:{selected_asset_id:151}});
 await db.workflowEvent.create({data:{project_id:10,content_item_id:1002,actor_id:a.actorId,command:'ba_preflight_dzen_task1002',idempotency_key:'synthetic-preflight',after_state:{task_id:1002,channel_id:116,body_sha256:P.bodySha256,asset_sha256:P.assetSha256,selected_asset_id:151,authenticated:true,editor_available:true,checked_at:'2026-10-16T12:00:00.000Z',inventory:{classification:'absent',exact_title_matches:0,coverage_complete:true,provider_channel_id:P.providerChannelId,expected_public_title:'Synthetic title'}}}});
 await db.workflowEvent.create({data:{id:3126,project_id:10,content_item_id:1002,actor_id:a.actorId,command:'ba_release_dzen_task1002',idempotency_key:'synthetic-release',before_state:{approval_reference:'synthetic'},after_state:{project_id:10,task_id:1002,channel_id:116,content_revision:3,accepted_revision:3,body_sha256:P.bodySha256,visual_decision_id:300,visual_decision_version:2,selected_asset_id:151,asset_sha256:P.assetSha256,schedule_at:P.schedule,publish_at:P.schedule,publication_mode:'owner_released'}}});
});
after(async()=>{await db.$disconnect();await pool.end();});
function receipt(c){return {schemaVersion:'dzen1002-native-v1',attemptId:c.attemptId,key:c.key,packageDigest:c.package.digest,accountId:P.providerChannelId,objectId:'SyntheticObject1002',url:'https://dzen.ru/a/SyntheticObject1002',publishedAt:'2026-10-16T11:59:00.000Z',observedAt:'2026-10-16T12:00:00.000Z',bodySha256:P.bodySha256,assetSha256:P.assetSha256,title:c.package.title};}
test('R01/R09 durable claim, one start, receipt and canonical replay',async()=>{
 const c=await store.claim(a); assert.equal(await db.deliveryAttempt.count(),1); await store.start(a,c); await assert.rejects(store.start(a,c)); await store.assertSubmit(a,c); await store.saveReceipt(a,c,receipt(c)); assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'verification_required'); assert.equal(await db.publicationFact.count(),0);
 assert.equal((await store.confirm(a,c)).mode,'published'); assert.equal((await store.confirm(a,c)).mode,'published'); assert.equal((await store.replay({...a,idempotencyKey:'other'})).mode,'published'); assert.equal(await db.publicationFact.count(),1);
 assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:completed'}}),1);
});
test('R04/R11 concurrent keys create one attempt and roll back loser',async()=>{
 const results=await Promise.allSettled([store.claim(a),store.claim({...a,idempotencyKey:'other'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.deliveryAttempt.count(),1);assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:claim'}}),1);
});
test('R02 owner, manifest, hash, account, release drift make zero attempts',async()=>{
 await assert.rejects(store.claim({...a,actorId:'user:2'}));await assert.rejects(store.claim({...a,expectedManifestChecksum:'wrong'}));
 for(const [model,where,data,restore] of [['contentItem',{id:1002},{draft_text:'changed'},{draft_text:'synthetic article'}],['socialChannel',{id:116},{config:{channel_id:'foreign'}},{config:{channel_id:P.providerChannelId}}],['workflowEvent',{id:3126},{actor_id:'user:2'},{actor_id:'user:1'}]]){await db[model].update({where,data});await assert.rejects(store.claim(a));await db[model].update({where,data:restore});}assert.equal(await db.deliveryAttempt.count(),0);
});
test('R05/R06 drift freezes started and every key remains no resend',async()=>{
 const c=await store.claim(a);await store.start(a,c);await db.contentItem.update({where:{id:1002},data:{draft_text:'changed'}});await assert.rejects(store.assertSubmit(a,c));await assert.rejects(store.claim({...a,idempotencyKey:'new'}));await db.contentItem.update({where:{id:1002},data:{draft_text:'synthetic article'}});await store.uncertain(a,c);assert.equal((await store.replay(a)).mode,'verification_required');await assert.rejects(store.claim(a));assert.equal(await db.deliveryAttempt.count(),1);
});
test('R07 receipt survives failed fact transaction; DB-only reconcile races converge',async()=>{
 const c=await store.claim(a);await store.start(a,c);await store.saveReceipt(a,c,receipt(c));
 const broken=new Store({...store.dependencies,facts:{record:async x=>db.$transaction(async tx=>{await x.beforeWrite(tx);throw Error('synthetic fact rollback');},{isolationLevel:'Serializable'})}});
 await assert.rejects(broken.confirm(a,c),/synthetic fact rollback/);assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'verification_required');assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:completed'}}),0);
 const results=await Promise.all([store.confirm(a,c),store.confirm(a,c)]);assert.ok(results.every(r=>r.mode==='published'));assert.equal(await db.publicationFact.count(),1);assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:completed'}}),1);
});
test('R08 receipt schema, account, identity and unknown fields fail closed',async()=>{
 const c=await store.claim(a);await store.start(a,c);
 for(const patch of [{accountId:'foreign'},{objectId:'wrong'},{title:'wrong'},{bodySha256:'bad'},{assetSha256:'bad'},{publishedAt:'not-time'},{cookie:'secret'}])await assert.rejects(store.saveReceipt(a,c,{...receipt(c),...patch}));assert.equal(await db.publicationFact.count(),0);
 await store.saveReceipt(a,c,receipt(c));await assert.rejects(store.saveReceipt(a,c,{...receipt(c),publishedAt:'2026-10-16T11:58:00.000Z'}));
});
test('R04 same key race also has one committing claim',async()=>{
 const r=await Promise.allSettled([store.claim(a),store.claim(a)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.deliveryAttempt.count(),1);
});
test('R06 event insertion failure rolls back task CAS and attempt',async()=>{
 await pool.query(`CREATE FUNCTION planner.synthetic_fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command='ba_publish_dzen_task1002:claim' THEN RAISE EXCEPTION 'synthetic claim rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_fail_claim BEFORE INSERT ON planner.workflow_events FOR EACH ROW EXECUTE FUNCTION planner.synthetic_fail_claim()`);
 try{await assert.rejects(store.claim(a),/synthetic claim rollback/);assert.equal(await db.deliveryAttempt.count(),0);assert.equal((await db.contentItem.findUnique({where:{id:1002}})).status,'ready_for_execution');}finally{await pool.query('DROP TRIGGER synthetic_fail_claim ON planner.workflow_events; DROP FUNCTION planner.synthetic_fail_claim()');}
});
test('R06 receipt write rollback leaves started and blocks every resend key',async()=>{
 const c=await store.claim(a);await store.start(a,c);
 await pool.query(`CREATE FUNCTION planner.synthetic_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command='ba_publish_dzen_task1002:receipt' THEN RAISE EXCEPTION 'synthetic receipt rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_fail_receipt BEFORE INSERT ON planner.workflow_events FOR EACH ROW EXECUTE FUNCTION planner.synthetic_fail_receipt()`);
 try{await assert.rejects(store.saveReceipt(a,c,receipt(c)),/synthetic receipt rollback/);assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'pending');assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:started'}}),1);assert.equal((await store.replay({...a,idempotencyKey:'other'})).mode,'verification_required');await assert.rejects(store.claim({...a,idempotencyKey:'other'}));}finally{await pool.query('DROP TRIGGER synthetic_fail_receipt ON planner.workflow_events; DROP FUNCTION planner.synthetic_fail_receipt()');}
});
test('R07 fact commit with lost response resolves canonical identity',async()=>{
 const c=await store.claim(a);await store.start(a,c);await store.saveReceipt(a,c,receipt(c));
 const lost=new Store({...store.dependencies,facts:{record:async x=>{await store.dependencies.facts.record(x);throw Error('synthetic lost response');}}});
 assert.equal((await lost.confirm(a,c)).published_link,receipt(c).url);assert.equal(await db.publicationFact.count(),1);assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:completed'}}),1);
});
test('R07 conflicting canonical fact cannot overwrite or mark delivered',async()=>{
 const c=await store.claim(a);await store.start(a,c);await store.saveReceipt(a,c,receipt(c));
 await db.publicationFact.create({data:{project_id:10,content_item_id:1002,channel_id:116,artifact_kind:'article',outcome:'published',published_at:new Date(receipt(c).publishedAt),public_url:'https://dzen.ru/a/ForeignObject',provider_object_id:'ForeignObject',confirmation_mode:'automatic',confirmed_by:a.actorId}});
 await assert.rejects(store.confirm(a,c),/DZEN1002_FACT_CONFLICT/);assert.equal((await db.publicationFact.findFirst()).provider_object_id,'ForeignObject');assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'verification_required');
});
test('R02 exact revision, decision, asset, dates and owner role drift reject claim',async()=>{
 const cases=[['contentItem',{id:1002},{content_revision:4},{content_revision:3}],['contentItem',{id:1002},{accepted_revision:2},{accepted_revision:3}],['contentItem',{id:1002},{schedule_at:new Date('2026-10-14T11:30:00Z')},{schedule_at:new Date(P.schedule)}],['artDirectionDecision',{id:300},{decision_version:3},{decision_version:2}],['imageAsset',{id:151},{status:'rejected'},{status:'approved'}],['projectMember',{project_id_user_id:{project_id:10,user_id:1}},{role:'editor'},{role:'owner'}]];
 for(const [model,where,data,restore] of cases){await db[model].update({where,data});await assert.rejects(store.claim(a));await db[model].update({where,data:restore});}assert.equal(await db.deliveryAttempt.count(),0);
});
test('R02/R05 stale/future/incomplete inventory and old legacy state reject claim',async()=>{
 const event=await db.workflowEvent.findFirst({where:{command:'ba_preflight_dzen_task1002'}}); const initial=event.after_state;
 for(const patch of [{checked_at:'2026-10-16T11:00:00.000Z'},{checked_at:'2026-10-16T13:00:00.000Z'},{inventory:{...initial.inventory,coverage_complete:false}},{inventory:{...initial.inventory,classification:'duplicate'}}]){await db.workflowEvent.update({where:{id:event.id},data:{after_state:{...initial,...patch}}});await assert.rejects(store.claim(a),/FRESH_INVENTORY/);}await db.workflowEvent.update({where:{id:event.id},data:{after_state:initial}});
 for(const state of ['provider_call_started','provider_result_uncertain','provider_confirmed_fact_pending']){await db.contentItem.update({where:{id:1002},data:{quality_report:{publication_task_delivery:{state}}}});await assert.rejects(store.claim(a));}assert.equal(await db.deliveryAttempt.count(),0);
});

test('R06/R07 post-submit package, hold, owner and manifest drift cannot lose retained receipt',async()=>{
 const c=await store.claim(a);await store.start(a,c);
 await db.contentItem.update({where:{id:1002},data:{draft_text:'changed after submit',quality_report:{publication_hold:true}}});
 await db.projectMember.update({where:{project_id_user_id:{project_id:10,user_id:1}},data:{role:'editor'}});
 const drifted=new Store({...store.dependencies,loadManifest:async()=>({checksum:'changed',project:{slug:'analystcraft-2'}})});
 await drifted.saveReceipt(a,c,receipt(c));
 assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:receipt'}}),1);
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'verification_required');
 await assert.rejects(drifted.confirm(a,c));await assert.rejects(drifted.claim({...a,idempotencyKey:'another'}));assert.equal(await db.publicationFact.count(),0);
});

test('R08 real durable attempt timestamp bounds receipt publication time with120 second skew',async()=>{
 const c=await store.claim(a);await store.start(a,c);
 const attempt=await db.deliveryAttempt.findUnique({where:{id:c.attemptId}});
 assert.equal(attempt.created_at.toISOString(),'2026-10-16T12:00:00.000Z');
 for(const publishedAt of ['2026-10-14T12:00:00.000Z','2026-10-16T11:57:59.999Z']){
  await assert.rejects(store.saveReceipt(a,c,{...receipt(c),publishedAt}),/DZEN1002_RECEIPT_PREDATES_CLAIM/);
  assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:receipt'}}),0);
  assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'pending');
 }
 await store.saveReceipt(a,c,{...receipt(c),publishedAt:'2026-10-16T11:58:00.000Z'});
 assert.equal(await db.workflowEvent.count({where:{command:'ba_publish_dzen_task1002:receipt'}}),1);
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:c.attemptId}})).status,'verification_required');
});
