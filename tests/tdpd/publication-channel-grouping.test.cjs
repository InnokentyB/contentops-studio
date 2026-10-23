const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
function load() {
    const filename = path.resolve(__dirname, '../../frontend/src/components/publication-channel-groups.ts');
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const loaded = new Module(filename, module);
    loaded._compile(output.outputText, filename);
    return loaded.exports.groupPublicationChannels;
}
test('Dzen aliases share a group; unknown and inactive records remain visible', () => {
    const group = load();
    const rows = ['zen', 'dzen', 'zen_article', 'custom-provider'].map((type, id) => ({ id, type, name: 'Channel', is_active: false }));
    const result = group(rows, 'ru', 'asc');
    assert.equal(result.length, 2);
    assert.equal(result.find(g => g.key === 'dzen').channels.length, 3);
    assert.equal(result.find(g => g.key === 'custom-provider').label, 'custom-provider');
    assert.equal(result.flatMap(g => g.channels).length, rows.length);
});
test('natural case-insensitive names sort in either direction with numeric ID ties', () => {
    const group = load();
    const rows = [{ id: 9, type: 'vk', name: 'Channel10' }, { id: 4, type: 'vk', name: 'channel2' }, { id: 2, type: 'vk', name: 'Channel2' }];
    assert.deepEqual(group(rows, 'en', 'asc')[0].channels.map(c => c.id), [2, 4, 9]);
    assert.deepEqual(group(rows, 'en', 'desc')[0].channels.map(c => c.id), [9, 2, 4]);
});
test('group labels sort ascending for both locales independently of name direction', () => {
    const group = load();
    const rows = ['telegram', 'linkedin', 'vk', 'threads', 'zen', 'x', 'instagram', 'youtube'].map((type, id) => ({ id, type, name: 'Name' }));
    for (const locale of ['ru', 'en']) {
        const asc = group(rows, locale, 'asc');
        const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
        assert.deepEqual(asc.map(g => g.label), asc.map(g => g.label).sort(collator.compare));
        assert.deepEqual(group(rows, locale, 'desc').map(g => g.key), asc.map(g => g.key));
        assert.ok(asc.every(g => g.label.length > 0));
    }
});
test('input arrays and objects are unchanged; output retains original references', () => {
    const group = load();
    const rows = Object.freeze([Object.freeze({ id: 2, type: 'telegram', name: 'Бета' }), Object.freeze({ id: 1, type: 'telegram', name: 'Альфа' })]);
    const result = group(rows, 'ru', 'asc');
    assert.equal(rows[0].id, 2);
    assert.equal(result[0].channels[0], rows[1]);
    assert.equal(result[0].channels[1], rows[0]);
    assert.deepEqual(group([], 'en', 'asc'), []);
});
test('1000 synthetic channels group and sort within 100ms after warmup', () => {
    const group = load();
    const rows = Array.from({ length: 1000 }, (_, id) => ({ id, name: `Канал${1000 - id}`, type: ['vk', 'zen', 'telegram'][id % 3] }));
    group(rows, 'ru', 'asc');
    const start = performance.now();
    const result = group(rows, 'ru', 'asc');
    assert.ok(performance.now() - start < 100);
    assert.equal(result.reduce((sum, g) => sum + g.channels.length, 0), 1000);
});
