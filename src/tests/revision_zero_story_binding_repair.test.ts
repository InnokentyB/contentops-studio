import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('revision-zero story repair is owner-only, atomic, audited and narrowly guarded', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/services/work_queue.service.ts'), 'utf8');
    const method = source.slice(
        source.indexOf('async repairRevisionZeroStoryBinding'),
        source.indexOf('async repairPublicationPlacement')
    );

    assert.ok(method.length > 0);
    assert.match(method, /requireProjectOwner\(tx, params\.projectId, params\.actorId\)/);
    assert.match(method, /command = 'ba_repair_revision_zero_story_binding'/);
    assert.match(method, /content\.content_revision !== 0/);
    assert.match(method, /content\.accepted_revision !== null/);
    assert.match(method, /content\.draft_text !== null/);
    assert.match(method, /content\.publication_fact/);
    assert.match(method, /content\.visual_placement !== null/);
    assert.match(method, /blockedItem\.reason_code !== 'invalid_story_binding'/);
    assert.match(method, /visual_placement: 'story'/);
    assert.match(method, /state: 'available'/);
    assert.match(method, /repairMaterializedPublicationProjection/);
    assert.match(method, /recordWorkflowEvent/);
    assert.doesNotMatch(method, /draft_text:\s*['"`]/);
    assert.doesNotMatch(method, /published_link:\s*['"`]/);
});

test('static-story guard rejects CTA, poll, sticker and native interaction metadata', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/services/work_queue.service.ts'), 'utf8');
    const method = source.slice(
        source.indexOf('async repairRevisionZeroStoryBinding'),
        source.indexOf('async repairPublicationPlacement')
    );

    assert.match(method, /content\.cta !== null/);
    assert.match(method, /action\.poll != null/);
    assert.match(method, /action\.sticker != null/);
    assert.match(method, /action\.native_interaction != null/);
    assert.match(method, /publication\.native_poll != null/);
    assert.match(method, /\[STATIC_STORY_CONFLICT\]/);
});
