import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    prepareVkBrowserPublication,
    submitVkBrowserPublication,
    type VkBrowserJob,
    type VkBrowserUi
} from '../services/vk_browser_worker.service';
import { PlaywrightVkBrowserUi } from '../services/vk_browser_playwright_ui';
import { runVkBrowserWorker } from '../workers/vk_browser_worker';

function fixture(imagePath: string, overrides: Partial<VkBrowserJob> = {}): VkBrowserJob {
    return {
        schema_version: 1,
        job_id: 'vk-browser:10:900:r3',
        project_id: 10,
        task_id: 900,
        channel_id: 120,
        idempotency_key: 'vk-browser:10:900:r3',
        target: {
            community_url: 'https://vk.com/analystcraft',
            placement: 'wall_post'
        },
        payload: {
            text: '  Accepted VK publication text  ',
            image_path: imagePath
        },
        approval: {
            content_revision: 3,
            accepted_revision: 3,
            text_state: 'accepted',
            visual_state: 'APPROVED',
            selected_asset_id: 18
        },
        execution: { mode: 'prepare_only' },
        ...overrides
    };
}

function fakeUi(loginRequired = false) {
    const calls: Array<{ operation: string; value?: string }> = [];
    const ui: VkBrowserUi = {
        navigate: async (url) => { calls.push({ operation: 'navigate', value: url }); },
        loginRequired: async () => loginRequired,
        openWallComposer: async () => { calls.push({ operation: 'open_composer' }); },
        setPostText: async (text) => { calls.push({ operation: 'set_text', value: text }); },
        attachImage: async (imagePath) => { calls.push({ operation: 'attach_image', value: imagePath }); },
        captureScreenshot: async (screenshotPath) => {
            calls.push({ operation: 'screenshot', value: screenshotPath });
            fs.writeFileSync(screenshotPath, 'png-evidence');
        }
    };
    return { ui, calls };
}

test('local VK worker prepare-only validates the exact approved payload without touching VK', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-test-'));
    const imagePath = path.join(root, 'approved.png');
    const evidenceDir = path.join(root, 'evidence');
    fs.writeFileSync(imagePath, 'approved-image');
    const { ui, calls } = fakeUi();

    const result = await prepareVkBrowserPublication(fixture(imagePath), {
        ui,
        approvedAssetRoots: [root],
        evidenceDir,
        now: () => new Date('2026-10-05T12:00:00.000Z')
    });

    assert.deepEqual(calls, []);
    assert.equal(result.status, 'prepared_not_submitted');
    assert.equal(result.route_trace.final_adapter, 'vk_browser_local');
    assert.equal(result.route_trace.asset_resolution, 'local_approved_file');
    assert.equal(result.payload.text_length, 'Accepted VK publication text'.length);
    assert.match(result.payload.text_sha256, /^[a-f0-9]{64}$/);
    assert.match(result.payload.image_sha256 || '', /^[a-f0-9]{64}$/);
    assert.equal('text' in (result as any).payload, false);
    assert.equal(result.evidence.screenshot_path, null);
    assert.equal(result.evidence.provider_upload, false);
});

test('local VK worker materializes the approved HTTPS asset before opening the composer', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-remote-'));
    const { ui, calls } = fakeUi();
    const job = fixture('', {
        payload: {
            text: 'Accepted remote-image post',
            image_url: 'https://cdn.example/approved.png'
        }
    });
    const requested: string[] = [];
    const result = await prepareVkBrowserPublication(job, {
        ui,
        approvedAssetRoots: [],
        evidenceDir: path.join(root, 'evidence'),
        loadRemoteImage: async (url) => {
            requested.push(url);
            return { buffer: Buffer.from('remote-approved-image'), filename: 'approved.png' };
        }
    });

    assert.deepEqual(requested, ['https://cdn.example/approved.png']);
    assert.deepEqual(calls, []);
    const assets = fs.readdirSync(path.join(root, 'evidence', 'assets'));
    assert.equal(assets.length, 1);
    assert.equal(fs.readFileSync(path.join(root, 'evidence', 'assets', assets[0]), 'utf8'), 'remote-approved-image');
    assert.equal(result.route_trace.asset_resolution, 'https_approved_asset');
    assert.doesNotMatch(JSON.stringify(result), /cdn\.example/);
});

