import test from 'node:test';
import assert from 'node:assert/strict';
import { publicDzenArticleTitle } from '../services/dzen_public_title';
test('1031 uses its accepted first-line headline for provider payload and history readback', () => {
    assert.equal(publicDzenArticleTitle(1031, 'Как проверить новый формат урока без маркетинговой самооценки\n\nBody', 'W41 allocation #6 — Dzen'),
        'Как проверить новый формат урока без маркетинговой самооценки');
    assert.equal(publicDzenArticleTitle(992, 'body', 'Accepted title'), 'Accepted title');
});
