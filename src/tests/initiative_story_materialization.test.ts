import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationTaskSubtypeProjection } from '../services/initiative.service';

test('telegram_story initiative materializes a Telegram Story task instead of feed defaults', () => {
    assert.deepEqual(publicationTaskSubtypeProjection('telegram_story'), {
        type: 'telegram_story', visual_placement: 'story'
    });
    assert.deepEqual(publicationTaskSubtypeProjection('publication_theme'), {});
});
