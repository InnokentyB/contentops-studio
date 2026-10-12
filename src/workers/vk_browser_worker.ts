import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, type BrowserContext } from 'playwright';
import { PlaywrightVkBrowserUi } from '../services/vk_browser_playwright_ui';
import {
    prepareVkBrowserPublication,
    submitVkBrowserPublication,
    type VkBrowserJob,
    type VkBrowserSubmissionControl
} from '../services/vk_browser_worker.service';

type Options = {
    jobFile: string;
    profileDir: string;
    evidenceDir: string;
    assetRoots: string[];
    channel: string;
    mcpEndpoint: string;
    mcpToken: string;
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
    const mcpEndpoint = valueAfter(argv, '--mcp-endpoint')
        || process.env.VK_BROWSER_MCP_ENDPOINT
        || 'https://planner-mcp-production.up.railway.app/mcp/publisher';
    const mcpToken = process.env.VK_BROWSER_MCP_TOKEN || '';

    if (!path.isAbsolute(jobFile) || !path.isAbsolute(profileDir) || !path.isAbsolute(evidenceDir)) {
        throw new Error('[VK_BROWSER_CONFIG_INVALID] Job, profile and evidence paths must be absolute');
    }
    const assetRoots = [...rootsFromArgs, ...rootsFromEnv];
    if (assetRoots.some((root) => !path.isAbsolute(root))) {
        throw new Error('[VK_BROWSER_CONFIG_INVALID] Approved asset roots must be absolute');
    }
    return { jobFile, profileDir, evidenceDir, assetRoots, channel, mcpEndpoint, mcpToken };
}

function readJob(jobFile: string): VkBrowserJob {
    const stat = fs.statSync(jobFile);
    if (!stat.isFile()) throw new Error('[VK_BROWSER_JOB_INVALID] Job path must be a file');
    if ((stat.mode & 0o077) !== 0) {
        throw new Error('[VK_BROWSER_JOB_PERMISSIONS] Job file must be readable only by its owner (chmod 600)');
    }
    return JSON.parse(fs.readFileSync(jobFile, 'utf8')) as VkBrowserJob;
}

function toolPayload(result: any) {
    const textBlock = result?.content?.find((block: any) => block.type === 'text');
    if (!textBlock?.text) throw new Error('[VK_BROWSER_MCP_RESPONSE_INVALID] Planner returned no structured result');
    let parsed: any;
    try {
        parsed = JSON.parse(textBlock.text);
    } catch {
        throw new Error('[VK_BROWSER_MCP_RESPONSE_INVALID] Planner returned invalid JSON');
    }
    if (result.isError) throw new Error(parsed?.error || parsed?.message || '[VK_BROWSER_MCP_CALL_FAILED]');
    return parsed;
}

async function connectSubmissionControl(options: Options) {
    if (!options.mcpToken.trim()) {
        throw new Error('[VK_BROWSER_MCP_TOKEN_REQUIRED] Submit mode requires a Publisher MCP token');
    }
    const endpoint = new URL(options.mcpEndpoint);
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== '127.0.0.1' && endpoint.hostname !== 'localhost') {
        throw new Error('[VK_BROWSER_MCP_ENDPOINT_INVALID] Publisher MCP endpoint must use HTTPS');
    }
    const client = new Client({ name: 'contentops-vk-browser-worker', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: `Bearer ${options.mcpToken}` } }
    });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown>) => toolPayload(await client.callTool({
        name,
        arguments: args
    }));
    const control: VkBrowserSubmissionControl = {
        start: (args: any) => call('ba_start_vk_browser_submission', {
            projectId: args.project_id,
            taskId: args.task_id,
            channelId: args.channel_id,
            actorId: 'user:0',
            workItemId: args.work_item_id,
            leaseToken: args.lease_token,
            approvalReference: args.approval_reference,
            idempotencyKey: args.idempotency_key,
            contentRevision: args.content_revision,
            textSha256: args.text_sha256,
            titleSha256: args.title_sha256,
            imageSha256: args.image_sha256,
            selectedAssetId: args.selected_asset_id,
            placement: args.placement
        }),
        confirm: (args: any) => call('ba_confirm_vk_browser_submission', {
            projectId: args.project_id,
            taskId: args.task_id,
            channelId: args.channel_id,
            actorId: 'user:0',
            workItemId: args.work_item_id,
            leaseToken: args.lease_token,
            approvalReference: args.approval_reference,
            idempotencyKey: args.idempotency_key,
            contentRevision: args.content_revision,
            textSha256: args.text_sha256,
            titleSha256: args.title_sha256,
            imageSha256: args.image_sha256,
            selectedAssetId: args.selected_asset_id,
            placement: args.placement,
            attemptId: args.attempt_id,
            publicUrl: args.public_url,
            providerObjectId: args.provider_object_id,
            publishedAt: args.published_at,
            evidenceSha256: args.evidence_sha256,
            providerKind: args.provider_kind,
            providerTimestampSource: args.provider_timestamp_source,
            clipBaselineCapturedAt: args.clip_baseline_captured_at,
            clipBaselineObjectIds: args.clip_baseline_object_ids,
            clipSubmissionStartedAt: args.clip_submission_started_at,
            readbackObservedAt: args.readback_observed_at,
            clipMediaSha256: args.clip_media_sha256
        }),
        markUncertain: (args: any) => call('ba_mark_vk_browser_submission_uncertain', {
            projectId: args.project_id,
            taskId: args.task_id,
            actorId: 'user:0',
            workItemId: args.work_item_id,
            leaseToken: args.lease_token,
            attemptId: args.attempt_id,
            reasonCode: args.reason_code,
            idempotencyKey: args.idempotency_key
        }).then(() => undefined)
    };
    return { client, control };
}

export async function runVkBrowserWorker(argv = process.argv.slice(2)) {
    const options = parseOptions(argv);
    fs.mkdirSync(options.profileDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(options.evidenceDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(options.profileDir, 0o700);
    fs.chmodSync(options.evidenceDir, 0o700);
    const job = readJob(options.jobFile);
    if (job.execution?.mode === 'prepare_only') {
        const result = await prepareVkBrowserPublication(job, {
            approvedAssetRoots: options.assetRoots,
            evidenceDir: options.evidenceDir
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result;
    }

    // No provider contract has been verified for the real Clip editor yet.
    if (job.target?.placement === 'clip') throw new Error('[VK_CLIP_UI_UNVERIFIED]');
    const planner = await connectSubmissionControl(options);
    let context: BrowserContext | undefined;
    try {
        context = await chromium.launchPersistentContext(options.profileDir, {
            channel: options.channel,
            headless: false,
            viewport: { width: 1440, height: 1000 }
        });
        const pages = context.pages();
        const page = pages[0] || await context.newPage();
        const result = await submitVkBrowserPublication(job, {
            ui: new PlaywrightVkBrowserUi(page),
            control: planner.control,
            approvedAssetRoots: options.assetRoots,
            evidenceDir: options.evidenceDir
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result;
    } finally {
        try { await context?.close(); }
        finally { await planner.client.close(); }
    }
}

if (require.main === module) {
    runVkBrowserWorker().catch((error) => {
        process.stderr.write(`${String(error?.message || error)}\n`);
        process.exitCode = 1;
    });
}
