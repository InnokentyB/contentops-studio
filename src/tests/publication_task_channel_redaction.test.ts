import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizePublicationTaskChannel } from '../services/mcp_publication/tasks';

test('publication task readback removes encrypted and plaintext channel credentials recursively', () => {
    const task = sanitizePublicationTaskChannel({ id: 1108, channel: { type: 'threads', config: {
        access_token_encrypted: 'enc:v1:sensitive-ciphertext',
        access_token: 'sensitive-plaintext',
        raw_account: { access_token_encrypted: 'enc:v1:nested-sensitive', threads_user_id: 'meta-7' },
        threads_user_id: 'meta-7'
    } } });
    const serialized = JSON.stringify(task);
    const config = task.channel.config as Record<string, unknown>;
    const raw = config.raw_account as Record<string, unknown>;
    assert.doesNotMatch(serialized, /sensitive-ciphertext|sensitive-plaintext|nested-sensitive/);
    assert.equal(config.access_token, '******');
    assert.equal(config.access_token_encrypted, undefined);
    assert.equal(raw.access_token, '******');
    assert.equal(raw.access_token_encrypted, undefined);
    assert.equal(config.threads_user_id, 'meta-7');
});
