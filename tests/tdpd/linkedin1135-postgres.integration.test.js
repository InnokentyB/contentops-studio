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
const {default:db,pool}=require('../../dist/db');
const svc=require('../../dist/services/linkedin1135_browser');const facts=require('../../dist/services/publication_fact.service').default;
const {body}=require('./linkedin1135.fixture');const p=svc.LINKEDIN1135;
const slug='isolated_linkedin1135_fixture';let created=false,userId;
test('real PostgreSQL release/start races, rollback and atomic fact confirmation for exact company image post',
    {timeout:45000},async()=>{
    assert.equal(await db.project.findUnique({where:{id:10}}),null);
    await db.project.create({data:{id:10,name:'Synthetic company fixture',slug}});created=true;
    const user=await db.user.create({data:{email:'linkedin1135@synthetic.invalid',name:'Synthetic owner',password_hash:'not-a-login-credential'}});userId=user.id;
    const actorId=`user:${userId}`;await db.projectMember.create({data:{project_id:10,user_id:userId,role:'owner'}});
    await db.socialChannel.create({data:{id:179,project_id:10,name:'Synthetic company',type:'linkedin',is_active:true,
        config:{account_ref:p.targetProfileUrl,channel_url:p.targetProfileUrl,account_type:'company_page',
            workflow_mode:'browser_required',capability_flags:{browser_publish:true}}}});
    await db.contentItem.create({data:{id:1135,project_id:10,channel_id:179,type:'publication',draft_text:body,
        content_revision:2,accepted_revision:2,text_state:'accepted',visual_state:'APPROVED',visual_decision_version:2,
        visual_placement:'feed',handoff_state:'ready',status:'ready_for_execution',publication_mode:'approval_required',
        schedule_at:new Date(p.schedule),publish_at:new Date(p.schedule),quality_report:{content_language:'en',handoff_bundle:{content_language:'en'}}}});
    await db.artDirectionDecision.create({data:{id:323,project_id:10,content_item_id:1135,decision_version:2,
        source_content_revision:2,channel:'linkedin',placement:'feed',decision:'GENERATE',reason:'Synthetic image',status:'active',actor_id:actorId}});
    await db.imageAsset.create({data:{id:163,project_id:10,content_item_id:1135,decision_id:323,content_revision:2,
        placement:'feed',prompt:'Synthetic image',file_url:'https://media.synthetic.invalid/asset163.jpg',status:'approved',
        provenance:{planner_storage:{sha256:p.assetSha256,mime_type:'image/jpeg',managed:true,provider:'r2'}}}});
    await db.contentItem.update({where:{id:1135},data:{selected_asset_id:163}});
    const release={projectId:10,taskId:1135,actorId,expectedManifestChecksum:p.manifest,
        expectedBodySha256:p.bodySha256,expectedScheduleAt:p.schedule,approvalReference:'Synthetic owner exact company GO',
        duplicateCheckReference:'Synthetic deterministic duplicate absence fixture',idempotencyKey:'pg-release1135'};
    const deps={db,manifest:async()=>({checksum:p.manifest})};
    const race=await Promise.allSettled([svc.releaseLinkedIn1135(release,deps),svc.releaseLinkedIn1135(release,deps)]);
    assert.ok(race.some(r=>r.status==='fulfilled'));
    const released=await svc.releaseLinkedIn1135(release,deps);const workId=released.browser_work_item_id;
    assert.equal(await db.workItem.count({where:{project_id:10,content_item_id:1135,kind:'browser_publish'}}),1);
    const lease=await svc.claimLinkedIn1135({projectId:10,actorId,workItemId:workId,idempotencyKey:'pg-claim1135'});
    const boundary={projectId:10,taskId:1135,channelId:179,actorId,workItemId:workId,leaseToken:lease.lease_token,
        approvalReference:release.approvalReference,idempotencyKey:'pg-send1135',contentRevision:2,textSha256:p.bodySha256,
        selectedAssetId:163,imageSha256:p.assetSha256};
    const starts=await Promise.allSettled([svc.startLinkedIn1135(boundary),svc.startLinkedIn1135(boundary)]);
    assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await db.deliveryAttempt.count({where:{project_id:10,content_item_id:1135}}),1);
    const attempt=await db.deliveryAttempt.findFirst({where:{project_id:10,content_item_id:1135}});
    const observed={...boundary,attemptId:attempt.id,observedAuthorUrl:p.targetProfileUrl,observedAccountType:'company_page',
        observedTextSha256:p.bodySha256,observedImageSha256:p.assetSha256,attachedImageCount:1,
        paragraphBlockSha256:svc.linkedin1135Paragraphs(body),duplicateAbsent:true,evidenceSha256:'1'.repeat(64)};
    await svc.preSubmitLinkedIn1135(observed);
    const confirm={...observed,publicUrl:'https://www.linkedin.com/feed/update/urn:li:activity:777/',
        providerObjectId:'urn:li:activity:777',publishedAt:'2026-10-16T15:00:00.000Z'};
    const failWriter=async args=>db.$transaction(async tx=>{await args.beforeWrite(tx);throw Error('synthetic fact failure');});
    await assert.rejects(svc.confirmLinkedIn1135(confirm,db,failWriter),/synthetic fact failure/);
    assert.equal((await db.deliveryAttempt.findUnique({where:{id:attempt.id}})).status,'pending');
    assert.equal(await db.publicationFact.count({where:{content_item_id:1135}}),0);
    assert.equal(await db.workflowEvent.count({where:{content_item_id:1135,command:'ba_confirm_linkedin_task1135_browser_submission'}}),0);
    const result=await svc.confirmLinkedIn1135(confirm,db,args=>facts.record(args));
    assert.ok(result.publication_fact.id);assert.equal((await db.deliveryAttempt.findUnique({where:{id:attempt.id}})).status,'delivered');
    assert.equal((await db.contentItem.findUnique({where:{id:1135}})).draft_text,body);
    assert.equal((await db.workItem.findUnique({where:{id:workId}})).state,'completed');
    const events=await db.workflowEvent.findMany({where:{content_item_id:1135}});
    assert.equal(JSON.stringify(events).includes(lease.lease_token),false);
});
test.after(async()=>{try{if(created){await db.project.deleteMany({where:{id:10,slug}});if(userId)await db.user.deleteMany({where:{id:userId,email:'linkedin1135@synthetic.invalid'}});}}
    finally{await db.$disconnect();await pool.end();}});
