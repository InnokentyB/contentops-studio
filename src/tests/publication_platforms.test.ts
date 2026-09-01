import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import okService from '../services/ok.service';
import habrService from '../services/habr.service';
import vcService from '../services/vc.service';
import dzenService, { isDzenPublishedUrl } from '../services/dzen.service';
import {
    DZEN_EDITOR_SELECTORS,
    typeDzenContentEditableText
} from '../services/puppeteer_publisher.service';
import puppeteerPublisherService from '../services/puppeteer_publisher.service';
import publicationAdapterService from '../services/publication_adapter.service';

test('Odnoklassniki signature helper handles request parameters correctly', () => {
    // Access private calculateSig via bracket syntax
    const serviceInstance = okService as unknown as {
        calculateSig(params: Record<string, string>, accessToken: string, appSecret: string): string;
    };

    const params: Record<string, string> = {
        application_key: 'CBA12345',
        method: 'mediatopic.post',
        gid: '987654'
    };
    const accessToken = 'token_abc';
    const appSecret = 'secret_xyz';

    // Calculate signature using okService
    const sig = serviceInstance.calculateSig(params, accessToken, appSecret);

    assert.ok(sig);
    assert.equal(sig.length, 32); // MD5 is 32 characters hex
    // Ensure lowercase format
    assert.equal(sig, sig.toLowerCase());
});

test('HabrService logs locally and returns mock post URL', async () => {
    const config = {
        api_token: 'habr_api_key',
        hub_ids: ['dev', 'pm']
    };

    const mockUrl = await habrService.publishPost(config, 'Тестовый текст хабр', undefined, 'Тестовая статья');
    
    assert.ok(mockUrl);
    assert.ok(mockUrl.startsWith('https://habr.com/ru/post/mock-'));
});

test('VCService returns mock URL when credentials are not provided', async () => {
    const config = {};
    const mockUrl = await vcService.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');
    
    assert.ok(mockUrl);
    assert.ok(mockUrl.startsWith('https://vc.ru/mock-'));
});

test('VCService successfully publishes to Osnova API and validates User-Agent', async (t: TestContext) => {
    let capturedUrl: string | URL = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: string = '';

    t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = (init?.headers || {}) as Record<string, string>;
        capturedBody = String(init?.body || '');
        return {
            ok: true,
            json: async () => ({
                result: {
                    id: 99999,
                    url: 'https://vc.ru/published-real-123'
                }
            })
        } as Response;
    });

    const config = {
        access_token: 'valid_vc_token',
        subsite_id: 'sub_123'
    };

    const publishedUrl = await vcService.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');

    assert.equal(publishedUrl, 'https://vc.ru/published-real-123');
    assert.equal(capturedUrl, 'https://api.vc.ru/v1.9/entry/create');
    assert.equal(capturedHeaders['X-Device-Token'], 'valid_vc_token');
    assert.equal(capturedHeaders['User-Agent'], 'ba-post-planner-app/1.0.0 (Desktop; macOS/15.0; ru; 1920x1080)');
    assert.ok(capturedBody.includes('title=%D0%A2%D0%B5%D1%81%D1%82%D0%BE%D0%B2%D0%B0%D1%8F+%D1%81%D1%82%D0%B0%D1%82%D1%8C%D1%8F+VC'));
});

test('VCService throws error when Osnova API request fails', async (t: TestContext) => {
    t.mock.method(globalThis, 'fetch', async () => {
        return {
            ok: false,
            status: 400,
            text: async () => 'Bad Request'
        } as Response;
    });

    const config = {
        access_token: 'invalid_vc_token',
        subsite_id: 'sub_123'
    };

    await assert.rejects(
        async () => {
            await vcService.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');
        },
        /Osnova API request failed with status 400: Bad Request/
    );
});

test('DzenService refuses to publish without an authenticated browser session', async () => {
    const config = {
        channel_id: 'dzen_channel_123'
    };

    await assert.rejects(
        () => dzenService.publishPost(config, 'Тестовый текст Дзен', undefined, 'Дзен статья'),
        /authenticated Dzen session/i
    );
});

