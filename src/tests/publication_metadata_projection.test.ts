import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repairMaterializedPublicationProjection } from '../services/publication_metadata_repair';

test('repairs stale story action, handoff and metrics from the canonical channel binding', () => {
    const result = repairMaterializedPublicationProjection({
        assets: {
            account_ref: 'analystcraft_growth',
            action: {
                id: 'story-853',
                account_ref: 'analystcraft_growth',
                channel: 'growth_ops',
                action_type: 'manual_handoff'
            }
        },
        qualityReport: {
            handoff_bundle: {
                account: { ref: 'analystcraft_growth', details: { platform: 'growth_ops' } },
                task: { id: 'story-853', channel: 'growth_ops', action_type: 'manual_handoff', placement: 'story' },
                manual_checklist: ['Post from account: analystcraft_growth', 'Keep this instruction'],
                placement_contract: { poll: { supported: true, configuration_mode: 'native_manual', render_in_asset: false } }
            }
        },
        metrics: { account_ref: 'analystcraft_growth', task_id: 'story-853' },
        channel: { id: 108, name: 'spherical_analyst_tg', type: 'telegram' },
        placement: 'story'
    });

    assert.equal(result.assets.account_ref, 'spherical_analyst_tg');
    assert.equal(result.assets.action.account_ref, 'spherical_analyst_tg');
    assert.equal(result.assets.action.channel, 'telegram');
    assert.equal(result.assets.action.action_type, 'telegram_story:publish');
    assert.equal(result.qualityReport.handoff_bundle.account.ref, 'spherical_analyst_tg');
    assert.equal(result.qualityReport.handoff_bundle.account.details.platform, 'telegram');
    assert.equal(result.qualityReport.handoff_bundle.task.channel, 'telegram');
    assert.equal(result.qualityReport.handoff_bundle.task.action_type, 'telegram_story:publish');
    assert.deepEqual(result.qualityReport.handoff_bundle.manual_checklist, [
        'Post from account: spherical_analyst_tg',
        'Keep this instruction'
    ]);
    assert.equal(result.qualityReport.handoff_bundle.placement_contract.poll.configuration_mode, 'native_manual');
    assert.equal(result.metrics.account_ref, 'spherical_analyst_tg');
});

test('owner-only projection recovery is guarded, audited and does not mutate content or visual records', () => {
    const queueService = readFileSync(resolve(process.cwd(), 'src/services/work_queue.service.ts'), 'utf8');
    const mcpServer = readFileSync(resolve(process.cwd(), 'src/mcp/shared.ts'), 'utf8');
    const repairMethod = queueService.slice(
        queueService.indexOf('async repairPublicationProjection'),
        queueService.indexOf('async recoverMissingContentReview')
    );

    assert.ok(repairMethod.length > 0);
    assert.match(repairMethod, /requireProjectOwner\(tx, params\.projectId, params\.actorId\)/);
    assert.match(repairMethod, /command = 'ba_repair_publication_projection'/);
    assert.match(repairMethod, /content_revision: params\.expectedContentRevision/);
    assert.match(repairMethod, /selected_asset_id: params\.expectedSelectedAssetId/);
    assert.match(repairMethod, /assets: projection\.assets/);
    assert.doesNotMatch(repairMethod, /content_revision:\s*\{\s*increment/);
    assert.doesNotMatch(repairMethod, /selected_asset:\s*\{/);
    assert.match(mcpServer, /registerTool\('ba_repair_publication_projection'/);
});

test('non-story projection repair preserves its established action type', () => {
    const result = repairMaterializedPublicationProjection({
        assets: { action: { action_type: 'manual_handoff' } },
        qualityReport: {},
        metrics: {},
        channel: { id: 113, name: 'analystcraft_habr', type: 'habr' },
        placement: 'article_cover'
    });

    assert.equal(result.assets.action.action_type, 'manual_handoff');
});
