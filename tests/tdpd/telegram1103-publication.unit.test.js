const test=require('node:test');const assert=require('node:assert/strict');
const {fixture,base}=require('./telegram1103-controls.unit.test');
const {TG1103}=require('../../dist/services/telegram1103/contract');
const {releaseTelegram1103}=require('../../dist/services/telegram1103/control');
const {Telegram1103Publication}=require('../../dist/services/telegram1103/publication');
async function harness(){
    const f=fixture();let sends=0,failSend=false,failFact=false;
    const db=f.db;
    db.workflowEvent.findFirst=async()=>f.state.events.find(e=>e.command===TG1103.releaseCommand)||null;
    db.deliveryAttempt.create=async({data})=>{const a={id:72,...data};f.state.attempts.push(a);return a;};
    db.deliveryAttempt.updateMany=async({where,data})=>{const a=f.state.attempts.find(a=>a.id===where.id&&a.status===where.status);
        if(!a)return{count:0};Object.assign(a,data);return{count:1};};
    db.contentItem.update=async({data})=>{Object.assign(f.state.task,data);return f.state.task;};
    const receipt={verified:true,messageId:777,publicUrl:'https://t.me/analystcraft/777',mimeType:'video/mp4',sha256:TG1103.assetSha};
    const svc=new Telegram1103Publication({db,
        loadMedia:async()=>({file:{name:'original.mp4'},metadata:{width:1080,height:1920,duration:42}}),
        send:async args=>{sends++;assert.equal(f.state.attempts.length,1);assert.equal(f.state.task.status,'publishing');
            assert.equal(args.file.name,'original.mp4');if(failSend)throw Error('uncertain provider secret must not escape');return receipt;},
        recordFact:async args=>db.$transaction(async tx=>{assert.equal(args.artifactKind,'video');await args.beforeWrite(tx);
            if(failFact)throw Error('fact unavailable');f.state.task.status='published';f.state.task.publication_fact={id:501,outcome:'published',artifact_kind:'video',provider_object_id:'777',public_url:receipt.publicUrl};
            return{publication_fact:f.state.task.publication_fact};})});
    await releaseTelegram1103({...base,apply:true,expectedManifestChecksum:TG1103.manifest},db,async()=>TG1103.manifest);
    return{f,svc,get sends(){return sends;},set failSend(v){failSend=v;},set failFact(v){failFact=v;},receipt};
}
const args={projectId:10,taskId:1103,idempotencyKey:'exact-video-once',dryRun:false};
test('video dry-run proves resource, previews video URL, and has zero attempt or provider send',async()=>{
    const h=await harness();const before=structuredClone(h.f.state);
    const r=await h.svc.execute({...args,dryRun:true});assert.equal(r.payload_preview.image_url,null);
    assert.equal(r.payload_preview.has_video,true);assert.equal(r.resource_readback,'PASS');
    assert.equal(h.sends,0);assert.deepEqual(h.f.state,before);
});
test('one canonical send records a durable attempt before provider, a video fact after readback, and replay never resends',async()=>{
    const h=await harness();const r=await h.svc.execute(args);
    assert.equal(r.mode,'published');assert.equal(h.sends,1);assert.equal(h.f.state.attempts[0].status,'delivered');
    assert.equal(r.publication_fact.artifact_kind,'video');assert.equal(r.published_link,'https://t.me/analystcraft/777');
    assert.equal((await h.svc.execute(args)).replayed,true);assert.equal(h.sends,1);
    assert.equal((await h.svc.execute({...args,idempotencyKey:'different-key'})).replayed,true);assert.equal(h.sends,1);
});
test('UNKNOWN send or finalization failure freezes the existing attempt for all keys without raw provider errors',async()=>{
    for(const failure of ['failSend','failFact']){
        const h=await harness();h[failure]=true;
        await assert.rejects(h.svc.execute(args),e=>/RESULT_UNCERTAIN/.test(e.message)&&!e.message.includes('secret'));
        assert.equal(h.sends,1);assert.equal(h.f.state.task.publication_fact,null);
        assert.equal(h.f.state.task.status,'publishing');assert.equal(h.f.state.attempts[0].status,'pending');
        await assert.rejects(h.svc.execute(args),/ATTEMPT_UNCERTAIN/);
        await assert.rejects(h.svc.execute({...args,idempotencyKey:'other'}),/ATTEMPT_UNCERTAIN/);
        assert.equal(h.sends,1);
    }
});
test('missing release, asset/config drift and malformed receipt cannot create a fact or second dispatch',async()=>{
    for(const mutate of [h=>h.f.state.events=[],h=>h.f.state.asset.provenance.planner_storage.sha256='0'.repeat(64),
        h=>h.f.state.task.channel.config.telegram_channel_id='@foreign',h=>h.f.state.asset.file_url+='?changed=true']){
        const h=await harness();mutate(h);await assert.rejects(h.svc.execute(args));assert.equal(h.sends,0);
    }
    const h=await harness();h.receipt.publicUrl='https://t.me/foreign/777';
    await assert.rejects(h.svc.execute(args),/RESULT_UNCERTAIN/);assert.equal(h.f.state.task.publication_fact,null);
});
