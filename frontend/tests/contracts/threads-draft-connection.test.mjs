import assert from 'node:assert/strict';
import fs from 'node:fs';

const settings = fs.readFileSync(new URL('../../src/pages/Settings.tsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../../src/api.ts', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../../src/routes/projects/channels.routes.ts', import.meta.url), 'utf8');

assert.match(api, /testDraftChannelConnection/);
assert.match(api, /channels\/test-connection/);
assert.match(routes, /channels\/test-connection/);
assert.match(routes, /type !== 'threads'/);
assert.match(settings, /setNewChannelId\(response\.result\.id\)/);
assert.match(settings, /Проверить и определить профиль/);
assert.match(settings, /ID будет определён по токену/);

console.log('Threads draft connection and identity resolution contract: ok');
