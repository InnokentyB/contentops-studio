import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:prepare-approval-guard';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-only';

test('preparePublicationTask leaves an approval-required task and stale bundle untouched', async context => {
    const { default: db } = await import('../db');
    const { default: service } = await import('../services/mcp_publication.service');
    const { default: art } = await import('../services/art_direction.service');
    const { default: plans } = await import('../services/publication_plan.service');
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
    // Prisma delegate methods are provided by a Proxy, without method descriptors;
    // Node's mock.method cannot patch them. Validate and replace through that Proxy.
    const stubDelegate = (target: object, method: string, implementation: (...args: unknown[]) => unknown): void => {
        const original: unknown = Reflect.get(target, method);
        assert.equal(typeof original, 'function');
        assert.equal(Reflect.set(target, method, implementation), true);
        context.after(() => { assert.equal(Reflect.set(target, method, original), true); });
    };
    const before = structuredClone(task);
    let writes = 0;
    let settingsReads = 0;
    // The extracted plan loader reads Prisma directly. Stub its real dependency,
    // rather than replacing a facade method that the implementation never calls.
    stubDelegate(db.projectSettings, 'findMany', async (params: unknown) => {
        assert.ok(params && typeof params === 'object' && 'where' in params);
        assert.deepEqual(params.where, { project_id: 10, key: { in: [
            'publication_plan_meta', 'publication_plan_assets', 'publication_plan_accounts',
            'publication_plan_asset_snapshots', 'publication_plan_content_file_snapshots'
        ] } });
        settingsReads++;
        return [];
    });
    // Ordinary tasks have no durable owned lifecycle; these reads precede preparation.
    stubDelegate(db.workflowEvent, 'findFirst', async () => null);
    stubDelegate(db.connectorDispatchJob, 'findFirst', async () => null);
    stubDelegate(db.contentItem, 'findFirst', async () => task);
    const rejectWrite = async () => { writes++; throw new Error('unexpected preparation write'); };
    stubDelegate(db.contentItem, 'update', rejectWrite);
    stubDelegate(db.contentItem, 'updateMany', rejectWrite);
    context.mock.method(art, 'assertPublicationReady', async () => undefined);
    context.mock.method(plans, 'buildGeneratedContentItemHandoff', () => ({
        mode: 'automated', transport: { connector_authority: 'configured' }
    }));

    const result = await service.preparePublicationTask(10, 959);
    assert.equal(settingsReads, 1);
    assert.equal(writes, 0);
    assert.equal(result.item.publication_mode, 'approval_required');
    assert.equal(result.item.status, 'ready_for_execution');
    assert.equal(task.quality_report.publication_route, 'connector_auto');
    assert.deepEqual(task, before);
});
