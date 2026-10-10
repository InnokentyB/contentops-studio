import test from 'node:test';
import assert from 'node:assert/strict';
import { publicDzenArticleTitle } from '../services/dzen_public_title';
test('1031 uses its accepted first-line headline for provider payload and history readback', () => {
    assert.equal(publicDzenArticleTitle(1031, 'Как проверить новый формат урока без маркетинговой самооценки\n\nBody', 'W41 allocation #6 — Dzen'),
        'Как проверить новый формат урока без маркетинговой самооценки');
    assert.equal(publicDzenArticleTitle(992, 'body', 'Accepted title'), 'Accepted title');
});

test('1045 uses its accepted first-line headline instead of the operational slot label', () => {
    assert.equal(publicDzenArticleTitle(1045,
        '46 тестов зелёные. Почему я всё равно не называю AI-продукт запущенным\n\nBody',
        'W41 allocation #24 — Dzen'),
    '46 тестов зелёные. Почему я всё равно не называю AI-продукт запущенным');
    assert.throws(() => publicDzenArticleTitle(1045, 'Changed headline\n\nBody',
        'W41 allocation #24 — Dzen'), /DZEN_PUBLIC_TITLE_CHANGED/);
});
