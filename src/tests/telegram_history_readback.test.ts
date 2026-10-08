import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { TelegramClientService } from '../services/telegram_client.service';

test('MTProto history readback scans exact normalized text and never invokes provider mutation', async () => {
    const service = new TelegramClientService();
    const calls: string[] = [];
    service.inspectSessionTarget = async () => ({ configured: true, project_id: 10, account_id: 1, phone_hint: '***0000', reason_code: null, reason: null });
    service.getClient = async () => ({
        getEntity: async (target: string) => { calls.push(`getEntity:${target}`); return { id: 1 }; },
        getMessages: async () => {
            calls.push('getMessages');
            return [{ id: 321, date: 1790874960, message: 'Accepted text\n\nSecond paragraph' }];
        },
        sendMessage: async () => { calls.push('sendMessage'); throw new Error('must not send'); },
        invoke: async () => { calls.push('invoke'); throw new Error('must not invoke mutations'); }
    } as unknown as Awaited<ReturnType<TelegramClientService['getClient']>>);
    const result = await service.searchExactTextHistory({
        projectId: 10, target: '@analysts_thinking', expectedText: ' Accepted   text\n\nSecond paragraph ', limit: 100
    });
    assert.equal(result.status, 'found');
    assert.equal(result.matches[0].publicUrl, 'https://t.me/analysts_thinking/321');
    assert.equal(result.matches[0].textSha256, createHash('sha256').update('Accepted text\n\nSecond paragraph').digest('hex'));
    assert.deepEqual(calls, ['getEntity:@analysts_thinking', 'getMessages']);
});

test('MTProto history readback reports unavailable session and ambiguous exact matches without guessing', async () => {
    const unavailable = new TelegramClientService();
    unavailable.inspectSessionTarget = async () => ({ configured: false, project_id: 10, account_id: null, phone_hint: null,
        reason_code: 'project_session_missing', reason: 'missing' });
    assert.deepEqual(await unavailable.searchExactTextHistory({ projectId: 10, target: '@analysts_thinking', expectedText: 'Text' }), {
        status: 'session_unavailable', reasonCode: 'project_session_missing', matches: []
    });

    const undecryptable = new TelegramClientService();
    undecryptable.inspectSessionTarget = async () => ({ configured: true, project_id: 10, account_id: 1, phone_hint: '***0000', reason_code: null, reason: null });
    undecryptable.getClient = async () => { throw new Error('secret unavailable'); };
    assert.deepEqual(await undecryptable.searchExactTextHistory({ projectId: 10, target: '@analysts_thinking', expectedText: 'Text' }), {
        status: 'session_unavailable', reasonCode: 'project_session_decryption_failed', matches: []
    });

    const ambiguous = new TelegramClientService();
    ambiguous.inspectSessionTarget = async () => ({ configured: true, project_id: 10, account_id: 1, phone_hint: '***0000', reason_code: null, reason: null });
    ambiguous.getClient = async () => ({ getEntity: async () => ({}), getMessages: async () => [
        { id: 1, date: 1790874960, message: 'Text' }, { id: 2, date: 1790874970, message: 'Text' }
    ] } as unknown as Awaited<ReturnType<TelegramClientService['getClient']>>);
    const result = await ambiguous.searchExactTextHistory({ projectId: 10, target: '@analysts_thinking', expectedText: 'Text', limit: 100 });
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.matches.length, 2);
});
