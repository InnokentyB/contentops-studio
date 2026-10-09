import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runVkBrowserWorker } from '../workers/vk_browser_worker';

test('unverified live Clip stops before Publisher connection or browser launch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-clip-gate-'));
    const job = path.join(root, 'job.json');
    fs.writeFileSync(job, JSON.stringify({ target: { placement: 'clip' }, execution: { mode: 'submit' } }), { mode: 0o600 });
    try {
        await assert.rejects(runVkBrowserWorker(['--job', job, '--profile-dir', path.join(root, 'profile'),
            '--evidence-dir', path.join(root, 'evidence'), '--mcp-endpoint', 'https://localhost:1']), /VK_CLIP_UI_UNVERIFIED/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
