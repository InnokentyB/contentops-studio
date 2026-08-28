"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const ok_service_1 = __importDefault(require("../services/ok.service"));
const habr_service_1 = __importDefault(require("../services/habr.service"));
const vc_service_1 = __importDefault(require("../services/vc.service"));
const dzen_service_1 = __importStar(require("../services/dzen.service"));
const publication_adapter_service_1 = __importDefault(require("../services/publication_adapter.service"));
(0, node_test_1.default)('Odnoklassniki signature helper handles request parameters correctly', () => {
    // Access private calculateSig via bracket syntax
    const serviceInstance = ok_service_1.default;
    const params = {
        application_key: 'CBA12345',
        method: 'mediatopic.post',
        gid: '987654'
    };
    const accessToken = 'token_abc';
    const appSecret = 'secret_xyz';
    // Calculate signature using okService
    const sig = serviceInstance.calculateSig(params, accessToken, appSecret);
    strict_1.default.ok(sig);
    strict_1.default.equal(sig.length, 32); // MD5 is 32 characters hex
    // Ensure lowercase format
    strict_1.default.equal(sig, sig.toLowerCase());
});
(0, node_test_1.default)('HabrService logs locally and returns mock post URL', async () => {
    const config = {
        api_token: 'habr_api_key',
        hub_ids: ['dev', 'pm']
    };
    const mockUrl = await habr_service_1.default.publishPost(config, 'Тестовый текст хабр', undefined, 'Тестовая статья');
    strict_1.default.ok(mockUrl);
    strict_1.default.ok(mockUrl.startsWith('https://habr.com/ru/post/mock-'));
});
(0, node_test_1.default)('VCService returns mock URL when credentials are not provided', async () => {
    const config = {};
    const mockUrl = await vc_service_1.default.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');
    strict_1.default.ok(mockUrl);
    strict_1.default.ok(mockUrl.startsWith('https://vc.ru/mock-'));
});
(0, node_test_1.default)('VCService successfully publishes to Osnova API and validates User-Agent', async (t) => {
    let capturedUrl = '';
    let capturedHeaders = {};
    let capturedBody = '';
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        capturedUrl = url;
        capturedHeaders = (init?.headers || {});
        capturedBody = String(init?.body || '');
        return {
            ok: true,
            json: async () => ({
                result: {
                    id: 99999,
                    url: 'https://vc.ru/published-real-123'
                }
            })
        };
    });
    const config = {
        access_token: 'valid_vc_token',
        subsite_id: 'sub_123'
    };
    const publishedUrl = await vc_service_1.default.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');
    strict_1.default.equal(publishedUrl, 'https://vc.ru/published-real-123');
    strict_1.default.equal(capturedUrl, 'https://api.vc.ru/v1.9/entry/create');
    strict_1.default.equal(capturedHeaders['X-Device-Token'], 'valid_vc_token');
    strict_1.default.equal(capturedHeaders['User-Agent'], 'ba-post-planner-app/1.0.0 (Desktop; macOS/15.0; ru; 1920x1080)');
    strict_1.default.ok(capturedBody.includes('title=%D0%A2%D0%B5%D1%81%D1%82%D0%BE%D0%B2%D0%B0%D1%8F+%D1%81%D1%82%D0%B0%D1%82%D1%8C%D1%8F+VC'));
});
(0, node_test_1.default)('VCService throws error when Osnova API request fails', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
        return {
            ok: false,
            status: 400,
            text: async () => 'Bad Request'
        };
    });
    const config = {
        access_token: 'invalid_vc_token',
        subsite_id: 'sub_123'
    };
    await strict_1.default.rejects(async () => {
        await vc_service_1.default.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');
    }, /Osnova API request failed with status 400: Bad Request/);
});
(0, node_test_1.default)('DzenService refuses to publish without an authenticated browser session', async () => {
    const config = {
        channel_id: 'dzen_channel_123'
    };
    await strict_1.default.rejects(() => dzen_service_1.default.publishPost(config, 'Тестовый текст Дзен', undefined, 'Дзен статья'), /authenticated Dzen session/i);
});
(0, node_test_1.default)('Dzen permalink validation rejects editor and fabricated URLs', () => {
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://dzen.ru/studio/editor/create/article'), false);
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://dzen.ru/media/mock-123'), false);
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://example.com/a/real-looking-id'), false);
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://dzen.ru/a/ZkExampleSlug'), true);
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://dzen.ru/media/id/123456/example'), true);
});
(0, node_test_1.default)('publicationAdapterService recognizes new platforms as direct-execution friendly', () => {
    const okAccount = { platform: 'ok' };
    const habrAccount = { platform: 'habr_article' };
    const vcAccount = { platform: 'vc_article' };
    const dzenAccount = { platform: 'dzen', cookies_encrypted: 'enc:v1:test' };
    const unconfiguredDzenAccount = { platform: 'dzen' };
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(okAccount), true);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(habrAccount), true);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(vcAccount), true);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(dzenAccount), true);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(unconfiguredDzenAccount), false);
});
(0, node_test_1.default)('VK direct execution is available only with a provider target and publish credential', () => {
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution({ platform: 'vk' }), false);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution({ platform: 'vk', vk_id: '-123' }), false);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution({
        platform: 'vk',
        vk_id: '-123',
        publish_access_token: 'token'
    }), true);
});