test('local VK worker rejects ambiguous image sources', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-ambiguous-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            payload: {
                text: 'Accepted text',
                image_path: imagePath,
                image_url: 'https://cdn.example/approved.png'
            }
        }), {
            ui: fakeUi().ui,
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence')
        }),
        /VK_BROWSER_ASSET_AMBIGUOUS/
    );
});

test('local VK worker never attaches an image without its approved asset binding', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-unbound-'));
    const imagePath = path.join(root, 'unbound.png');
    fs.writeFileSync(imagePath, 'image');
    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            approval: {
                content_revision: 3,
                accepted_revision: 3,
                text_state: 'accepted',
                visual_state: 'APPROVED',
                selected_asset_id: null
            }
        }), {
            ui: fakeUi().ui,
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence')
        }),
        /VK_BROWSER_ASSET_BINDING_REQUIRED/
    );
});

test('local VK worker prepare-only does not require a live browser session', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-login-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const { ui, calls } = fakeUi(true);

    const result = await prepareVkBrowserPublication(fixture(imagePath), {
        ui,
        approvedAssetRoots: [root],
        evidenceDir: path.join(root, 'evidence')
    });
    assert.equal(result.status, 'prepared_not_submitted');
    assert.deepEqual(calls, []);
});

test('local VK worker refuses unapproved, stale or live-submit jobs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-guards-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const dependencies = { ui: fakeUi().ui, approvedAssetRoots: [root], evidenceDir: path.join(root, 'evidence') };

    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            approval: { content_revision: 4, accepted_revision: 3, text_state: 'accepted', visual_state: 'APPROVED', selected_asset_id: 18 }
        }), dependencies),
        /VK_BROWSER_APPROVAL_REQUIRED/
    );
    await assert.rejects(
        prepareVkBrowserPublication(fixture(imagePath, {
            execution: { mode: 'submit' as 'prepare_only' }
        }), dependencies),
        /VK_BROWSER_PREPARE_MODE_REQUIRED/
    );
});

test('local VK worker constrains target host and approved asset roots', async () => {
    const approvedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-approved-'));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-outside-'));
    const outsideImage = path.join(outsideRoot, 'not-approved.png');
    fs.writeFileSync(outsideImage, 'image');
    const dependencies = {
        ui: fakeUi().ui,
        approvedAssetRoots: [approvedRoot],
        evidenceDir: path.join(approvedRoot, 'evidence')
    };

    await assert.rejects(
        prepareVkBrowserPublication(fixture(outsideImage), dependencies),
        /VK_BROWSER_ASSET_OUTSIDE_APPROVED_ROOT/
    );
    await assert.rejects(
        prepareVkBrowserPublication(fixture(outsideImage, {
            target: { community_url: 'https://example.com/analystcraft', placement: 'wall_post' }
        }), dependencies),
        /VK_BROWSER_TARGET_INVALID/
    );
});

test('local VK worker evidence never includes cookies, profile data or publication text', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-redaction-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const { ui } = fakeUi();
    const result = await prepareVkBrowserPublication(fixture(imagePath), {
        ui,
        approvedAssetRoots: [root],
        evidenceDir: path.join(root, 'evidence')
    });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /Accepted VK publication text/);
    assert.doesNotMatch(serialized, /cookie|storage_state|profile_dir/i);
});

test('current VK community UI opens the wall composer through Create then Post', async () => {
    const calls: string[] = [];
    const hiddenLegacyButton = { isVisible: async () => false };
    const createButton = {
        waitFor: async () => { calls.push('create_visible'); },
        click: async () => { calls.push('create'); }
    };
    const postOption = {
        click: async (options: { timeout: number }) => {
            assert.equal(options.timeout, 15_000);
            calls.push('post');
        }
    };
    const editor = {
        isVisible: async () => true,
        waitFor: async () => { calls.push('editor_visible'); },
        click: async () => { calls.push('editor'); }
    };
    const page = {
        getByRole: () => ({ first: () => hiddenLegacyButton }),
        locator: (selector: string) => ({
            first: () => selector === '[data-testid="group_publish_create_button"]'
                ? createButton
                : selector === '[data-testid="group_publish_post_menu_item"]'
                    ? postOption
                : editor
        })
    };

    await new PlaywrightVkBrowserUi(page as any).openWallComposer();

    assert.deepEqual(calls, ['create_visible', 'create', 'post', 'editor_visible', 'editor']);
});

