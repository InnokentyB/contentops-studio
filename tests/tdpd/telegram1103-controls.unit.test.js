const test = require('node:test');
const assert = require('node:assert/strict');
const { TG1103 } = require('../../dist/services/telegram1103/contract');
const { rebindTelegram1103Asset, releaseTelegram1103 } = require('../../dist/services/telegram1103/control');
const body = 'Удобный деплой. А цена роста?\n\nУправляемая инфраструктура снимает часть забот при запуске небольшого проекта. При росте нагрузки стоит заново сравнить стоимость и сопровождение вариантов. Это мнение из лекции, а не расчёт актуальных тарифов или универсальный совет уходить в self-hosting.\n\nПро создание продуктов и работу с AI в Telegram «Про продукты и системы»: https://t.me/+T79t_ZLStRg2ODky';
process.env.R2_PUBLIC_BASE_URL = 'https://media.synthetic.invalid';
const base = { projectId: 10, taskId: 1103, actorId: 'user:2', expectedBodySha256: TG1103.bodySha,
    expectedAssetSha256: TG1103.assetSha, reason: 'Owner-approved exact Telegram video recovery',
    idempotencyKey: 'video1103-test', apply: false };
function fixture() {
    let state = { owner: true, attempts: [], events: [], failAudit: false,
        task: { id: 1103, project_id: 10, channel_id: 109, content_revision: 2, accepted_revision: 2,
            text_state: 'accepted', draft_text: body, type: 'publication', visual_placement: 'video_cover',
            status: 'ready_for_execution', publication_mode: 'approval_required', visual_state: 'APPROVED',
            visual_decision_version: 2, selected_asset_id: 142, handoff_state: 'ready',
            schedule_at: new Date(TG1103.date), publish_at: new Date(TG1103.date),
            published_link: null, publication_fact: null, quality_report: { history: 'preserved' },
            channel: { id: 109, project_id: 10, type: 'telegram', name: 'analystcraft',
                config: { telegram_channel_id: '@analystcraft', handle: '@analystcraft', capability_flags: { api_publish: true } } } },
        asset: { id: 142, project_id: 10, content_item_id: 1103, content_revision: 2, decision_id: 300,
            status: 'approved', placement: 'video_cover', file_url: `${process.env.R2_PUBLIC_BASE_URL}/original.mp4`,
            asset_version: 1, provenance: { planner_storage: { managed: true, provider: 'r2',
                mime_type: 'video/mp4', sha256: TG1103.assetSha, byte_size: TG1103.bytes } },
            qa_report: { owner_uat: 'approved original speech', no_regeneration: true } },
        decision: { id: 300, project_id: 10, content_item_id: 1103, decision_version: 2,
            source_content_revision: 2, channel: 'telegram', placement: 'video_cover',
            status: 'active', decision: 'SOURCE_REQUIRED' }, reviews: [] };
    const db = {
        projectMember: { findUnique: async () => ({ role: state.owner ? 'owner' : 'publisher' }) },
        contentItem: { findFirst: async () => ({ ...state.task, selected_asset: { ...state.asset, decision: state.decision } }),
            updateMany: async ({ where, data }) => { if (where.status && where.status !== state.task.status) return { count: 0 };
                Object.assign(state.task, data); return { count: 1 }; } },
        imageAsset: { findFirst: async () => state.asset,
            updateMany: async ({ data }) => { Object.assign(state.asset, data); return { count: 1 }; } },
        artDirectionDecision: { findFirst: async () => state.decision },
        workItem: { create: async ({ data }) => { const r={id:2001,...data};state.reviews.push(r);return r; } },
        deliveryAttempt: { count: async () => state.attempts.length },
        workflowEvent: { findUnique: async ({ where }) => state.events.find(e => e.command === where.project_id_actor_id_command_idempotency_key.command) || null,
            create: async ({ data }) => { if (state.failAudit) throw Error('audit unavailable');const e={id:4001,...data};state.events.push(e);return e; } },
        $transaction: async run => { const before=structuredClone(state);try{return await run(db);}catch(e){state=before;throw e;} }
    };
    return { db, get state(){return state;} };
}
const release = f => releaseTelegram1103({ ...base, apply: true, expectedManifestChecksum: TG1103.manifest },
    f.db, async () => TG1103.manifest);
