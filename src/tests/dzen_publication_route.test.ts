import assert from 'node:assert/strict';
import test from 'node:test';
import { dzenPublicationTypeForAction } from '../services/dzen_publication_route';

test('Dzen feed action selects native post even when account defaults to article', () => {
    assert.equal(dzenPublicationTypeForAction('dzen_feed:publish', 'dzen', 'article'), 'post');
    assert.equal(dzenPublicationTypeForAction('dzen_post:publish', 'dzen'), 'post');
});

test('Dzen article action and article channel retain longread route', () => {
    assert.equal(dzenPublicationTypeForAction('dzen_article_cover:publish', 'dzen', 'post'), 'article');
    assert.equal(dzenPublicationTypeForAction('unknown', 'zen_article', 'post'), 'article');
});
