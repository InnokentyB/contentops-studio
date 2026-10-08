import test from 'node:test';
import assert from 'node:assert/strict';
import { publicDzenArticleTitle } from '../services/dzen_public_title';

const headline = '65% решений автоматизировано. Почему этого мало для оценки системы';

test('Dzen1036 sends its accepted headline, never the operational slot title', () => {
    assert.equal(publicDzenArticleTitle(1036, `${headline}\n\nAccepted body`, 'W41 allocation #16 — Dzen'), headline);
    assert.throws(() => publicDzenArticleTitle(1036, 'Changed headline\n\nBody', 'W41 allocation #16 — Dzen'), /DZEN_PUBLIC_TITLE_CHANGED/);
});
