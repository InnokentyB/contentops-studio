import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertCanonicalPublicationPlacement,
    canonicalPlacementsForChannel,
    publicationPlacementAssetContract
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

test('Telegram and VK stories use channel-specific poll capabilities', () => {
    for (const type of ['telegram', 'telegram_chat']) {
        assert.ok(canonicalPlacementsForChannel({ type }).includes('story'));
        const contract = publicationPlacementAssetContract({ type }, 'story');
        assert.deepEqual(contract.dimensions, { width: 1080, height: 1920, aspect_ratio: '9:16' });
        assert.deepEqual(contract.safe_area, { unit: 'px', top: 250, right: 80, bottom: 320, left: 80 });
        assert.deepEqual(contract.poll, { supported: false, configuration_mode: 'not_supported', render_in_asset: false });
        assert.deepEqual(contract.transport, { materialization: 'story', connector_authority: 'manual_only' });
    }

    const vkContract = publicationPlacementAssetContract({ type: 'vk' }, 'story');
    assert.deepEqual(vkContract.poll, { supported: true, configuration_mode: 'native_configured', render_in_asset: false });
    assert.deepEqual(vkContract.transport, { materialization: 'story', connector_authority: 'configured' });
});

test('VK longread uses a distinct manual article-cover contract', () => {
    assert.ok(canonicalPlacementsForChannel({ type: 'vk' }).includes('article_cover'));
    assert.equal(assertCanonicalPublicationPlacement({ type: 'vk' }, 'article_cover'), 'article_cover');
    const contract = publicationPlacementAssetContract({ type: 'vk' }, 'article_cover');
    assert.equal(contract.artifact_kind, 'article_cover');
    assert.deepEqual(contract.dimensions, { width: 1200, height: 675, aspect_ratio: '16:9' });
    assert.deepEqual(contract.safe_area, { unit: 'px', top: 72, right: 96, bottom: 72, left: 96 });
    assert.deepEqual(contract.transport, { materialization: 'article', connector_authority: 'manual_only' });
});

test('Dzen longread uses the configured article transport contract', () => {
    const contract = publicationPlacementAssetContract({ type: 'dzen' }, 'article_cover');
    assert.equal(contract.artifact_kind, 'article_cover');
    assert.deepEqual(contract.transport, { materialization: 'article', connector_authority: 'configured' });
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

test('asset contract can describe legacy placement metadata without weakening repair validation', () => {
    const legacy = publicationPlacementAssetContract({ type: 'dzen' }, 'feed');
    assert.equal(legacy.artifact_kind, 'feed');
    assert.throws(
        () => assertCanonicalPublicationPlacement({ type: 'dzen' }, 'feed'),
        /TARGET_PLACEMENT_MISMATCH/
    );
});
