import assert from 'node:assert/strict';
import fs from 'node:fs';

const settings = fs.readFileSync(new URL('../../src/pages/Settings.tsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../../src/api.ts', import.meta.url), 'utf8');

assert.match(api, /testChannelConnection: \(projectId: number, channelId: number, config\?: Record<string, unknown>\)/);
assert.match(api, /test-connection`, \{ config \}/);
assert.match(settings, /config: editingChannelConfig/);
assert.doesNotMatch(settings, /Сначала сохраните изменения, затем запустите проверку подключения/);
assert.match(settings, /Проверить без сохранения/);

console.log('Dzen unsaved connection test contract: ok');
