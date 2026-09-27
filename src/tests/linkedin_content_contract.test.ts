import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareLinkedInSemanticBlocks,
    validateLinkedInNativeText
} from '../services/linkedin_content_contract';
import publicationAdapterService from '../services/publication_adapter.service';
import { PublicationDispatcher } from '../services/publishers/publication_dispatcher';

const acceptedBody = [
    'A short opening that establishes the point.',
    'A second mobile-readable paragraph keeps the reasoning easy to scan.',
    ['• First supported bullet', '• Second supported bullet'].join('\n'),
    'A concise closing with a clear next action.'
].join('\n\n');

test('LinkedIn contract accepts plain text with deliberate block spacing and supported bullets', () => {
    assert.deepEqual(validateLinkedInNativeText(acceptedBody), {
        valid: true,
        issues: []
    });
});

test('LinkedIn contract rejects dense prose and Markdown formatting before publication', () => {
    const denseBody = `${'Dense prose '.repeat(27).trim()}\nThis newline is not a supported bullet continuation.`;
    const markdownBody = '**Bold claim**\n\n- Markdown bullet\n- Another bullet';

    assert.deepEqual(
        validateLinkedInNativeText(denseBody).issues.map((issue) => issue.code),
        ['paragraph_too_long', 'single_newline']
    );
    assert.deepEqual(
        validateLinkedInNativeText(markdownBody).issues.map((issue) => issue.code),
        ['markdown_styling', 'unsupported_bullet']
    );
});

test('LinkedIn readback compares semantic blocks instead of bytes', () => {
    const transportNormalized = acceptedBody
        .split('\n').join('\r\n')
        .replace('short opening', 'short\u00a0 opening');

    assert.deepEqual(compareLinkedInSemanticBlocks(acceptedBody, transportNormalized), {
        matches: true,
        expectedBlockCount: 4,
        actualBlockCount: 4,
        firstMismatch: null
    });
});

test('LinkedIn readback detects a merged semantic block', () => {
    const merged = acceptedBody.replace('\n\nA second', ' A second');
    const comparison = compareLinkedInSemanticBlocks(acceptedBody, merged);

    assert.equal(comparison.matches, false);
    assert.equal(comparison.expectedBlockCount, 4);
    assert.equal(comparison.actualBlockCount, 3);
    assert.equal(comparison.firstMismatch?.index, 0);
});

test('shared publication adapter exposes the LinkedIn contract and operator checklist', () => {
    assert.equal(publicationAdapterService.validateChannelContent('linkedin', acceptedBody).valid, true);
    assert.equal(publicationAdapterService.validateChannelContent('telegram', '**Channel-specific markup**').valid, true);

    const checklist = publicationAdapterService.buildManualChecklist({
        id: 'linkedin-formatting',
        channel: 'linkedin',
        action_type: 'publish_post'
    }, { accountRef: 'approved_linkedin_identity' });

    assert.ok(checklist.some((item) => item.includes('plain text only')));
    assert.ok(checklist.some((item) => item.includes('double newline')));
    assert.ok(checklist.some((item) => item.includes('semantic blocks')));
});

test('LinkedIn connector rejects a non-native body before any provider call', async (context) => {
    let providerCalls = 0;
    context.mock.method(globalThis, 'fetch', async () => {
        providerCalls += 1;
        return new Response('{}', { status: 201 });
    });

    const dispatcher = new PublicationDispatcher();
    await assert.rejects(
        dispatcher.executeAutomatedPublicationTask(
            { channel: { type: 'linkedin' }, assets: {} },
            { publication: { body: '**Dense Markdown body**' } },
            { linkedin_urn: 'urn:li:person:test', access_token: 'test-token' },
            { actions: [], assets: {}, accounts: {} }
        ),
        /\[LINKEDIN_NATIVE_FORMAT_INVALID\] markdown_styling/
    );
    assert.equal(providerCalls, 0);
});
