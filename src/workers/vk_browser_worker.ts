import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PlaywrightVkBrowserUi } from '../services/vk_browser_playwright_ui';
import { prepareVkBrowserPublication, type VkBrowserJob } from '../services/vk_browser_worker.service';

type Options = {
    jobFile: string;
    profileDir: string;
    evidenceDir: string;
    assetRoots: string[];
    channel: string;
};

function valueAfter(argv: string[], flag: string) {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
}

function parseOptions(argv: string[]): Options {
    const jobFile = valueAfter(argv, '--job') || process.env.VK_BROWSER_JOB_FILE || '';
    const profileDir = valueAfter(argv, '--profile-dir') || process.env.VK_BROWSER_PROFILE_DIR || '';
    const evidenceDir = valueAfter(argv, '--evidence-dir')
        || process.env.VK_BROWSER_EVIDENCE_DIR
        || (profileDir ? path.join(profileDir, 'evidence') : '');
    const rootsFromArgs = argv.flatMap((value, index) => value === '--asset-root' && argv[index + 1] ? [argv[index + 1]] : []);
    const rootsFromEnv = (process.env.VK_BROWSER_APPROVED_ASSET_ROOTS || '')
        .split(path.delimiter)
        .map((value) => value.trim())
        .filter(Boolean);
    const channel = valueAfter(argv, '--channel') || process.env.VK_BROWSER_CHANNEL || 'chrome';

    if (!path.isAbsolute(jobFile) || !path.isAbsolute(profileDir) || !path.isAbsolute(evidenceDir)) {
        throw new Error('[VK_BROWSER_CONFIG_INVALID] Job, profile and evidence paths must be absolute');
    }
    const assetRoots = [...rootsFromArgs, ...rootsFromEnv];
    if (assetRoots.some((root) => !path.isAbsolute(root))) {
        throw new Error('[VK_BROWSER_CONFIG_INVALID] Approved asset roots must be absolute');
    }
    return { jobFile, profileDir, evidenceDir, assetRoots, channel };
}

function readJob(jobFile: string): VkBrowserJob {
    const stat = fs.statSync(jobFile);
    if (!stat.isFile()) throw new Error('[VK_BROWSER_JOB_INVALID] Job path must be a file');
    if ((stat.mode & 0o077) !== 0) {
        throw new Error('[VK_BROWSER_JOB_PERMISSIONS] Job file must be readable only by its owner (chmod 600)');
    }
    return JSON.parse(fs.readFileSync(jobFile, 'utf8')) as VkBrowserJob;
}

export async function runVkBrowserWorker(argv = process.argv.slice(2)) {
    const options = parseOptions(argv);
    fs.mkdirSync(options.profileDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(options.evidenceDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(options.profileDir, 0o700);
    fs.chmodSync(options.evidenceDir, 0o700);
    const job = readJob(options.jobFile);
    const context = await chromium.launchPersistentContext(options.profileDir, {
        channel: options.channel,
        headless: false,
        viewport: { width: 1440, height: 1000 }
    });
    try {
        const pages = context.pages();
        const page = pages[0] || await context.newPage();
        const result = await prepareVkBrowserPublication(job, {
            ui: new PlaywrightVkBrowserUi(page),
            approvedAssetRoots: options.assetRoots,
            evidenceDir: options.evidenceDir
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result;
    } finally {
        await context.close();
    }
}

if (require.main === module) {
    runVkBrowserWorker().catch((error) => {
        process.stderr.write(`${String(error?.message || error)}\n`);
        process.exitCode = 1;
    });
}
