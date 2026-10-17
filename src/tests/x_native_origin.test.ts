import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNativeExtensionOrigin } from '../services/x_native_origin';

test('native HTTP origin matches the enrolled extension exactly, never another extension or web page', () => {
    const id = 'a'.repeat(32);
    assert.doesNotThrow(() => assertNativeExtensionOrigin(`chrome-extension://${id}`, id));
    for (const value of [undefined, '', 'null', `chrome-extension://${'b'.repeat(32)}`,
        `chrome-extension://${id}/`, `https://${id}`, 'https://x.com', `chrome-extension://${id}.evil`]) {
        assert.throws(() => assertNativeExtensionOrigin(value, id), /X_NATIVE_ORIGIN_DENIED/);
    }
});
