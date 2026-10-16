const test=require('node:test');const assert=require('node:assert/strict');
const target=process.env.TDPD_TEST_DATABASE_URL;if(!target)throw Error('Explicit isolated test database required');
const url=new URL(target);
if(process.env.CI!=='true'||url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'
    ||url.pathname!=='/codex_lifecycle_ci'||url.search||url.hash)throw Error('Ephemeral CI database only');
process.env.DATABASE_URL=target;require('../../dist/bootstrap-env');
const effective=new URL(process.env.DATABASE_URL);
if(effective.hostname!==url.hostname||effective.port!==url.port||effective.pathname!==url.pathname
    ||effective.username!==url.username||effective.password!==url.password||effective.hash
    ||effective.searchParams.get('schema')!=='planner'
    ||effective.searchParams.get('options')!=='-c search_path=planner'
    ||[...effective.searchParams.keys()].some(k=>!['schema','options'].includes(k)))throw Error('Isolated target changed');
process.env.R2_PUBLIC_BASE_URL='https://media.synthetic.invalid';
const {default:db,pool}=require('../../dist/db');const facts=require('../../dist/services/publication_fact.service').default;
const {TG1103:p}=require('../../dist/services/telegram1103/contract');
const controls=require('../../dist/services/telegram1103/control');
const {Telegram1103Publication}=require('../../dist/services/telegram1103/publication');
const {body}=require('./telegram1103.fixture');
const slug='isolated_telegram1103_fixture';let created=false,userId;
test('real PostgreSQL same-asset rebind rollback, one video claim race and atomic fact completion',
    {timeout:45000},async()=>{
    assert.equal(await db.project.findUnique({where:{id:10}}),null);
    await db.project.create({data:{id:10,name:'Synthetic Telegram fixture',slug}});created=true;
    const user=await db.user.create({data:{email:'telegram1103@synthetic.invalid',name:'Synthetic owner',password_hash:'not-a-login-credential'}});userId=user.id;
    const actorId=`user:${userId}`;await db.projectMember.create({data:{project_id:10,user_id:userId,role:'owner'}});
    await db.socialChannel.create({data:{id:109,project_id:10,name:'Synthetic video target',type:'telegram',is_active:true,
        config:{telegram_channel_id:'@analystcraft',channel_username:'@analystcraft'}}});
    await db.contentItem.create({data:{id:1103,project_id:10,channel_id:109,type:'publication',draft_text:body,
        content_revision:2,accepted_revision:2,text_state:'accepted',visual_state:'SOURCE_REQUIRED',visual_decision_version:2,
        visual_placement:'video_cover',handoff_state:'blocked',status:'approved',publication_mode:'approval_required',
        schedule_at:new Date(p.date),publish_at:new Date(p.date)}});
    for(const [id,rev,status] of [[285,1,'superseded'],[300,2,'active']]) await db.artDirectionDecision.create({data:{id,
        project_id:10,content_item_id:1103,decision_version:rev,source_content_revision:rev,channel:'telegram',
        placement:'video_cover',decision:'SOURCE_REQUIRED',reason:'Synthetic original speech source',status,actor_id:actorId}});
    await db.imageAsset.create({data:{id:142,project_id:10,content_item_id:1103,decision_id:285,content_revision:1,
        placement:'video_cover',prompt:'Synthetic owner original',file_url:'https://media.synthetic.invalid/original.mp4',status:'approved',
        provenance:{planner_storage:{sha256:p.assetSha,mime_type:'video/mp4',byte_size:p.bytes,managed:true,provider:'r2'}},
        qa_report:{owner_uat:'accepted original speech',no_regeneration:true}}});
    const base={projectId:10,taskId:1103,actorId,expectedBodySha256:p.bodySha,expectedAssetSha256:p.assetSha,
        reason:'Synthetic owner exact video approval',idempotencyKey:'pg-rebind1103',apply:true};
    const failing={$transaction:run=>db.$transaction(tx=>run({...tx,workflowEvent:{
        findUnique:tx.workflowEvent.findUnique.bind(tx.workflowEvent),create:async()=>{throw Error('synthetic audit failure');}}}))};
    await assert.rejects(controls.rebindTelegram1103Asset({...base,decisionId:300},failing),/synthetic audit failure/);
    assert.equal((await db.imageAsset.findUnique({where:{id:142}})).content_revision,1);
    assert.equal(await db.workItem.count({where:{content_item_id:1103}}),0);
    const rebound=await controls.rebindTelegram1103Asset({...base,decisionId:300},db);
    assert.ok(rebound.visual_review_work_item_id);assert.equal(await db.imageAsset.count({where:{content_item_id:1103}}),1);
    assert.equal((await controls.rebindTelegram1103Asset({...base,decisionId:300},db)).replayed,true);
    const historical=await db.artDirectionDecision.findUnique({where:{id:285}});assert.equal(historical.source_content_revision,1);
    // Synthetic normal Art acceptance: no provider access; test the independently guarded next boundary.
    await db.imageAsset.update({where:{id:142},data:{status:'approved'}});
    await db.contentItem.update({where:{id:1103},data:{selected_asset_id:142,visual_state:'APPROVED',handoff_state:'ready',status:'ready_for_execution'}});
    const release={...base,idempotencyKey:'pg-release1103',expectedManifestChecksum:p.manifest};
    await controls.releaseTelegram1103(release,db,async()=>p.manifest);
    let sends=0;
    const deps={db,loadMedia:async()=>({file:{name:'original.mp4'},metadata:{width:1080,height:1920,duration:42.766}}),
        send:async()=>{sends++;assert.equal(await db.deliveryAttempt.count({where:{content_item_id:1103,status:'pending'}}),1);
            return{verified:true,messageId:777,publicUrl:'https://t.me/analystcraft/777',mimeType:'video/mp4',sha256:p.assetSha};},
        recordFact:args=>facts.record(args)};
    const service=new Telegram1103Publication(deps),args={projectId:10,taskId:1103,idempotencyKey:'pg-publish1103',dryRun:false};
    const race=await Promise.allSettled([service.execute(args),service.execute(args)]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(sends,1);
    const fact=await db.publicationFact.findUnique({where:{content_item_id:1103}});
    assert.equal(fact.artifact_kind,'video');assert.equal(fact.public_url,'https://t.me/analystcraft/777');
    const attempt=await db.deliveryAttempt.findFirst({where:{content_item_id:1103}});assert.equal(attempt.status,'delivered');
    assert.equal(await db.deliveryAttempt.count({where:{content_item_id:1103}}),1);
    assert.equal((await service.execute(args)).replayed,true);assert.equal(sends,1);
    assert.equal((await db.contentItem.findUnique({where:{id:1103}})).draft_text,body);
    assert.equal((await db.imageAsset.findUnique({where:{id:142}})).file_url,'https://media.synthetic.invalid/original.mp4');
});
test.after(async()=>{try{if(created){await db.project.deleteMany({where:{id:10,slug}});if(userId)await db.user.deleteMany({where:{id:userId,email:'telegram1103@synthetic.invalid'}});}}
    finally{await db.$disconnect();await pool.end();}});
