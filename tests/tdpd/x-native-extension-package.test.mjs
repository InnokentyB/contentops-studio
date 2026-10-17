import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const modulePath = path.resolve('extensions/x-native/package.mjs');
const fixture = id => ({ projectId: id, taskId: id + 100, channelId: id + 200, revision: 2,
    bodySha256: 'a'.repeat(64), account: `@fixture_${id}`, profileUrl: `https://x.com/fixture_${id}`,
    scheduleAt: '2026-10-17T10:00:00.000Z' });
test('shared extension validates two different publication packages without business allowlists', async () => {
    const { validatePackage, journalKey } = await import(pathToFileURL(modulePath));
    for (const id of [301, 302]) {
        const input = fixture(id); const result = validatePackage(input);
        assert.deepEqual(result, input);
        assert.equal(journalKey('flight', { ...input, releaseKeySha256: 'b'.repeat(64) }),
            `native:flight:${id}:${id + 100}:${'b'.repeat(64)}`);
        assert.equal(journalKey('click', { ...input, releaseKeySha256: 'b'.repeat(64), attemptId: 55 }),
            `native:click:${id}:${id + 100}:${'b'.repeat(64)}:55`);
    }
    for (const change of [{ projectId: 0 }, { account: '@bad.*' }, { profileUrl: 'https://x.com/foreign' },
        { profileUrl: 'https://evil.invalid/fixture_301' }, { scheduleAt: 'invalid' }, { bodySha256: 'wrong' }]) {
        assert.throws(() => validatePackage({ ...fixture(301), ...change }), /LOCAL_PACKAGE_INVALID/);
    }
});
test('installable build has least-privilege fixed origins and no task-specific authority', async () => {
    const manifest = JSON.parse(await readFile('extensions/x-native/pilot-manifest.json', 'utf8'));
    assert.deepEqual(manifest.permissions, []);
    assert.deepEqual(manifest.host_permissions, ['https://x.com/*', 'https://publishplanner-production.up.railway.app/*']);
    assert.equal(manifest.externally_connectable, undefined);
    for (const name of ['pilot-background.mjs', 'pilot-native.js', 'native-wire.mjs', 'store.mjs', 'pilot-click.mjs']) {
        const source = await readFile(`extensions/x-native/${name}`, 'utf8');
        assert.doesNotMatch(source, /1113|naraHeTc|0fa60a2b|2026-10-14/);
    }
});
