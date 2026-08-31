import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertCanonicalPublicationPlacement,
    canonicalPlacementsForChannel
} from '../services/publication_placement_contract';

test('article channels share the canonical article-cover placement', () => {
    for (const type of ['habr', 'vc', 'dzen', 'site']) {
        assert.deepEqual(canonicalPlacementsForChannel({ type }), ['article_cover']);
        assert.equal(assertCanonicalPublicationPlacement({ type }, 'article_cover'), 'article_cover');
    }
    assert.throws(
        () => assertCanonicalPublicationPlacement({ type: 'vc' }, 'feed'),
        /TARGET_PLACEMENT_MISMATCH/
    );
});

test('configured channel placement overrides the type fallback', () => {
    const channel = { type: 'custom', config: { canonical_placements: ['article_cover', 'inline'] } };
    assert.deepEqual(canonicalPlacementsForChannel(channel), ['article_cover', 'inline']);
    assert.equal(assertCanonicalPublicationPlacement(channel, 'inline'), 'inline');
});

test('unknown channels cannot be repaired without an explicit contract', () => {
    assert.throws(
        () => assertCanonicalPublicationPlacement({ type: 'custom' }, 'feed'),
        /CHANNEL_PLACEMENT_CONTRACT_MISSING/
    );
});
