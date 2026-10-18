import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationDiagnosticResult } from '../mcp/tools/publication_diagnostic_result';
import type { PublicationDiagnostic } from '../services/publication_diagnostics';

const diagnostic: PublicationDiagnostic = { code: 'PACKAGE_CHANGED', message: 'The accepted package changed.',
    reasons: [{ code: 'PACKAGE_CHANGED', field: 'publication_package', message: 'The accepted package changed.',
        action: 'Review the current package and its existing attempt before another approved operation.' }], retry_allowed: false };

test('shared diagnostic boundary preserves successful payload and does not log', async t => {
    const warning = t.mock.method(console, 'warn', () => {});
    const result = await publicationDiagnosticResult('publication', async () => ({ mode: 'dry_run', published: false }), () => diagnostic);
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, { mode: 'dry_run', published: false });
    assert.equal(warning.mock.callCount(), 0);
});

test('shared boundary serializes only reviewed diagnostic and logs once without raw error data', async t => {
    const logs: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args); });
    const result = await publicationDiagnosticResult('telegram', async () => {
        throw new Error('private-token private-body private-approval provider-payload');
    }, () => diagnostic);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, diagnostic.code);
    assert.equal(result.structuredContent.error, '[PACKAGE_CHANGED]');
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal(logs.length, 1);
    assert.ok(!JSON.stringify({ result, logs }).includes('private-'));
    assert.ok(!JSON.stringify({ result, logs }).includes('provider-payload'));
});

test('failed result projection replaces unsafe error data while preserving safe state', async t => {
    t.mock.method(console, 'warn', () => {});
    const result = await publicationDiagnosticResult('publication', async () => ({
        success: false, error: 'private-token', provider_payload: 'private-body'
    }), () => diagnostic, () => ({ payload: { success: false, mode: 'blocked' }, diagnostic }));
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.mode, 'blocked');
    assert.equal(result.structuredContent.code, 'PACKAGE_CHANGED');
    assert.ok(!JSON.stringify(result).includes('private-'));
});

test('diagnostic status read remains a successful read instead of a failed command', async t => {
    t.mock.method(console, 'warn', () => {});
    const result = await publicationDiagnosticResult('vk', async () => ({ state: 'blocked' }), () => diagnostic,
        value => ({ payload: value, diagnostic, isError: false }));
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.state, 'blocked');
    assert.equal(result.structuredContent.retry_allowed, false);
});
