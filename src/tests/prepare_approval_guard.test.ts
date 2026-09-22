import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:prepare-approval-guard';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-only';

test('preparePublicationTask leaves an approval-required task and stale bundle untouched', async () => {
    const db = require('../db').default;
    const service = require('../services/mcp_publication.service').default as any;
    const art = require('../services/art_direction.service').default as any;
    const plans = require('../services/publication_plan.service').default as any;
    const original = {
        findFirst: db.contentItem.findFirst,
        update: db.contentItem.update,
        assertReady: art.assertPublicationReady,
        loadPlan: service.loadPublicationPlanContext,
        mutable: service.assertPublicationTaskMutableForMcp,
        buildBundle: plans.buildGeneratedContentItemHandoff
    };
    const task = {
        id: 959, project_id: 10, status: 'ready_for_execution',
        publication_mode: 'approval_required', content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', draft_text: 'Accepted rev1',
        schedule_at: new Date('2026-09-23T18:00:00Z'),
        assets: {}, quality_report: { publication_route: 'connector_auto',
            handoff_bundle: { mode: 'automated' } },
        channel: { type: 'telegram', config: { platform: 'telegram' } },
        selected_asset: null
    };
    let writes = 0;
    try {
        db.contentItem.findFirst = async () => task;
        db.contentItem.update = async () => { writes += 1; throw new Error('unexpected write'); };
        art.assertPublicationReady = async () => undefined;
        service.loadPublicationPlanContext = async () => null;
        service.assertPublicationTaskMutableForMcp = () => undefined;
        plans.buildGeneratedContentItemHandoff = () => ({ mode: 'automated', transport: { connector_authority: 'configured' } });

        const result = await service.preparePublicationTask(10, 959);
        assert.equal(writes, 0);
        assert.equal(result.item.publication_mode, 'approval_required');
        assert.equal(result.item.status, 'ready_for_execution');
        assert.equal(task.quality_report.publication_route, 'connector_auto');
    } finally {
        db.contentItem.findFirst = original.findFirst;
        db.contentItem.update = original.update;
        art.assertPublicationReady = original.assertReady;
        service.loadPublicationPlanContext = original.loadPlan;
        service.assertPublicationTaskMutableForMcp = original.mutable;
        plans.buildGeneratedContentItemHandoff = original.buildBundle;
    }
});
