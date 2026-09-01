import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('ongoing rule polling does not load publication asset snapshots', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/publisher.service.ts'), 'utf8');
    const method = source.slice(
        source.indexOf('async processPublicationOngoingRules()'),
        source.indexOf('private async executeMeasurementSnapshot')
    );

    assert.match(method, /loadOngoingRulePlans/);
    assert.doesNotMatch(method, /loadPublicationPlanContext/);
    assert.doesNotMatch(method, /publication_plan_asset_snapshots/);
    assert.doesNotMatch(method, /publication_plan_content_file_snapshots/);
});

test('ongoing rule configuration uses a bounded in-memory cache and batched settings query', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/publisher.service.ts'), 'utf8');
    const loader = source.slice(
        source.indexOf('private ongoingRulePlanCache'),
        source.indexOf('async closeConnections()')
    );

    assert.match(loader, /PUBLICATION_RULES_CACHE_TTL_MS \|\| 300000/);
    assert.match(loader, /expiresAt > now/);
    assert.match(loader, /project_id: \{ in: projectIds \}/);
    assert.match(loader, /publication_plan_meta/);
    assert.match(loader, /publication_plan_measurement/);
    assert.doesNotMatch(loader, /publication_plan_asset_snapshots/);
    assert.doesNotMatch(loader, /publication_plan_content_file_snapshots/);
});
