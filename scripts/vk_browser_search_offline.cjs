#!/usr/bin/env node
// Offline operator boundary. No VK profile, credentials, requests, or publication authority.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { sandboxedChromiumLaunchOptions } = require('../dist/services/browser_launch');
const { runVkBrowserSearch, VkBrowserSearchJobSchema } = require('../dist/services/vk_browser_search.service');
const { PlaywrightVkBrowserSearchUi } = require('../dist/services/vk_browser_search_ui');

async function main() {
    const [jobFile, htmlFile] = process.argv.slice(2);
    if (!jobFile || !htmlFile || !path.isAbsolute(jobFile) || !path.isAbsolute(htmlFile)) {
        throw new Error('Usage: node scripts/vk_browser_search_offline.cjs /absolute/job.json /absolute/fixture.html');
    }
    for (const file of [jobFile, htmlFile]) {
        const info = fs.statSync(file);
        if (!info.isFile() || info.size > 1024 * 1024 || (file === jobFile && (info.mode & 0o077) !== 0)) throw new Error('[VK_SEARCH_OFFLINE_INPUT_INVALID]');
    }
    const job = VkBrowserSearchJobSchema.parse(JSON.parse(fs.readFileSync(jobFile, 'utf8')));
    const html = fs.readFileSync(htmlFile, 'utf8');
    const browser = await chromium.launch(sandboxedChromiumLaunchOptions({ headless: true, executablePath: process.env.APP_BROWSER_EXECUTABLE_PATH ?? chromium.executablePath() }));
    try {
        const context = await browser.newContext({ javaScriptEnabled: false });
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        const ui = new PlaywrightVkBrowserSearchUi(page, { surface_status: 'fixture',
            scope: { project_id: job.project_id, channel_id: job.channel_id, permission: 'search_only' },
            navigateFixture: async () => { await page.setContent(html); } });
        const result = await runVkBrowserSearch(job, ui);
        process.stdout.write(`${JSON.stringify({ ...result, execution: 'offline_fixture_only', authenticated_handoff: false }, null, 2)}\n`);
    } finally { await browser.close(); }
}
main().catch(() => { process.stderr.write('[VK_SEARCH_OFFLINE_RUN_FAILED] Check bounded local fixture/job inputs; no provider operation attempted.\n'); process.exitCode = 1; });
