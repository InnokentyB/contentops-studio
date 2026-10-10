import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');
const source = new URL('../../src/components/VkSearchTokenField.tsx', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const loaded = new Module(source.pathname);
loaded.paths = Module._nodeModulePaths(new URL('../../', import.meta.url).pathname);
loaded._compile(compiled, source.pathname);
const { VkSearchTokenField } = loaded.exports;

test('search key has an accessible password field and distinguishes publishing and VK ID credentials', () => {
    const html = renderToStaticMarkup(React.createElement(VkSearchTokenField, {
        id: 'search-key', locale: 'ru', value: '******', onChange: () => {}
    }));
    assert.match(html, /for="search-key"/);
    assert.match(html, /type="password"/);
    assert.match(html, /value="\*{6}"/);
    assert.match(html, /сервисный/i);
    assert.match(html, /сообщества/i);
    assert.match(html, /сохранён/i);
});
test('search-key editing forwards the value and renders untrusted non-string values as empty', () => {
    const edits = [];
    const tree = VkSearchTokenField({ id: 'search-key', locale: 'en', value: { token: 'bad' }, onChange: v => edits.push(v) });
    const input = tree.props.children.find(child => child?.type === 'input');
    assert.equal(input.props.value, '');
    input.props.onChange({ target: { value: 'test-search-key' } });
    assert.deepEqual(edits, ['test-search-key']);
});
