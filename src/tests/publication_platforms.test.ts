import test from 'node:test';
import assert from 'node:assert/strict';
import okService from '../services/ok.service';
import habrService from '../services/habr.service';
import vcService from '../services/vc.service';
import dzenService from '../services/dzen.service';
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

test('VCService runs publish and returns mock post URL', async () => {
    const config = {
        access_token: 'vc_token',
        subsite_id: '123'
    };

    const mockUrl = await vcService.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');
    
    assert.ok(mockUrl);
    assert.ok(mockUrl.startsWith('https://vc.ru/mock-'));
});

test('DzenService publishes and returns mock URL', async () => {
    const config = {
        channel_id: 'dzen_channel_123'
    };

    const mockUrl = await dzenService.publishPost(config, 'Тестовый текст Дзен', undefined, 'Дзен статья');

    assert.ok(mockUrl);
    assert.ok(mockUrl.startsWith('https://dzen.ru/media/mock-'));
});

test('publicationAdapterService recognizes new platforms as direct-execution friendly', () => {
    const okAccount = { platform: 'ok' };
    const habrAccount = { platform: 'habr_article' };
    const vcAccount = { platform: 'vc_article' };
    const dzenAccount = { platform: 'dzen' };

    assert.equal(publicationAdapterService.supportsDirectExecution(okAccount), true);
    assert.equal(publicationAdapterService.supportsDirectExecution(habrAccount), true);
    assert.equal(publicationAdapterService.supportsDirectExecution(vcAccount), true);
    assert.equal(publicationAdapterService.supportsDirectExecution(dzenAccount), true);
});
