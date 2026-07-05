"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const ok_service_1 = __importDefault(require("../services/ok.service"));
const habr_service_1 = __importDefault(require("../services/habr.service"));
const vc_service_1 = __importDefault(require("../services/vc.service"));
const dzen_service_1 = __importDefault(require("../services/dzen.service"));
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
(0, node_test_1.default)('VCService runs publish and returns mock post URL', async () => {
    const config = {
        access_token: 'vc_token',
        subsite_id: '123'
    };
    const mockUrl = await vc_service_1.default.publishPost(config, 'Тестовый текст VC', undefined, 'Тестовая статья VC');
    strict_1.default.ok(mockUrl);
    strict_1.default.ok(mockUrl.startsWith('https://vc.ru/mock-'));
});
(0, node_test_1.default)('DzenService publishes and returns mock URL', async () => {
    const config = {
        channel_id: 'dzen_channel_123'
    };
    const mockUrl = await dzen_service_1.default.publishPost(config, 'Тестовый текст Дзен', undefined, 'Дзен статья');
    strict_1.default.ok(mockUrl);
    strict_1.default.ok(mockUrl.startsWith('https://dzen.ru/media/mock-'));
});
(0, node_test_1.default)('publicationAdapterService recognizes new platforms as direct-execution friendly', () => {
    const okAccount = { platform: 'ok' };
    const habrAccount = { platform: 'habr_article' };
    const vcAccount = { platform: 'vc_article' };
    const dzenAccount = { platform: 'dzen' };
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(okAccount), true);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(habrAccount), true);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(vcAccount), true);
    strict_1.default.equal(publication_adapter_service_1.default.supportsDirectExecution(dzenAccount), true);
});
