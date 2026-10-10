import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtDirectionService } from '../services/art_direction.service';
import {
    assertPublicationTextWithinLimit,
    measureXWeightedLength,
    resolvePublicationTextLimit
} from '../services/publication_text_limit';

test('ordinary X uses the provider-safe 280 weighted-character limit', () => {
    assert.equal(resolvePublicationTextLimit('x', {}), 280);
    assert.equal(measureXWeightedLength('a'.repeat(280)), 280);
    assert.doesNotThrow(() => assertPublicationTextWithinLimit('x', 'a'.repeat(280), {}));
    assert.throws(() => assertPublicationTextWithinLimit('x', 'a'.repeat(281), {}),
        /X_TEXT_LIMIT_EXCEEDED.*281.*280/);
});

test('X weighted length treats URLs as t.co length and non-Latin symbols conservatively', () => {
    assert.equal(measureXWeightedLength('See https://example.com/a/very/long/path'), 27);
    assert.equal(measureXWeightedLength('🙂'), 2);
});

test('content acceptance cannot mark an overlength ordinary X revision ready', async () => {
    let writes = 0;
    const tx = {
        contentItem: {
            findUnique: async () => ({ id: 1042, project_id: 10, status: 'drafted', draft_text: 'x'.repeat(365),
                content_revision: 6, visual_placement: 'feed', visual_mode: 'auto_assess',
                channel: { type: 'x', config: {} } }),
            update: async () => { writes += 1; }
        },
        projectSettings: { findUnique: async () => ({ value: 'true' }) }
    };
    const service = new ArtDirectionService();
    await assert.rejects(service.acceptContentRevision(tx as never, 1042, 'user:2'),
        /X_TEXT_LIMIT_EXCEEDED.*365.*280/);
    assert.equal(writes, 0);
});
