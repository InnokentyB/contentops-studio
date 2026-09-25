import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDraftDzenConnectionCheck } from '../services/dzen_connection_check';

test('draft Dzen connection check uses unsaved browser export and declares that it was not persisted', () => {
    const saved = { cookies: 'saved=secret', channel_id: 'saved-channel' };
    const draft = {
        cookies: JSON.stringify([{ name: 'Session_id', value: 'draft-secret', domain: '.dzen.ru' }]),
        channel_id: 'draft-channel'
    };

    const check = prepareDraftDzenConnectionCheck(saved, draft);

    assert.equal(check.config.cookies, draft.cookies);
    assert.equal(check.config.channel_id, 'draft-channel');
    assert.equal(check.persisted, false);
    assert.equal(check.credential_source, 'draft');
    assert.equal(check.input_format, 'browser_json_export');
    assert.deepEqual(saved, { cookies: 'saved=secret', channel_id: 'saved-channel' });
});

test('draft Dzen connection check falls back to saved masked credential without exposing it', () => {
    const check = prepareDraftDzenConnectionCheck(
        { cookies: 'saved=secret', channel_id: 'channel' },
        { cookies: '******' }
    );

    assert.equal(check.config.cookies, 'saved=secret');
    assert.equal(check.credential_source, 'saved');
    assert.equal(check.input_format, 'cookie_header');
    assert.equal(check.persisted, false);
});
