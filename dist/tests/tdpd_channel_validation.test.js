"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
// Import our new utility functions (will fail initially as the module doesn't exist yet)
// @ts-ignore
const channel_utils_1 = require("../utils/channel.utils");
(0, node_test_1.default)('sanitizeChannelConfig masks sensitive fields', () => {
    const config = {
        telegram_channel_id: '-100123456',
        channel_username: '@mychannel',
        api_key: 'super-secret-vk-key',
        access_token: 'threads-token',
        cookies: 'session=abc',
        application_secret_key: 'ok-app-secret'
    };
    const sanitized = (0, channel_utils_1.sanitizeChannelConfig)('telegram', config);
    strict_1.default.equal(sanitized.telegram_channel_id, '-100123456');
    strict_1.default.equal(sanitized.channel_username, '@mychannel');
    strict_1.default.equal(sanitized.api_key, '******');
    strict_1.default.equal(sanitized.access_token, '******');
    strict_1.default.equal(sanitized.cookies, '******');
    strict_1.default.equal(sanitized.application_secret_key, '******');
});
(0, node_test_1.default)('mergeChannelConfig preserves existing secrets when incoming is masked', () => {
    const existingConfig = {
        api_key: 'original-vk-key',
        access_token: 'original-threads-token',
        cookies: 'original-session',
        application_secret_key: 'original-ok-secret'
    };
    const incomingConfig = {
        telegram_channel_id: '-100999888',
        api_key: '******',
        access_token: '******',
        cookies: '******',
        application_secret_key: '******'
    };
    const merged = (0, channel_utils_1.mergeChannelConfig)(incomingConfig, existingConfig);
    strict_1.default.equal(merged.telegram_channel_id, '-100999888');
    strict_1.default.equal(merged.api_key, 'original-vk-key');
    strict_1.default.equal(merged.access_token, 'original-threads-token');
    strict_1.default.equal(merged.cookies, 'original-session');
    strict_1.default.equal(merged.application_secret_key, 'original-ok-secret');
});
(0, node_test_1.default)('mergeChannelConfig updates secrets when incoming has actual new values', () => {
    const existingConfig = {
        api_key: 'original-vk-key',
        access_token: 'original-threads-token'
    };
    const incomingConfig = {
        api_key: 'new-vk-key',
        access_token: '******'
    };
    const merged = (0, channel_utils_1.mergeChannelConfig)(incomingConfig, existingConfig);
    strict_1.default.equal(merged.api_key, 'new-vk-key');
    strict_1.default.equal(merged.access_token, 'original-threads-token');
});
