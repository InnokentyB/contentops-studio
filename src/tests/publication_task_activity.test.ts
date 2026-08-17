import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicationTaskActive } from '../services/publication_task_activity';

test('active queue excludes published workflow tasks', () => {
    assert.equal(isPublicationTaskActive({ status: 'published' }), false);
});

test('active queue excludes terminal negative publication outcomes', () => {
    assert.equal(isPublicationTaskActive({ status: 'failed', publication_fact: { outcome: 'removed' } }), false);
    assert.equal(isPublicationTaskActive({ status: 'planned', quality_report: { publication_outcome: 'blocked' } }), false);
});

test('active queue includes unfinished tasks without terminal outcome', () => {
    assert.equal(isPublicationTaskActive({ status: 'awaiting_manual_publication' }), true);
});
