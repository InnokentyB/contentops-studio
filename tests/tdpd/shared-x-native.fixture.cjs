const {fixture,request,sha,body}=require('./shared-browser.fixture.cjs');
function xFixture(taskId=2401,handle='synthetic_owner'){
    const f=fixture(),args=structuredClone(request),s=args.snapshot;
    args.taskId=taskId;s.taskId=taskId;s.selectedAssetId=null;s.assetSha256=null;
    s.identity={...s.identity,platform:'x',accountType:'personal',accountRef:'@'+handle,
        profileUrl:'https://x.com/'+handle,providerAccountId:handle};
    const t=f.state.task;t.id=taskId;t.selected_asset_id=null;t.selected_asset=null;
    t.visual_state='NO_VISUAL_NEEDED';t.visual_mode='none';t.channel.type='x';t.channel.name='synthetic_x';
    t.channel.config={account_ref:s.identity.accountRef,account_type:'personal',execution_modes:['manual'],
        channel_url:s.identity.profileUrl,capability_flags:{manual_handoff:true}};
    t.art_direction_decisions[0]={...t.art_direction_decisions[0],content_item_id:taskId,
        decision:'NO_VISUAL_NEEDED',channel:'x'};
    t.quality_report.handoff_bundle.task.account_ref=s.identity.accountRef;
    return{f,args};
}
function xObserved(send,attemptId){return{...send,attemptId,
    observedProfileUrl:send.snapshot.identity.profileUrl,observedProviderAccountId:send.snapshot.identity.providerAccountId,
    observedAccountType:'personal',observedBodySha256:sha(body),observedAssetSha256:null,
    paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:0,
    duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};}
module.exports={xFixture,xObserved};
