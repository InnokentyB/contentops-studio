const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {request,snapshot,fixture} = require('./shared-browser.fixture.cjs');
const artifact = path.join(process.env.SHARED_BROWSER_DIST || '/opt/planner/dist','services/browser_publication_release.js');
const svc = fs.existsSync(artifact) ? require(artifact) : {};
test('S1 generic preview/repair/release exists at the operator boundary',()=>{
    for(const name of ['inspectBrowserPublication','repairBrowserPublicationMetadata','releaseBrowserPublication'])
        assert.equal(typeof svc[name],'function',name+' missing from approved shared lifecycle');
});
async function prepared(f) {
    return svc.repairBrowserPublicationMetadata({...request,idempotencyKey:'repair',apply:true},f);
}
test('S1 preview never writes; metadata repair preserves accepted body/date/art/channel and creates no release',async()=>{
    const f=fixture(), before=structuredClone(f.state);
    const preview=await svc.inspectBrowserPublication(request,f);
    assert.equal(preview.publication_authorized,false);assert.deepEqual(f.state,before);
    await prepared(f);
    for(const key of ['draft_text','content_revision','accepted_revision','schedule_at','publish_at','channel_id','selected_asset','art_direction_decisions'])
        assert.deepEqual(f.state.task[key],before.task[key],key);
    assert.equal(f.state.task.quality_report.content_language,'en');
    assert.equal(f.state.task.quality_report.handoff_bundle.content_language,'en');
    assert.equal(f.state.task.quality_report.history,'preserve');assert.equal(f.state.work.length,0);
    assert.equal(f.state.attempts.length,0);assert.equal(f.state.fact,null);
});
test('S1 release creates one revision-bound WI and records exact replay; changed request conflicts',async()=>{
    const f=fixture();await prepared(f);
    const r=await svc.releaseBrowserPublication({...request,apply:true},f);
    assert.equal(r.publication_authorized,true);assert.equal(f.state.work.length,1);
    assert.equal(f.state.work[0].input_context_version,snapshot.contentRevision);
    assert.equal(f.state.attempts.length,0);
    assert.equal((await svc.releaseBrowserPublication({...request,apply:true},f)).replayed,true);
    await assert.rejects(svc.releaseBrowserPublication({...request,apply:true,approvalReference:'different owner approval'},f),/IDEMPOTENCY_CONFLICT/);
});
test('S2 wrong owner/tenant/binding/manifest/content/date/asset/decision, hold or prior attempt reject without mutation',async()=>{
    const cases=[f=>f.state.owner=false,f=>f.state.task.project_id=9,f=>f.state.task.channel.project_id=9,
        f=>f.state.manifest='sha256:'+'0'.repeat(64),f=>f.state.task.draft_text+='drift',
        f=>f.state.task.accepted_revision=4,f=>f.state.task.publish_at=new Date('2026-10-16T15:00:00Z'),
        f=>f.state.task.selected_asset.project_id=9,f=>f.state.task.selected_asset.content_revision=4,
        f=>f.state.task.selected_asset.provenance.planner_storage.mime_type='video/mp4',
        f=>f.state.task.art_direction_decisions[0].status='superseded',
        f=>f.state.task.channel.config.raw_account.url='https://www.linkedin.com/company/other/',
        f=>f.state.task.quality_report.publication_hold=true,
        f=>f.state.attempts.push({id:1,project_id:7,content_item_id:1136,status:'pending'})];
    for(const mutate of cases){const f=fixture();await prepared(f);mutate(f);const before=structuredClone(f.state);
        await assert.rejects(svc.releaseBrowserPublication({...request,apply:true},f));assert.deepEqual(f.state,before);}
});
test('S2 failed release audit atomically rolls back task and WI, even after valid metadata repair',async()=>{
    const f=fixture();await prepared(f);f.state.failAudit=true;const before=structuredClone(f.state);
    await assert.rejects(svc.releaseBrowserPublication({...request,apply:true},f),/audit unavailable/);
    assert.deepEqual(f.state,before);
});
test('S1 ordinary next task is parameters, not another deployed module',async()=>{
    const f=fixture(), next=structuredClone(request);next.taskId=2136;next.snapshot.taskId=2136;
    f.state.task.id=2136;f.state.task.selected_asset.content_item_id=2136;
    f.state.task.art_direction_decisions[0].content_item_id=2136;
    await svc.repairBrowserPublicationMetadata({...next,apply:true,idempotencyKey:'next-repair'},f);
    await svc.releaseBrowserPublication({...next,apply:true},f);
    assert.equal(f.state.work[0].content_item_id,2136);
});
test('S2 numeric company profile and adopted Registry provider ID must agree',async()=>{
    const f=fixture(),args=structuredClone(request);
    args.snapshot.identity.profileUrl='https://www.linkedin.com/company/79633032/';
    f.state.task.channel.config.raw_account.url=args.snapshot.identity.profileUrl;
    await assert.rejects(svc.inspectBrowserPublication(args,f),/BROWSER_IDENTITY_INVALID/);
});
test('S2 token-bound outer project/task cannot hide a different tenant in the snapshot',async()=>{
    const f=fixture(),args=structuredClone(request);args.snapshot.projectId=9;
    await assert.rejects(svc.inspectBrowserPublication(args,f),/SCOPE_MISMATCH/);
    args.snapshot.projectId=args.projectId;args.snapshot.taskId=999;
    await assert.rejects(svc.inspectBrowserPublication(args,f),/SCOPE_MISMATCH/);
});