test('current VK contenteditable verifies exact visible text including paragraph breaks', async () => {
    let filled = '';
    const acceptedText = 'First paragraph\n\nSecond paragraph';
    const editor = {
        isVisible: async () => true,
        waitFor: async () => undefined,
        fill: async (value: string) => { filled = value; },
        inputValue: async () => { throw new Error('contenteditable'); },
        innerText: async () => acceptedText
    };
    const page = {
        locator: () => ({ first: () => editor })
    };

    await new PlaywrightVkBrowserUi(page as any).setPostText(acceptedText);

    assert.equal(filled, acceptedText);
});

test('current VK composer uses its own uploader and waits for a rendered preview', async () => {
    const calls: string[] = [];
    const currentInput = {
        waitFor: async (options: { state: string; timeout: number }) => {
            calls.push(`wait:${options.state}:${options.timeout}`);
        },
        setInputFiles: async (file: string) => { calls.push(`file:${file}`); }
    };
    const page = {
        locator: (selector: string) => ({
            first: () => {
                assert.equal(selector, 'input[data-testid="posting_base_screen_download_from_device"]');
                return currentInput;
            }
        }),
        waitForFunction: async () => ({ jsonValue: async () => 'ready' })
    };

    await new PlaywrightVkBrowserUi(page as any).attachImage('/approved/task-1019.jpg');

    assert.deepEqual(calls, [
        'wait:attached:5000',
        'wait:attached:15000',
        'file:/approved/task-1019.jpg'
    ]);
});

test('current VK composer submits through the page-level posting submit control', async () => {
    const calls: string[] = [];
    const next = { click: async () => { calls.push('next'); } };
    const publish = {
        waitFor: async () => { calls.push('publish_visible'); },
        click: async () => { calls.push('publish'); }
    };
    const page = {
        getByRole: () => ({ last: () => next }),
        locator: (selector: string) => ({
            last: () => {
                assert.equal(selector, '[data-testid="posting_submit_button"]');
                return publish;
            }
        })
    };

    await new PlaywrightVkBrowserUi(page as any).submitPost();

    assert.deepEqual(calls, ['next', 'publish_visible', 'publish_visible', 'publish']);
});

function submitFixture(imagePath: string) {
    return fixture(imagePath, {
        target: {
            community_url: 'https://vk.com/club240051152',
            placement: 'wall_post',
            community_id: -240051152
        } as any,
        execution: {
            mode: 'submit',
            authorization: {
                work_item_id: 501,
                lease_token: 'lease-owner-released-vk',
                approval_reference: 'owner-approved-task-900',
                attempt_idempotency_key: 'vk-browser-submit:10:900:r3'
            }
        } as any
    } as any);
}

test('VK browser submit requires durable authorization before opening the provider composer', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-no-auth-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const job = submitFixture(imagePath) as any;
    delete job.execution.authorization.lease_token;

    await assert.rejects(
        submitVkBrowserPublication(job, {
            ui: fakeUi().ui,
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence'),
            control: {} as any
        }),
        /VK_BROWSER_SUBMIT_AUTHORIZATION_REQUIRED/
    );
});

