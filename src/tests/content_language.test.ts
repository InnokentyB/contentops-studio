import test from 'node:test';
import assert from 'node:assert/strict';
import {
    channelContentLanguage,
    contentLanguageInstruction,
    normalizeContentLanguage,
    publicationContentLanguage
} from '../services/content_language.service';

test('content language defaults legacy channels to Russian', () => {
    assert.equal(normalizeContentLanguage(undefined), 'ru');
    assert.equal(channelContentLanguage({ config: {} }), 'ru');
    assert.equal(channelContentLanguage({ config: { content_language: 'de' } }), 'ru');
});

test('content language recognizes English channel configuration', () => {
    assert.equal(channelContentLanguage({ config: { content_language: 'en' } }), 'en');
    assert.match(contentLanguageInstruction('en'), /English/);
});

test('publication handoff honors explicit task language before the channel default', () => {
    assert.equal(publicationContentLanguage({ config: {} }, { content_language: 'en' }), 'en');
    assert.equal(publicationContentLanguage({ config: { content_language: 'en' } }, { content_language: 'ru' }), 'ru');
    assert.equal(publicationContentLanguage({ config: { content_language: 'en' } }, { content_language: 'de' }), 'en');
});
