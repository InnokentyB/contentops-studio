import test from 'node:test';
import assert from 'node:assert/strict';
import { vkBrowserErrorCode } from '../services/vk_browser_error';
test('operator errors preserve known blocker codes without provider secrets', () => {
    assert.equal(vkBrowserErrorCode(new Error('[VK_CLIP_UI_UNVERIFIED] cookie=secret-canary')), '[VK_CLIP_UI_UNVERIFIED]');
    assert.equal(vkBrowserErrorCode(new Error('Authorization: secret-canary')), '[VK_BROWSER_OPERATION_FAILED]');
    assert.equal(vkBrowserErrorCode(new Error('[TOKEN_CANARY] raw')), '[VK_BROWSER_OPERATION_FAILED]');
});
