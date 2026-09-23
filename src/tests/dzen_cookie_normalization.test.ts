import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDzenCookieHeader } from '../utils/dzen_cookie.utils';

test('keeps an existing Cookie request header unchanged', () => {
    assert.equal(normalizeDzenCookieHeader('session=abc; token=def'), 'session=abc; token=def');
});

test('converts stored browser cookies for dzen.ru into a Cookie header', () => {
    const stored = JSON.stringify([
        { name: 'session', value: 'abc=123', domain: '.dzen.ru' },
        { name: 'host_only', value: 'ok', domain: 'dzen.ru' },
        { name: 'nested', value: 'yes', domain: 'www.dzen.ru' },
        { name: 'passport', value: 'secret', domain: '.yandex.ru' },
        { name: 'foreign', value: 'secret', domain: 'notdzen.ru' }
    ]);

    assert.equal(normalizeDzenCookieHeader(stored), 'session=abc=123; host_only=ok; nested=yes');
});

test('filters unsafe cookie names and values without exposing them', () => {
    const stored = JSON.stringify([
        { name: 'bad name', value: 'secret-one', domain: '.dzen.ru' },
        { name: 'safe', value: 'bad\nvalue', domain: '.dzen.ru' }
    ]);

    assert.throws(
        () => normalizeDzenCookieHeader(stored),
        (error: Error) => error.message === 'No valid dzen.ru cookies were found'
            && !error.message.includes('secret-one')
            && !error.message.includes('bad\nvalue')
    );
});

test('rejects malformed JSON without echoing its contents', () => {
    assert.throws(
        () => normalizeDzenCookieHeader('[{"name":"session","value":"do-not-echo"}'),
        (error: Error) => error.message === 'Dzen cookies JSON is invalid'
            && !error.message.includes('do-not-echo')
    );
});
