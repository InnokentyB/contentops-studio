import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import okService from '../services/ok.service';
import habrService from '../services/habr.service';
import vcService from '../services/vc.service';
import dzenService, { isDzenPublishedUrl } from '../services/dzen.service';
import {
    classifyDzenStudioLocation,
    parseBrowserCookieHeader,
    DZEN_EDITOR_SELECTORS,
    findDzenPostBody,
    typeDzenContentEditableText
} from '../services/puppeteer_publisher.service';

test('Dzen cookie parser accepts a copied Cookie request header', () => {
    assert.deepEqual(
        parseBrowserCookieHeader('Cookie: Session_id=abc123; yandexuid=xyz', '.yandex.ru'),
        [
            { name: 'Session_id', value: 'abc123', domain: '.yandex.ru', path: '/', secure: true },
            { name: 'yandexuid', value: 'xyz', domain: '.yandex.ru', path: '/', secure: true }
        ]
    );
});

test('Dzen cookie parser reports malformed copied fields before CDP', () => {
    assert.throws(
        () => parseBrowserCookieHeader('Cookie: valid=one; bad name=two', 'dzen.ru'),
        /Invalid cookie name "bad name"/
    );
});
import puppeteerPublisherService from '../services/puppeteer_publisher.service';
import publicationAdapterService from '../services/publication_adapter.service';

test('Medium manual handoff includes featured-image and focal-point checks', () => {
    const checklist = publicationAdapterService.buildManualChecklist({
        channel: 'medium',
        parameters: {}
    } as any, { accountRef: 'innokenty_medium' });

    assert.ok(checklist.includes('Upload the approved image into the Medium article before opening the publish menu.'));
    assert.ok(checklist.includes('Set the uploaded image as the featured image and keep its focal point inside the approved safe area.'));
});

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
    assert.equal(capturedHeaders['User-Agent'], 'contentops-studio-app/1.0.0 (Desktop; macOS/15.0; ru; 1920x1080)');
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

test('Dzen connection checks the current channel publications workspace', () => {
    const publisher = puppeteerPublisherService as any;
    assert.equal(
        publisher.dzenChannelEditorUrl({ cookies: 'x=1', channel_id: '6a8029aba055ec36033bf81c' }),
        'https://dzen.ru/profile/editor/id/6a8029aba055ec36033bf81c/publications'
    );
    assert.equal(
        publisher.dzenChannelEditorUrl({ cookies: 'x=1', channel_url: 'https://dzen.ru/id/6a8029aba055ec36033bf81c' }),
        'https://dzen.ru/profile/editor/id/6a8029aba055ec36033bf81c/publications'
    );
});

test('Dzen connection distinguishes Studio from an expired-session public redirect', () => {
    assert.equal(
        classifyDzenStudioLocation('https://dzen.ru/profile/editor/id/channel-1/publications'),
        'studio'
    );
    assert.equal(classifyDzenStudioLocation('https://dzen.ru/id/channel-1'), 'public_channel');
    assert.equal(
        classifyDzenStudioLocation('https://passport.yandex.ru/auth?retpath=https%3A%2F%2Fdzen.ru'),
        'authentication'
    );
});

test('Dzen editor automation uses the current studio entrypoint and semantic Draft.js fields', () => {
    assert.equal(DZEN_EDITOR_SELECTORS.addPublication, '[data-testid="add-publication-button"]');
    assert.match(DZEN_EDITOR_SELECTORS.articleMenuItem, /Написать статью/);
    assert.equal(DZEN_EDITOR_SELECTORS.postBody, '[contenteditable="true"][role="textbox"]');
    assert.match(DZEN_EDITOR_SELECTORS.articleTitle, /role="textbox".*:has\(h1/);
    assert.match(DZEN_EDITOR_SELECTORS.articleBody, /role="textbox".*zen-editor-block/);
    assert.equal(DZEN_EDITOR_SELECTORS.imageInsertIconFragment, 'add_gallery');
    assert.match(DZEN_EDITOR_SELECTORS.helpClose, /help-popup/);
    assert.equal(DZEN_EDITOR_SELECTORS.articlePublish, '[data-testid="article-publish-btn"]');
    assert.equal(DZEN_EDITOR_SELECTORS.publicationConfirm, '[data-testid="publish-btn"]');
});

test('Dzen adaptive post-body finder supports current textarea modal and legacy editable DOM', async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    try {
        await page.setContent(`
            <div class="composer-overlay" style="position:fixed;inset:0">
                <h2>Что нового?</h2>
                <textarea placeholder="Расскажите читателям"></textarea>
                <button>Опубликовать</button>
            </div>
            <textarea placeholder="Поиск" style="width:100px;height:20px"></textarea>
        `);
        const current = await findDzenPostBody(page);
        assert.equal(await current.evaluate((element) => element.tagName.toLowerCase()), 'textarea');
        await current.dispose();

        await page.setContent(`
            <div role="dialog" aria-modal="true" style="width:600px;height:400px">
                <h2>Что нового?</h2>
                <div contenteditable="true" role="textbox" style="width:500px;height:200px"></div>
                <button>Опубликовать</button>
            </div>
        `);
        const legacy = await findDzenPostBody(page);
        assert.equal(await legacy.evaluate((element) => element.getAttribute('role')), 'textbox');
        await legacy.dispose();

        await page.setContent(`
            <div class="opaque-generated-scope" style="width:600px;height:400px">
                <span>Что нового?</span>
                <div contenteditable="true" data-testid="outer-editor" style="width:500px;height:220px">
                    <div contenteditable="true" data-testid="inner-editor" style="width:480px;height:180px"></div>
                </div>
                <button disabled>Идёт сохранение</button>
            </div>
            <div contenteditable="true" data-testid="unrelated-editor" style="width:200px;height:80px"></div>
        `);
        const nested = await findDzenPostBody(page);
        assert.equal(await nested.evaluate((element) => element.getAttribute('data-testid')), 'inner-editor');
        await nested.dispose();

        await page.setContent(`
            <div style="width:600px;height:400px">
                <span>Что нового?</span>
                <div contenteditable="true" data-testid="zero-outer">
                    <div contenteditable="true" data-testid="zero-inner"></div>
                </div>
                <button disabled>Идёт сохранение</button>
            </div>
        `);
        const zeroGeometry = await findDzenPostBody(page);
        assert.equal(await zeroGeometry.evaluate((element) => element.getAttribute('data-testid')), 'zero-inner');
        await zeroGeometry.dispose();
    } finally {
        await browser.close();
    }
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

test('standard Telegram channels prefer MTProto while explicit manual workflows stay manual', () => {
    assert.equal(publicationAdapterService.prefersAutomaticExecution({
        platform: 'telegram',
        workflow_mode: 'standard'
    }), true);
    assert.equal(publicationAdapterService.prefersAutomaticExecution({
        platform: 'telegram',
        workflow_mode: 'approval_required'
    }), false);
    assert.equal(publicationAdapterService.prefersAutomaticExecution({
        platform: 'telegram',
        workflow_mode: 'manual_handoff'
    }), false);
});