test('VK browser submit starts one durable attempt, verifies exact readback, then confirms', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-submit-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const trace: string[] = [];
    const acceptedText = 'Accepted VK publication text';
    const ui = {
        navigate: async (url: string) => {
            assert.equal(url, 'https://vk.com/club240051152');
            trace.push('navigate');
        },
        loginRequired: async () => false,
        openWallComposer: async () => { trace.push('open'); },
        setPostText: async (text: string) => {
            assert.equal(text, acceptedText);
            trace.push('text');
        },
        attachImage: async () => { trace.push('upload'); },
        captureScreenshot: async (file: string) => {
            fs.writeFileSync(file, 'evidence');
            trace.push('screenshot');
        },
        submitPost: async () => { trace.push('submit'); },
        readbackPost: async () => {
            trace.push('readback');
            return {
                public_url: 'https://vk.ru/wall-240051152_13',
                provider_object_id: '-240051152_13',
                published_at: '2026-10-06T10:00:00.000Z',
                text: acceptedText,
                image_present: true
            };
        }
    };
    const control = {
        start: async () => {
            trace.push('start');
            return { status: 'started' as const, attempt_id: 77 };
        },
        confirm: async (args: any) => {
            trace.push('confirm');
            assert.equal(args.attempt_id, 77);
            assert.equal(args.public_url, 'https://vk.ru/wall-240051152_13');
            return { publication_fact_id: 901 };
        },
        markUncertain: async () => { trace.push('uncertain'); }
    };

    const result = await submitVkBrowserPublication(submitFixture(imagePath) as any, {
        ui: ui as any,
        control,
        approvedAssetRoots: [root],
        evidenceDir: path.join(root, 'evidence')
    });

    assert.deepEqual(trace, [
        'navigate', 'open', 'text', 'start', 'upload', 'screenshot',
        'submit', 'readback', 'confirm'
    ]);
    assert.equal(result.status, 'confirmed_published');
    assert.equal(result.publication_fact_id, 901);
});

test('VK browser readback accepts provider-added blank lines without changing words', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-newlines-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const job = submitFixture(imagePath);
    job.payload.text = 'First paragraph\n\nSecond paragraph';
    let confirmed = false;
    const result = await submitVkBrowserPublication(job, {
        approvedAssetRoots: [root],
        evidenceDir: path.join(root, 'evidence'),
        ui: {
            navigate: async () => undefined,
            loginRequired: async () => false,
            openWallComposer: async () => undefined,
            setPostText: async () => undefined,
            attachImage: async () => undefined,
            captureScreenshot: async (file: string) => fs.writeFileSync(file, 'evidence'),
            submitPost: async () => undefined,
            readbackPost: async () => ({
                public_url: 'https://vk.com/wall-240051152_30',
                provider_object_id: '-240051152_30',
                published_at: '2026-10-06T16:35:34.018Z',
                text: 'First paragraph\n\n\nSecond paragraph',
                image_present: true
            })
        },
        control: {
            start: async () => ({ status: 'started' as const, attempt_id: 30 }),
            confirm: async () => { confirmed = true; return { publication_fact_id: 902 }; },
            markUncertain: async () => { throw new Error('must not freeze equivalent VK text'); }
        }
    });
    assert.equal(result.publication_fact_id, 902);
    assert.equal(confirmed, true);
});

test('VK browser submit freezes an ambiguous provider result and never confirms it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-uncertain-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    let confirmed = false;
    let uncertain = false;
    const ui = {
        navigate: async () => undefined,
        loginRequired: async () => false,
        openWallComposer: async () => undefined,
        setPostText: async () => undefined,
        attachImage: async () => undefined,
        captureScreenshot: async (file: string) => fs.writeFileSync(file, 'evidence'),
        submitPost: async () => undefined,
        readbackPost: async () => null
    };

    await assert.rejects(
        submitVkBrowserPublication(submitFixture(imagePath) as any, {
            ui: ui as any,
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence'),
            control: {
                start: async () => ({ status: 'started' as const, attempt_id: 78 }),
                confirm: async () => { confirmed = true; return { publication_fact_id: 1 }; },
                markUncertain: async () => { uncertain = true; }
            }
        }),
        /VK_BROWSER_READBACK_UNCONFIRMED/
    );
    assert.equal(uncertain, true);
    assert.equal(confirmed, false);
});

test('VK browser composer failure happens before a durable attempt or provider upload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-pre-provider-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const calls: string[] = [];

    await assert.rejects(
        submitVkBrowserPublication(submitFixture(imagePath), {
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence'),
            ui: {
                navigate: async () => { calls.push('navigate'); },
                loginRequired: async () => false,
                openWallComposer: async () => {
                    calls.push('composer');
                    throw new Error('[VK_BROWSER_COMPOSER_NOT_FOUND]');
                },
                setPostText: async () => { calls.push('text'); },
                attachImage: async () => { calls.push('upload'); },
                captureScreenshot: async () => { calls.push('screenshot'); },
                submitPost: async () => { calls.push('submit'); },
                readbackPost: async () => null
            },
            control: {
                start: async () => {
                    calls.push('start');
                    return { status: 'started' as const, attempt_id: 79 };
                },
                confirm: async () => ({ publication_fact_id: 1 }),
                markUncertain: async () => { calls.push('uncertain'); }
            }
        }),
        /VK_BROWSER_COMPOSER_NOT_FOUND/
    );
    assert.deepEqual(calls, ['navigate', 'composer']);
});

