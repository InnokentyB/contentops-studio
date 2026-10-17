const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {exactOwnedRouteBlock}=require(path.join(base,'services/exact_owned_route_guard.js'));
const {guardManualPublicationFact}=require(path.join(base,'services/publication_manual_fact_guard.js'));
const {fixture,request}=require('./shared-browser.fixture.cjs');
test('S6 every generic dispatch entry rejects a shared governed package without task-numbered admission',()=>{
    const f=fixture();f.state.task.quality_report.browser_release={lifecycle:'shared_browser_v1',publication_authorized:true};
    const block=exactOwnedRouteBlock(f.state.task);assert.equal(block?.blocked,true);
    assert.equal(block.required_command,'ba_start_browser_submission');assert.equal(block.retry_via_api,false);
});
test('S6 generic manual fact refuses to impersonate a browser attempt confirmation',async()=>{
    const f=fixture();f.state.task.quality_report.browser_release={lifecycle:'shared_browser_v1',publication_authorized:true};
    await assert.rejects(guardManualPublicationFact(f.db,{projectId:request.projectId,taskId:request.taskId,internalConfirmation:false}),/GOVERNED_BROWSER_CONFIRMATION_REQUIRED/);
    await guardManualPublicationFact(f.db,{projectId:request.projectId,taskId:request.taskId,internalConfirmation:true});
});
