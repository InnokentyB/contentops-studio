import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/app/node_modules/playwright');
const text = 'Accepted synthetic copy. Never send to a provider.';
const stamp = 'a'.repeat(64);
const packageData = { projectId: 301, taskId: 401, channelId: 501, revision: 1,
    bodySha256: 'b'.repeat(64), account: '@fixture_301', profileUrl: 'https://x.com/fixture_301',
    scheduleAt: '2026-10-17T10:00:00.000Z' };
function html({ nested = true, lang = 'en', label = 'Post', extraDialog = false,
    duplicateEditor = false, disabled = false, media = false, nestedConfirmation = false,
    siblingChild = false, outerEditor = false, duplicateButton = false } = {}) {
    const editor = `<div data-testid="tweetTextarea_0" contenteditable="true">${text}</div>`;
    const content = `${editor}${duplicateEditor ? editor : ''}<button data-testid="tweetButton" ${disabled ? 'disabled' : ''}>${label}</button>${duplicateButton ? '<button data-testid="tweetButton">Post</button>' : ''}${media ? '<div data-testid="attachments"></div>' : ''}${nestedConfirmation ? '<div role="dialog">Confirm unrelated action</div>' : ''}`;
    return `<html lang="${lang}"><head><meta charset="utf-8"></head><body><button data-testid="SideNav_AccountSwitcher_Button">@fixture_301</button>
        <div role="dialog">${outerEditor ? editor : ''}${nested ? '<div role="dialog">' : ''}${content}${nested ? '</div>' : ''}${siblingChild ? '<div role="dialog">Separate action</div>' : ''}</div>
        ${extraDialog ? '<div role="dialog">Unrelated confirmation</div>' : ''}</body></html>`;
}
test('native editor compatibility preserves fail-closed controls on actual DOM wrappers', async t => {
    const browser = await chromium.launch({ executablePath: process.env.X_BROWSER_EXECUTABLE,
        headless: true, chromiumSandbox: true });
    const source = (await readFile('extensions/x-native/pilot-native.js', 'utf8'))
        .replace('__X_NATIVE_READER_BUILD__', stamp);
    let providerRequests = 0;
    try {
        const cases = [
            ['nested English dialog wrappers', {}, null],
            ['nested Russian dialog wrappers', { lang: 'ru', label: 'Опубликовать пост' }, null],
            ['legacy single dialog', { nested: false }, null],
            ['legacy unspecified language', { lang: '' }, null],
            ['English regional locale', { lang: 'en-GB' }, null],
            ['unrelated visible dialog blocks', { extraDialog: true }, 'NATIVE_EDITOR_AMBIGUOUS'],
            ['duplicate editor blocks', { duplicateEditor: true }, 'NATIVE_EDITOR_AMBIGUOUS'],
            ['editor outside leaf blocks', { outerEditor: true }, 'NATIVE_EDITOR_AMBIGUOUS'],
            ['nested unrelated confirmation blocks', { nestedConfirmation: true }, 'NATIVE_EDITOR_AMBIGUOUS'],
            ['sibling child dialog blocks', { siblingChild: true }, 'NATIVE_EDITOR_AMBIGUOUS'],
            ['duplicate submit button blocks', { duplicateButton: true }, 'NATIVE_EDITOR_AMBIGUOUS'],
            ['disabled button blocks', { disabled: true }, 'NATIVE_POST_DISABLED'],
            ['media blocks', { media: true }, 'NATIVE_EDITOR_MEDIA_PRESENT'],
            ['unsupported action blocks', { lang: 'ru', label: 'Ответить' }, 'NATIVE_POST_LABEL_UNSUPPORTED'],
            ['unsupported locale blocks', { lang: 'es', label: 'Publicar' }, 'NATIVE_POST_LABEL_UNSUPPORTED'],
            ['wrong text blocks', {}, 'NATIVE_EDITOR_TEXT_MISMATCH', { text: text + ' changed' }],
            ['wrong account blocks', {}, 'NATIVE_ACCOUNT_MISMATCH', { packageData: { ...packageData, account: '@other', profileUrl: 'https://x.com/other' } }],
        ];
        for (const [name, options, expectedCode, change = {}] of cases) {
            await t.test(name, async () => {
                const page = await browser.newPage();
                try {
                    await page.route('**/*', route => {
                        providerRequests++;
                        return route.fulfill({ status: 200, contentType: 'text/html', body: html(options) });
                    });
                    await page.goto('https://x.com/compose/post');
                    await page.evaluate(() => {
                        window.nativeClicks = 0;
                        document.querySelector('[data-testid="tweetButton"]').addEventListener('click', () => window.nativeClicks++);
                        window.chrome = { runtime: { id: 'fixture', onMessage: { addListener(fn) { window.nativeReader = fn; } } } };
                    });
                    await page.addScriptTag({ content: source });
                    const result = await page.evaluate(message => new Promise(resolve => {
                        window.nativeReader(message, { id: 'fixture' }, resolve);
                    }), { operation: 'editor', text, packageData, readerBuildSha256: stamp, ...change });
                    if (expectedCode) {
                        assert.equal(result.ok, false); assert.equal(result.code, expectedCode);
                    } else {
                        assert.equal(result.ok, true, JSON.stringify(result));
                        assert.equal(result.value.text, text);
                        assert.equal(result.value.editorMode, 'new_post');
                        assert.equal(result.value.account, packageData.account);
                    }
                    assert.equal(await page.evaluate(() => window.nativeClicks), 0, 'read-only check never clicks');
                } finally { await page.close(); }
            });
        }
        assert.equal(providerRequests, cases.length, 'only intercepted synthetic document requests');
    } finally { await browser.close(); }
});
