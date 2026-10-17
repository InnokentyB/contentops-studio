const test=require('node:test'),assert=require('node:assert/strict');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const release=require(base+'/services/browser_publication_release.js');
const exec=require(base+'/services/browser_publication_execution.js');
const confirm=require(base+'/services/browser_publication_confirmation.js');
const {fixture,request,body,sha}=require('./shared-browser.fixture.cjs');
const profileId='019c0000-0000-7000-8000-000000000001';
const postId='019d0000-0000-7000-8000-000000000002';
function setkaFixture(taskId=2404){
    const f=fixture(),args=structuredClone(request),s=args.snapshot;args.taskId=taskId;s.taskId=taskId;
    s.identity={...s.identity,platform:'setka',accountType:'personal',accountRef:'synthetic_setka',
        profileUrl:'https://setka.ru/users/'+profileId,providerAccountId:profileId};
    const t=f.state.task;t.id=taskId;t.channel.type='setka';t.channel.name='synthetic_setka';
    t.channel.config={account_ref:s.identity.accountRef,account_type:'unknown',execution_modes:['manual'],
        profile_url:s.identity.profileUrl,capability_flags:{manual_handoff:true}};
    t.selected_asset.content_item_id=taskId;
    t.art_direction_decisions[0]={...t.art_direction_decisions[0],content_item_id:taskId,channel:'setka'};
    return{f,args};
}
async function submitted(){const{f,args}=setkaFixture();
    await release.repairBrowserPublicationMetadata({...args,idempotencyKey:'repair',apply:true},f);
    await release.releaseBrowserPublication({...args,apply:true},f);const workItemId=f.state.work[0].id;
    const lease=await exec.claimBrowserPublication({...args,workItemId,idempotencyKey:'claim'},f);
    const send={...args,workItemId,leaseToken:lease.lease_token,idempotencyKey:'send'};
    const start=await exec.startBrowserSubmission(send,f);
    const observed={...send,attemptId:start.attempt_id,observedProfileUrl:args.snapshot.identity.profileUrl,
        observedProviderAccountId:profileId,observedAccountType:'personal',observedBodySha256:sha(body),
        observedAssetSha256:args.snapshot.assetSha256,paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),
        attachedImageCount:1,duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
    await exec.preSubmitBrowserSubmission(observed,f);
    return{f,args,send,observed,confirmation:{...observed,publicUrl:'https://setka.ru/posts/'+postId,
        providerObjectId:postId,publishedAt:new Date().toISOString()}};
}
const writer=(f,fail=false)=>async a=>f.db.$transaction(async tx=>{await a.beforeWrite(tx);
    if(fail)throw Error('synthetic Setka fact failure');
    const fact={id:600,project_id:a.projectId,channel_id:f.state.task.channel_id,content_item_id:a.taskId,
        public_url:a.publicUrl,provider_object_id:a.providerObjectId,published_at:new Date(a.publishedAt),evidence_ref:a.evidence.ref};
    f.state.fact=fact;f.state.task.publication_fact=fact;f.state.task.status='published';return fact;});
test('Setka preview is no-write and ordinary next task uses validated package data',async()=>{
    for(const id of [2404,3404]){const{f,args}=setkaFixture(id),before=structuredClone(f.state);
        const p=await release.inspectBrowserPublication(args,f);
        assert.equal(p.publication_authorized,false);assert.deepEqual(f.state,before);
        await release.repairBrowserPublicationMetadata({...args,idempotencyKey:'repair',apply:true},f);
        await release.releaseBrowserPublication({...args,apply:true},f);
        assert.equal(f.state.work.length,1);assert.equal(f.state.work[0].content_item_id,id);
        assert.equal(f.state.attempts.length,0);assert.equal(f.state.task.draft_text,body);
    }
});
test('Setka personal UUID identity and approved image stay mandatory',async()=>{
    for(const mutate of [a=>a.snapshot.identity.accountType='company_page',
        a=>a.snapshot.identity.providerAccountId='019c0000-0000-7000-8000-000000000099',
        a=>a.snapshot.identity.profileUrl='https://setka.ru/users/----',
        a=>a.snapshot.identity.profileUrl+='?account=other',a=>a.snapshot.identity.profileUrl+='#fragment',
        a=>a.snapshot.selectedAssetId=null,a=>a.snapshot.assetSha256=null]){
        const{f,args}=setkaFixture();mutate(args);const before=structuredClone(f.state);
        await assert.rejects(release.inspectBrowserPublication(args,f));assert.deepEqual(f.state,before);
    }
    for(const mutate of [f=>f.state.task.selected_asset.status='rejected',f=>f.state.task.visual_state='NO_VISUAL_NEEDED',
        f=>f.state.task.selected_asset.content_revision=1,f=>f.state.task.art_direction_decisions[0].decision='NO_VISUAL_NEEDED',
        f=>f.state.task.channel.config.account_type='company_page']){
        const{f,args}=setkaFixture();mutate(f);await assert.rejects(release.inspectBrowserPublication(args,f));
    }
});
test('Setka native profile/body/image mismatch cannot produce another permit',async()=>{
    const{f,observed}=await submitted();const before=structuredClone(f.state);
    for(const patch of [{observedProviderAccountId:postId},{attachedImageCount:0},
        {observedAssetSha256:'0'.repeat(64)},{observedBodySha256:'0'.repeat(64)},{duplicateAbsent:false}])
        await assert.rejects(exec.preSubmitBrowserSubmission({...observed,...patch},f));
    assert.equal((await exec.preSubmitBrowserSubmission(observed,f)).submission_permitted,false);
    assert.deepEqual(f.state,before);
});
test('Setka UUID permalink, native object/time and evidence commit atomically; replay is read-only',async()=>{
    const{f,confirmation:a}=await submitted(),before=structuredClone(f.state);
    for(const patch of [{publicUrl:'https://evil.invalid/posts/'+postId},{publicUrl:a.publicUrl+'?x=1'},
        {publicUrl:a.publicUrl+'#fragment'},{publicUrl:'https://user@setka.ru/posts/'+postId},
        {publicUrl:'https://setka.ru/posts/----',providerObjectId:'----'},
        {providerObjectId:profileId},{publishedAt:'2020-01-01T00:00:00.000Z'}])
        await assert.rejects(confirm.confirmBrowserSubmission({...a,...patch},f,writer(f)));
    await assert.rejects(confirm.confirmBrowserSubmission(a,f,writer(f,true)),/Setka fact failure/);
    assert.deepEqual(f.state,before);
    const result=await confirm.confirmBrowserSubmission(a,f,writer(f));
    assert.equal(result.public_url,a.publicUrl);assert.equal(f.state.attempts[0].status,'delivered');
    const after=structuredClone(f.state);assert.equal((await confirm.confirmBrowserSubmission(a,f,writer(f))).replayed,true);
    assert.deepEqual(f.state,after);
});
test('Setka UNKNOWN/expired lease reconciles same attempt and never grants resend',async()=>{
    const{f,send,observed,confirmation:a}=await submitted();
    await exec.markBrowserSubmissionUncertain({...send,attemptId:observed.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},f);
    f.state.work[0].lease_expires_at=new Date(0);
    await assert.rejects(exec.preSubmitBrowserSubmission(observed,f));
    const{leaseToken,...readback}=a;
    assert.equal((await confirm.reconcileBrowserSubmission(readback,f,writer(f))).submission_permitted,false);
    assert.equal(f.state.attempts.length,1);assert.ok(f.state.fact);
});
module.exports={setkaFixture};
