import test from 'node:test';
import assert from 'node:assert/strict';

// Import our new utility functions (will fail initially as the module doesn't exist yet)
// @ts-ignore
import { sanitizeChannelConfig, mergeChannelConfig } from '../utils/channel.utils';

test('sanitizeChannelConfig masks sensitive fields', () => {
    const config = {
        telegram_channel_id: '-100123456',
        channel_username: '@mychannel',
        api_key: 'super-secret-vk-key',
        access_token: 'threads-token',
        cookies: 'session=abc',
        application_secret_key: 'ok-app-secret'
    };

    const sanitized = sanitizeChannelConfig('telegram', config);

    assert.equal(sanitized.telegram_channel_id, '-100123456');
    assert.equal(sanitized.channel_username, '@mychannel');
    assert.equal(sanitized.api_key, '******');
    assert.equal(sanitized.access_token, '******');
    assert.equal(sanitized.cookies, '******');
    assert.equal(sanitized.application_secret_key, '******');
});

test('mergeChannelConfig preserves existing secrets when incoming is masked', () => {
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

    const merged = mergeChannelConfig(incomingConfig, existingConfig);

    assert.equal(merged.telegram_channel_id, '-100999888');
    assert.equal(merged.api_key, 'original-vk-key');
    assert.equal(merged.access_token, 'original-threads-token');
    assert.equal(merged.cookies, 'original-session');
    assert.equal(merged.application_secret_key, 'original-ok-secret');
});

test('mergeChannelConfig updates secrets when incoming has actual new values', () => {
    const existingConfig = {
        api_key: 'original-vk-key',
        access_token: 'original-threads-token'
    };

    const incomingConfig = {
        api_key: 'new-vk-key',
        access_token: '******'
    };

    const merged = mergeChannelConfig(incomingConfig, existingConfig);

    assert.equal(merged.api_key, 'new-vk-key');
    assert.equal(merged.access_token, 'original-threads-token');
});