test('Dzen permalink validation rejects editor and fabricated URLs', () => {
    assert.equal(isDzenPublishedUrl('https://dzen.ru/studio/editor/create/article'), false);
    assert.equal(isDzenPublishedUrl('https://dzen.ru/media/mock-123'), false);
    assert.equal(isDzenPublishedUrl('https://example.com/a/real-looking-id'), false);
    assert.equal(isDzenPublishedUrl('https://dzen.ru/a/ZkExampleSlug'), true);
    assert.equal(isDzenPublishedUrl('https://dzen.ru/media/id/123456/example'), true);
});

test('Dzen connection supports current channel editor identifiers', () => {
    const publisher = puppeteerPublisherService as any;
    assert.equal(
        publisher.dzenChannelEditorUrl({ cookies: 'x=1', channel_id: '6a8029aba055ec36033bf81c' }),
        'https://dzen.ru/profile/editor/id/6a8029aba055ec36033bf81c'
    );
    assert.equal(
        publisher.dzenChannelEditorUrl({ cookies: 'x=1', channel_url: 'https://dzen.ru/id/6a8029aba055ec36033bf81c' }),
        'https://dzen.ru/profile/editor/id/6a8029aba055ec36033bf81c'
    );
});

test('Dzen editor automation uses the current studio entrypoint and semantic Draft.js fields', () => {
    assert.equal(DZEN_EDITOR_SELECTORS.addPublication, '[data-testid="add-publication-button"]');
    assert.match(DZEN_EDITOR_SELECTORS.articleMenuItem, /Написать статью/);
    assert.match(DZEN_EDITOR_SELECTORS.articleTitle, /role="textbox".*:has\(h1/);
    assert.match(DZEN_EDITOR_SELECTORS.articleBody, /role="textbox".*zen-editor-block/);
    assert.equal(DZEN_EDITOR_SELECTORS.imageInsertIconFragment, 'add_gallery');
    assert.match(DZEN_EDITOR_SELECTORS.helpClose, /help-popup/);
    assert.equal(DZEN_EDITOR_SELECTORS.articlePublish, '[data-testid="article-publish-btn"]');
});

test('Dzen Draft.js input uses native element typing without document selection', async () => {
    const calls: any[] = [];
    const element = {
        focus: async () => calls.push(['focus']),
        type: async (...args: any[]) => calls.push(['type', ...args])
    };

    await typeDzenContentEditableText(element, 'Scoped text');
    assert.deepEqual(calls, [
        ['focus'],
        ['type', 'Scoped text', { delay: 1 }]
    ]);
    assert.equal(calls.some((call) => call.includes('execCommand') || call.includes('selectAll')), false);
});

test('publicationAdapterService recognizes new platforms as direct-execution friendly', () => {
    const okAccount = { platform: 'ok' };
    const habrAccount = { platform: 'habr_article' };
    const vcAccount = { platform: 'vc_article' };
    const dzenAccount = { platform: 'dzen', cookies_encrypted: 'enc:v1:test' };
    const unconfiguredDzenAccount = { platform: 'dzen' };

    assert.equal(publicationAdapterService.supportsDirectExecution(okAccount), true);
    assert.equal(publicationAdapterService.supportsDirectExecution(habrAccount), true);
    assert.equal(publicationAdapterService.supportsDirectExecution(vcAccount), true);
    assert.equal(publicationAdapterService.supportsDirectExecution(dzenAccount), true);
    assert.equal(publicationAdapterService.supportsDirectExecution(unconfiguredDzenAccount), false);
});

test('VK direct execution is available only with a provider target and publish credential', () => {
    assert.equal(publicationAdapterService.supportsDirectExecution({ platform: 'vk' }), false);
    assert.equal(publicationAdapterService.supportsDirectExecution({ platform: 'vk', vk_id: '-123' }), false);
    assert.equal(publicationAdapterService.supportsDirectExecution({
        platform: 'vk',
        vk_id: '-123',
        publish_access_token: 'token'
    }), true);
});

test('configured Dzen channels prefer connector auto when workflow mode is not explicitly overridden', () => {
    assert.equal(publicationAdapterService.prefersAutomaticExecution({ platform: 'dzen', cookies_encrypted: 'enc:v1:test' }), true);
    assert.equal(publicationAdapterService.prefersAutomaticExecution({ platform: 'dzen', cookies_encrypted: 'enc:v1:test', workflow_mode: 'approval_required' }), false);
    assert.equal(publicationAdapterService.prefersAutomaticExecution({ platform: 'dzen' }), false);
});
