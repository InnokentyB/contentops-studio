import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPublicationTaskActive } from '../services/publication_task_activity';

test('skipped is a terminal non-active publication status', () => {
    assert.equal(isPublicationTaskActive({ status: 'skipped' }), false);
});

test('superseded repair is owner-only, guarded, atomic and changes only task status', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/services/work_queue.service.ts'), 'utf8');
    const method = source.slice(
        source.indexOf('async repairSupersededPublicationTasks'),
        source.indexOf('async repairRevisionZeroStoryBinding')
    );
    assert.ok(method.length > 0);
    assert.match(method, /return prisma\.\$transaction/);
    assert.match(method, /requireProjectOwner\(tx, params\.projectId, params\.actorId\)/);
    assert.match(method, /command = 'ba_repair_superseded_publication_tasks'/);
    assert.match(method, /task\.publication_fact \|\| task\.published_link/);
    assert.match(method, /task\.accepted_revision !== null/);
    assert.match(method, /action\.status !== 'skipped'/);
    assert.match(method, /skipReason\.includes\(`#\$\{replacement\.id\}`\)/);
    assert.match(method, /replacement\.status !== 'ready_for_execution'/);
    assert.match(method, /replacement\.accepted_revision !== replacement\.content_revision/);
    assert.match(method, /data: \{ status: 'skipped' \}/);
    assert.match(method, /body_preserved: true/);
    assert.match(method, /publication_fact_created: false/);
    assert.doesNotMatch(method, /data: \{[^}]*draft_text:/s);
    assert.doesNotMatch(method, /data: \{[^}]*cta:/s);
    assert.doesNotMatch(method, /publicationFact\.(create|upsert)/);
});
