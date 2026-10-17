const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { repairReviewHandoff, reviewRepairMetadataHash, reviewRepairStateHash,
    getReviewRepairSnapshot } = require('../../dist/services/review_handoff_repair');
const sha = value => createHash('sha256').update(value).digest('hex');
const date = '2026-10-16T14:00:00.000Z';
const args = { projectId: 7, taskId: 1136, workItemId: 1948, actorId: 'user:2',
    expectedChannelId: 6, expectedRevision: 2, expectedBodySha256: sha('same body'),
    expectedScheduleAt: date, expectedPublishAt: date, expectedResultVersion: 2,
    expectedChannelConfigSha256: sha(JSON.stringify({ execution_modes: ['manual'] })),
    idempotencyKey: 'test-repair', reason: 'Owner-authorized review and metadata recovery', apply: false };
function fixture() {
    let state = { task: { id: 1136, project_id: 7, channel_id: 6, content_revision: 2,
        accepted_revision: null, draft_text: 'same body', status: 'drafted', text_state: 'draft',
        visual_state: 'STALE', visual_placement: 'feed', selected_asset_id: null,
        publication_mode: 'approval_required', schedule_at: new Date(date), publish_at: new Date(date),
        published_link: null, publication_fact: null, quality_report: { preserved: 'history',
            handoff_bundle: { mode: 'automated' } }, channel: { id: 6, project_id: 7, type: 'linkedin',
                name: 'seturon_linkedin_page', config: { execution_modes: ['manual'] } } },
        review: { id: 1948, project_id: 7, content_item_id: 1136, kind: 'content_review',
            state: 'waiting_approval', assignee_role: 'content_reviewer', input_context_version: 2,
            result_version: 2, result_payload: { content_revision: 2, body: 'same body' },
            lease_token: null, lease_actor_id: null, item_key: 'slot', due_at: new Date(date),
            note: 'Historical review note', reason_code: 'HISTORICAL_REASON' },
        approval: { id: 368, decision: 'approved', result_version: 2 }, replacements: [], events: [],
        attempts: 0, owner: true, failAudit: false };
    const db = {
        projectMember: { findUnique: async () => ({ role: state.owner ? 'owner' : 'editor' }) },
        contentItem: { findFirst: async () => state.task, updateMany: async ({ data }) => {
            Object.assign(state.task, data); return { count: 1 }; } },
        workItem: { findFirst: async () => state.review, count: async () => 0,
            updateMany: async ({ where, data }) => { if (state.review.state !== where.state) return { count: 0 };
                Object.assign(state.review, data); return { count: 1 }; },
            create: async ({ data }) => { const r = { id: 2000, ...data }; state.replacements.push(r); return r; } },
        approvalDecision: { findUnique: async () => state.approval },
        deliveryAttempt: { count: async () => state.attempts },
        workflowEvent: { findUnique: async () => state.events[0] || null,
            create: async ({ data }) => { if (state.failAudit) throw Error('audit unavailable');
                const e = { id: 4000, ...data }; state.events.push(e); return e; } },
        $transaction: async run => { const before = structuredClone(state); try { return await run(db); }
            catch (e) { state = before; throw e; } }
    };
    return { db, get state() { return state; } };
}
const reference = fixture().state;
args.expectedTaskMetadataSha256 = reviewRepairMetadataHash(reference.task);
args.expectedReviewStateSha256 = reviewRepairStateHash(reference.review);
test('preview has no writes or approval', async () => {
    const f = fixture(); const before = structuredClone(f.state);
    const r = await repairReviewHandoff(args, f.db);
    assert.equal(r.mode, 'preview'); assert.deepEqual(f.state, before);
});
test('repair preserves immutable review/approval and body, replaces review at result0 and manual handoff atomically', async () => {
    const f = fixture(); const before = structuredClone(f.state);
    const r = await repairReviewHandoff({ ...args, apply: true }, f.db);
    assert.equal(r.replacement_work_item_id, 2000);
    assert.equal(f.state.review.state, 'completed');
    assert.deepEqual(f.state.review.result_payload, before.review.result_payload);
    assert.equal(f.state.review.note, before.review.note);
    assert.equal(f.state.review.reason_code, before.review.reason_code);
    assert.deepEqual(f.state.approval, before.approval);
    assert.equal(f.state.task.draft_text, before.task.draft_text);
    assert.equal(f.state.task.accepted_revision, null);
    assert.equal(f.state.task.publication_mode, 'approval_required');
    assert.equal(f.state.task.quality_report.preserved, 'history');
    assert.equal(f.state.task.quality_report.handoff_bundle.mode, 'manual');
    assert.equal(f.state.task.quality_report.handoff_bundle.transport.connector_authority, 'manual_only');
    assert.equal(f.state.replacements[0].result_version, 0);
    assert.equal(f.state.replacements[0].input_context_version, 2);
    assert.equal(f.state.replacements[0].state, 'available');
    assert.equal(f.state.attempts, 0);
});
test('same key replays one replacement; changed key payload is rejected', async () => {
    const f = fixture(); const input = { ...args, apply: true };
    await repairReviewHandoff(input, f.db);
    assert.equal((await repairReviewHandoff(input, f.db)).replayed, true);
    assert.equal(f.state.replacements.length, 1);
    await assert.rejects(repairReviewHandoff({ ...input, expectedRevision: 3 }, f.db), /IDEMPOTENCY/);
});
test('owner/tenant/body/revision/config/fact/attempt/lease drift fail before mutation', async () => {
    for (const mutate of [f => f.state.owner = false, f => f.state.task.project_id = 8,
        f => f.state.task.draft_text = 'drift', f => f.state.task.content_revision = 3,
        f => f.state.task.channel.config.execution_modes = ['automated'],
        f => f.state.task.quality_report.identity_binding = { linkedin_company_id: 'foreign' },
        f => f.state.review.note = 'Changed review',
        f => f.state.task.publication_fact = { id: 1 }, f => f.state.attempts = 1,
        f => f.state.review.lease_actor_id = 'active-editor']) {
        const f = fixture(); mutate(f); const before = structuredClone(f.state);
        await assert.rejects(repairReviewHandoff({ ...args, apply: true }, f.db));
        assert.deepEqual(f.state, before);
    }
});
test('audit failure rolls back review supersession, replacement, projection', async () => {
    const f = fixture(); f.state.failAudit = true; const before = structuredClone(f.state);
    await assert.rejects(repairReviewHandoff({ ...args, apply: true }, f.db), /audit unavailable/);
    assert.deepEqual(f.state, before);
});
test('safe snapshot rejects a non-owner and foreign task without writes', async () => {
    for (const mutate of [f => f.state.owner = false, f => f.state.task.project_id = 8]) {
        const f = fixture(); mutate(f); const before = structuredClone(f.state);
        await assert.rejects(getReviewRepairSnapshot({ projectId: 7, taskId: 1136,
            workItemId: 1948, actorId: 'user:2' }, f.db));
        assert.deepEqual(f.state, before);
    }
});
test('apply snapshot reads occur only inside the replay transaction', async () => {
    const f = fixture(); let inTransaction = false; let outsideReads = 0;
    const load = f.db.contentItem.findFirst;
    f.db.contentItem.findFirst = async args => { if (!inTransaction) outsideReads++; return load(args); };
    const transact = f.db.$transaction;
    f.db.$transaction = async run => transact(async tx => { inTransaction = true;
        try { return await run(tx); } finally { inTransaction = false; } });
    await repairReviewHandoff({ ...args, apply: true }, f.db);
    assert.equal(outsideReads, 0);
});
test('blocked competing review is not a second review path', async () => {
    const f = fixture(); f.db.workItem.count = async ({ where }) => where.state.in.includes('blocked') ? 1 : 0;
    await assert.rejects(repairReviewHandoff({ ...args, apply: true }, f.db), /SNAPSHOT_CHANGED/);
    assert.equal(f.state.replacements.length, 0);
});
test('placement, title, item identity, account name/type and review scheduling are snapshot-bound', async () => {
    for (const mutate of [f => f.state.task.visual_placement = 'carousel', f => f.state.task.title = 'drift',
        f => f.state.task.item_key = 'foreign-slot', f => f.state.task.channel.name = 'foreign-account',
        f => f.state.task.channel.type = 'x', f => f.state.review.due_at = new Date('2026-10-17')]) {
        const f = fixture(); mutate(f);
        await assert.rejects(repairReviewHandoff({ ...args, apply: true }, f.db), /SNAPSHOT_CHANGED/);
    }
});
test('repair cannot discard a review prerequisite when creating available work', async () => {
    const f = fixture(); f.state.review.depends_on_item_id = 9;
    const input = { ...args, apply: true, expectedReviewStateSha256: reviewRepairStateHash(f.state.review) };
    await assert.rejects(repairReviewHandoff(input, f.db), /SNAPSHOT_CHANGED/);
    assert.equal(f.state.replacements.length, 0);
});
test('owner can obtain safe server-computed snapshot through the operator boundary', async () => {
    assert.equal(typeof getReviewRepairSnapshot, 'function');
    const f = fixture(); const before = structuredClone(f.state);
    const r = await getReviewRepairSnapshot({ projectId: 7, taskId: 1136, workItemId: 1948, actorId: 'user:2' }, f.db);
    assert.equal(r.expected_snapshot.expectedTaskMetadataSha256, args.expectedTaskMetadataSha256);
    assert.equal(r.expected_snapshot.expectedReviewStateSha256, args.expectedReviewStateSha256);
    assert.equal(r.expected_snapshot.expectedChannelConfigSha256, args.expectedChannelConfigSha256);
    assert.equal(JSON.stringify(r).includes('same body'), false);
    assert.equal(JSON.stringify(r).includes('Historical review note'), false);
    assert.deepEqual(f.state, before);
});
test('configured Telegram review recovery preserves all publication gates and immutable history', async () => {
    const f=fixture();
    f.state.task.channel.type='telegram';f.state.task.channel.name='synthetic_tg';
    f.state.task.channel.config={execution_modes:['automated']};
    const before=structuredClone(f.state);
    const snapshot=await getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db);
    assert.deepEqual(f.state,before);
    const request={...args,...snapshot.expected_snapshot};
    const preview=await repairReviewHandoff(request,f.db);
    assert.equal(preview.handoff_mode,'automated');assert.equal(preview.connector_authority,'configured');
    assert.equal(preview.publication_authorized,false);assert.deepEqual(f.state,before);
    const applied=await repairReviewHandoff({...request,apply:true},f.db);
    assert.equal(applied.publication_authorized,false);assert.equal(f.state.task.accepted_revision,null);
    assert.equal(f.state.task.publication_mode,'approval_required');assert.equal(f.state.task.status,'drafted');
    assert.equal(f.state.task.visual_state,'STALE');assert.equal(f.state.task.selected_asset_id,null);
    assert.equal(f.state.task.draft_text,before.task.draft_text);
    assert.deepEqual(f.state.task.schedule_at,before.task.schedule_at);assert.deepEqual(f.state.task.publish_at,before.task.publish_at);
    assert.deepEqual(f.state.task.channel,before.task.channel);assert.deepEqual(f.state.approval,before.approval);
    assert.deepEqual(f.state.review.result_payload,before.review.result_payload);
    assert.equal(f.state.replacements[0].result_version,0);assert.equal(f.state.replacements[0].input_context_version,2);
    assert.equal(f.state.task.quality_report.handoff_bundle.transport.connector_authority,'configured');
    assert.equal(f.state.attempts,0);assert.equal(f.state.task.publication_fact,null);
});
test('unsupported placement never becomes configured execution metadata during review recovery',async()=>{
    const f=fixture();f.state.task.channel.type='telegram';f.state.task.channel.name='synthetic_tg';
    f.state.task.channel.config={execution_modes:['automated']};f.state.task.visual_placement='video_cover';
    const before=structuredClone(f.state);
    await assert.rejects(getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
    assert.deepEqual(f.state,before);
    const exact={...args,expectedTaskMetadataSha256:reviewRepairMetadataHash(f.state.task),
        expectedChannelConfigSha256:sha(JSON.stringify(f.state.task.channel.config))};
    for(const apply of [false,true])await assert.rejects(repairReviewHandoff({...exact,apply},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
    assert.deepEqual(f.state,before);
    f.state.task.channel.config.canonical_placements=['video_cover'];
    const configured=structuredClone(f.state);
    await assert.rejects(getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
    assert.deepEqual(f.state,configured);
});
test('missing stored placement cannot silently materialize as feed',async()=>{
    for(const placement of [null,'',' ']){
        const f=fixture();f.state.task.visual_placement=placement;const before=structuredClone(f.state);
        await assert.rejects(getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
        const exact={...args,expectedTaskMetadataSha256:reviewRepairMetadataHash(f.state.task)};
        for(const apply of [false,true])await assert.rejects(repairReviewHandoff({...exact,apply},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
        assert.deepEqual(f.state,before);
    }
});
test('canonical Dzen article-cover aliases preserve existing manual recovery behavior',async()=>{
    const {canonicalPlacementsForChannel,publicationPlacementAssetContract}=require('../../dist/services/publication_placement_contract');
    for(const type of ['dzen','zen','zen_article']){
        const f=fixture();f.state.task.channel.type=type;f.state.task.visual_placement='article_cover';
        assert.deepEqual(canonicalPlacementsForChannel(f.state.task.channel),type==='zen_article'?['article_cover']:['article_cover','feed']);
        for(const placement of canonicalPlacementsForChannel({type}))assert.deepEqual(
            publicationPlacementAssetContract({type},placement),publicationPlacementAssetContract({type:'dzen'},placement));
        const before=structuredClone(f.state);
        const snapshot=await getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db);
        assert.deepEqual(f.state,before);
        const result=await repairReviewHandoff({...args,...snapshot.expected_snapshot,apply:true},f.db);
        assert.equal(result.publication_authorized,false);assert.equal(result.handoff_mode,'manual');
        assert.equal(result.connector_authority,'manual_only');assert.equal(f.state.task.visual_placement,'article_cover');
        assert.equal(f.state.task.channel.type,type);assert.equal(f.state.task.accepted_revision,null);
        assert.equal(f.state.task.publication_mode,'approval_required');assert.deepEqual(f.state.approval,before.approval);
        assert.equal(f.state.attempts,0);
    }
});
test('article-specific Dzen alias never admits feed, including configuration override',async()=>{
    const {canonicalPlacementsForChannel}=require('../../dist/services/publication_placement_contract');
    const {dzenPublicationTypeForAction}=require('../../dist/services/dzen_publication_route');
    assert.equal(dzenPublicationTypeForAction('zen_feed:publish','zen_article'),'article');
    for(const config of [{execution_modes:['manual']},{canonical_placements:['feed'],execution_modes:['automated']}]){
        const f=fixture();f.state.task.channel.type='zen_article';f.state.task.channel.config=config;
        assert.ok(!canonicalPlacementsForChannel(f.state.task.channel).includes('feed'));
        const before=structuredClone(f.state);
        await assert.rejects(getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
        assert.deepEqual(f.state,before);
    }
});
test('existing Habr, VC and OK aliases retain canonical contract and review identity',async()=>{
    const {canonicalPlacementsForChannel,publicationPlacementAssetContract}=require('../../dist/services/publication_placement_contract');
    for(const [type,canonical,placement] of [['habr_article','habr','article_cover'],['vc_article','vc','article_cover'],['odnoklassniki','ok','feed']]){
        const f=fixture();f.state.task.channel.type=type;f.state.task.visual_placement=placement;
        assert.deepEqual(canonicalPlacementsForChannel({type}),canonicalPlacementsForChannel({type:canonical}));
        assert.deepEqual(publicationPlacementAssetContract({type},placement),publicationPlacementAssetContract({type:canonical},placement));
        const snapshot=await getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db);
        assert.equal((await repairReviewHandoff({...args,...snapshot.expected_snapshot,apply:true},f.db)).publication_authorized,false);
        assert.equal(f.state.task.channel.type,type);assert.equal(f.state.task.visual_placement,placement);
    }
});
test('arbitrary configuration-only feed contract cannot become configured execution metadata',async()=>{
    const f=fixture();f.state.task.channel.type='custom';
    f.state.task.channel.config={canonical_placements:['feed'],execution_modes:['automated']};
    const before=structuredClone(f.state);
    await assert.rejects(getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
    assert.deepEqual(f.state,before);
});
test('established feed contracts remain recoverable without enabling unimplemented formats',async()=>{
    for(const type of ['linkedin','x','ok','facebook','tenchat','telegram','telegram_chat','threads','vk','setka']){
        const f=fixture();f.state.task.channel.type=type;const before=structuredClone(f.state);
        const snapshot=await getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db);
        assert.equal(snapshot.publication_authorized,false);assert.deepEqual(f.state,before);
    }
    for(const [type,placement] of [['linkedin','carousel'],['instagram','reel'],['email','body'],['video','video_cover']]){
        const f=fixture();f.state.task.channel.type=type;f.state.task.visual_placement=placement;
        const before=structuredClone(f.state);
        await assert.rejects(getReviewRepairSnapshot({projectId:7,taskId:1136,workItemId:1948,actorId:'user:2'},f.db),/REVIEW_PLACEMENT_UNSUPPORTED/);
        assert.deepEqual(f.state,before);
    }
});