test('VK browser submit never retries an existing unresolved provider attempt', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-no-retry-'));
    const imagePath = path.join(root, 'approved.png');
    fs.writeFileSync(imagePath, 'approved-image');
    const job = submitFixture(imagePath);
    const calls: string[] = [];
    await assert.rejects(
        submitVkBrowserPublication(job, {
            approvedAssetRoots: [root],
            evidenceDir: path.join(root, 'evidence'),
            ui: {
                navigate: async () => { calls.push('navigate'); },
                loginRequired: async () => false,
                openWallComposer: async () => { calls.push('composer'); },
                setPostText: async () => { calls.push('text'); },
                attachImage: async () => { calls.push('image'); },
                captureScreenshot: async () => { calls.push('screenshot'); },
                submitPost: async () => { calls.push('submit'); },
                readbackPost: async () => null
            },
            control: {
                start: async () => ({
                    status: 'verification_required',
                    attempt_id: 77,
                    retry_allowed: false
                }),
                confirm: async () => {
                    throw new Error('confirm must not run');
                },
                markUncertain: async () => {
                    throw new Error('mark uncertain must not run for a pre-existing attempt');
                }
            }
        }),
        /VK_BROWSER_EXISTING_ATTEMPT_REQUIRES_RECONCILIATION/
    );
    assert.deepEqual(calls, ['navigate', 'composer', 'text']);
});

test('CLI prepare-only runs locally without opening Chrome or requiring an MCP token', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-cli-prepare-'));
    const imagePath = path.join(root, 'approved.png');
    const jobPath = path.join(root, 'job.json');
    fs.writeFileSync(imagePath, 'approved-image');
    fs.writeFileSync(jobPath, JSON.stringify(fixture(imagePath)), { mode: 0o600 });
    fs.chmodSync(jobPath, 0o600);
    const previousToken = process.env.VK_BROWSER_MCP_TOKEN;
    delete process.env.VK_BROWSER_MCP_TOKEN;
    try {
        const result = await runVkBrowserWorker([
            '--job', jobPath,
            '--profile-dir', path.join(root, 'profile'),
            '--evidence-dir', path.join(root, 'evidence'),
            '--asset-root', root
        ]);
        assert.equal(result.status, 'prepared_not_submitted');
        assert.equal(result.evidence.provider_upload, false);
    } finally {
        if (previousToken === undefined) delete process.env.VK_BROWSER_MCP_TOKEN;
        else process.env.VK_BROWSER_MCP_TOKEN = previousToken;
    }
});

test('CLI submit refuses to open Chrome without a Publisher MCP token', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-worker-cli-submit-'));
    const imagePath = path.join(root, 'approved.png');
    const jobPath = path.join(root, 'job.json');
    fs.writeFileSync(imagePath, 'approved-image');
    fs.writeFileSync(jobPath, JSON.stringify(submitFixture(imagePath)), { mode: 0o600 });
    fs.chmodSync(jobPath, 0o600);
    const previousToken = process.env.VK_BROWSER_MCP_TOKEN;
    delete process.env.VK_BROWSER_MCP_TOKEN;
    try {
        await assert.rejects(
            runVkBrowserWorker([
                '--job', jobPath,
                '--profile-dir', path.join(root, 'profile'),
                '--evidence-dir', path.join(root, 'evidence'),
                '--asset-root', root
            ]),
            /VK_BROWSER_MCP_TOKEN_REQUIRED/
        );
    } finally {
        if (previousToken === undefined) delete process.env.VK_BROWSER_MCP_TOKEN;
        else process.env.VK_BROWSER_MCP_TOKEN = previousToken;
    }
});