test('release preview is read-only; exact release binds MP4 SHA/channel/body and only changes authority', async () => {
    const f=fixture(), before=structuredClone(f.state);
    const preview=await releaseTelegram1103({ ...base, expectedManifestChecksum: TG1103.manifest }, f.db, async()=>TG1103.manifest);
    assert.equal(preview.mode,'preview');assert.deepEqual(f.state,before);
    const r=await release(f);assert.equal(r.publication_mode,'owner_released');
    assert.equal(r.asset_sha256,TG1103.assetSha);assert.equal(r.selected_asset_id,142);
    assert.equal(f.state.task.publication_mode,'owner_released');assert.equal(f.state.task.status,'ready_for_execution');
    assert.deepEqual(f.state.asset,before.asset);assert.equal(f.state.attempts.length,0);
    assert.equal((await release(f)).replayed,true);assert.equal(f.state.events.length,1);
});
test('release rejects wrong tenant, body, asset/SHA, MIME, stale revision, foreign target, attempt/fact and nonowner', async()=>{
    for(const mutate of [f=>f.state.owner=false,f=>f.state.task.channel_id=108,
        f=>f.state.task.draft_text+='drift',f=>f.state.task.accepted_revision=null,
        f=>f.state.asset.content_revision=1,f=>f.state.asset.id=143,
        f=>f.state.asset.provenance.planner_storage.sha256='0'.repeat(64),
        f=>f.state.asset.provenance.planner_storage.mime_type='image/jpeg',
        f=>f.state.task.channel.config.handle='@foreign',f=>f.state.attempts.push({id:1}),
        f=>f.state.task.publication_fact={id:1},f=>f.state.task.status='publishing']) {
        const f=fixture();mutate(f);const before=structuredClone(f.state);
        await assert.rejects(release(f));assert.deepEqual(f.state,before);
    }
});
test('same asset rebind requires current accepted Art decision, preserves R2 object and original review audit',async()=>{
    const f=fixture();Object.assign(f.state.task,{selected_asset_id:null,visual_state:'SOURCE_REQUIRED',handoff_state:'blocked',status:'approved'});
    Object.assign(f.state.asset,{content_revision:1,decision_id:285});const before=structuredClone(f.state.asset);
    const r=await rebindTelegram1103Asset({...base,decisionId:300,apply:true},f.db);
    assert.equal(r.asset_id,142);assert.equal(f.state.asset.file_url,before.file_url);
    assert.deepEqual(f.state.asset.provenance.planner_storage,before.provenance.planner_storage);
    assert.equal(f.state.asset.content_revision,2);assert.equal(f.state.asset.status,'candidate');
    assert.equal(f.state.task.selected_asset_id,null);assert.equal(f.state.task.handoff_state,'blocked');
    assert.equal(f.state.reviews.length,1);assert.equal(f.state.events[0].before_state.source_decision_id,285);
    assert.equal(f.state.events[0].before_state.source_content_revision,1);
});
test('rebind cannot accept content, overwrite history or release; transaction failure rolls back',async()=>{
    for(const mutate of [f=>f.state.task.accepted_revision=null,f=>f.state.decision.source_content_revision=1,
        f=>f.state.decision.id=301,f=>f.state.decision.status='superseded',f=>f.state.owner=false]) {
        const f=fixture();Object.assign(f.state.task,{selected_asset_id:null,visual_state:'SOURCE_REQUIRED',handoff_state:'blocked',status:'approved'});
        Object.assign(f.state.asset,{content_revision:1,decision_id:285});mutate(f);const before=structuredClone(f.state);
        await assert.rejects(rebindTelegram1103Asset({...base,decisionId:300,apply:true},f.db));assert.deepEqual(f.state,before);
    }
    const f=fixture();f.state.failAudit=true;const before=structuredClone(f.state);
    await assert.rejects(release(f),/audit unavailable/);assert.deepEqual(f.state,before);
});
module.exports={fixture,base,body};
test('committed release replay survives manifest outage but still requires current owner', async()=>{
    const f=fixture();await release(f);
    let manifestCalls=0;const outage=async()=>{manifestCalls++;throw Error('manifest unavailable');};
    const args={...base,apply:true,expectedManifestChecksum:TG1103.manifest};
    const replay=await releaseTelegram1103(args,f.db,outage);
    assert.equal(replay.replayed,true);assert.equal(manifestCalls,0);
    f.state.owner=false;
    await assert.rejects(releaseTelegram1103(args,f.db,outage),/OWNER_REQUIRED/);
    assert.equal(manifestCalls,0);
});
