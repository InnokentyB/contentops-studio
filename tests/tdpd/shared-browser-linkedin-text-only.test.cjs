const test = require('node:test'), assert = require('node:assert/strict');
const { textOnlyFixture } = require('./shared-linkedin-text-only.fixture.cjs');
const { sha } = require('./shared-browser.fixture.cjs');
const base = process.env.SHARED_BROWSER_DIST || '/opt/planner/dist';
const contract = require(base + '/services/browser_publication_contract.js');
const release = require(base + '/services/browser_publication_release.js');
const execute = require(base + '/services/browser_publication_execution.js');
const confirmation = require(base + '/services/browser_publication_confirmation.js');

async function started(accountType = 'personal') {
    const state = textOnlyFixture(accountType), { f, args, body } = state;
    await release.repairBrowserPublicationMetadata({ ...args, apply: true, idempotencyKey: 'repair' }, f);
    await release.releaseBrowserPublication({ ...args, apply: true }, f);
    const workItemId = f.state.work[0].id;
    const lease = await execute.claimBrowserPublication({ ...args, workItemId, idempotencyKey: 'claim' }, f);
    const send = { ...args, workItemId, leaseToken: lease.lease_token, idempotencyKey: 'one-send' };
    const start = await execute.startBrowserSubmission(send, f);
    const observed = { ...send, attemptId: start.attempt_id,
        observedProfileUrl: args.snapshot.identity.profileUrl, observedProviderAccountId: args.snapshot.identity.providerAccountId,
        observedAccountType: accountType, observedBodySha256: sha(body), observedAssetSha256: null, attachedImageCount: 0,
        paragraphBlockSha256: body.split(/\n\s*\n/).map(block => sha(block.trim())), duplicateAbsent: true, evidenceSha256: 'd'.repeat(64) };
    return { ...state, send, observed };
}
const writer = f => async args => f.db.$transaction(async tx => {
    await args.beforeWrite(tx);
    const fact = { id: 500, project_id: args.projectId, content_item_id: args.taskId, channel_id: f.state.task.channel_id,
        public_url: args.publicUrl, provider_object_id: args.providerObjectId, evidence_ref: args.evidence.ref };
    f.state.fact = fact; f.state.task.publication_fact = fact; f.state.task.status = 'published'; return { publication_fact: fact };
});

test('LI-TEXT-01: no-visual personal and company snapshots reach owner preview/repair/release without fake assets', async () => {
    for (const type of ['personal', 'company_page']) {
        const { f, args } = textOnlyFixture(type), before = structuredClone(f.state);
        assert.equal(contract.browserSnapshotSchema.safeParse(args.snapshot).success, true);
        assert.equal((await release.inspectBrowserPublication(args, f)).publication_authorized, false);
        assert.equal((await release.repairBrowserPublicationMetadata(args, f)).applied, false);
        assert.deepEqual(f.state, before);
        await release.repairBrowserPublicationMetadata({ ...args, apply: true, idempotencyKey: 'repair' }, f);
        const result = await release.releaseBrowserPublication({ ...args, apply: true }, f);
        assert.equal(result.publication_authorized, true); assert.equal(f.state.work.length, 1); assert.equal(f.state.attempts.length, 0);
        for (const key of ['draft_text', 'accepted_revision', 'content_revision', 'selected_asset_id', 'selected_asset',
            'schedule_at', 'publish_at', 'channel_id', 'art_direction_decisions']) assert.deepEqual(f.state.task[key], before.task[key]);
        assert.equal((await release.releaseBrowserPublication({ ...args, apply: true }, f)).replayed, true);
    }
});

test('LI-TEXT-02: null requires current exact NO_VISUAL_NEEDED decision, no required image and exact trusted context', async () => {
    for (const mutate of [s => s.f.state.task.visual_state = 'APPROVED', s => s.f.state.task.visual_mode = 'required',
        s => s.f.state.task.art_direction_decisions[0].decision = 'GENERATE',
        s => s.f.state.task.art_direction_decisions[0].status = 'superseded',
        s => s.f.state.task.art_direction_decisions[0].source_content_revision--,
        s => s.f.state.task.art_direction_decisions[0].project_id++,
        s => s.f.state.task.visual_decision_version++, s => s.f.state.task.selected_asset_id = 166,
        s => s.f.state.task.selected_asset = { id: 166 },
        s => s.f.state.task.channel.config.account_type = 'unknown', s => s.f.state.task.channel.config.account_ref = 'other',
        s => s.f.state.task.accepted_revision--, s => s.f.state.task.quality_report.publication_hold = true,
        s => s.f.state.owner = false, s => s.f.state.manifest = 'sha256:' + '0'.repeat(64)]) {
        const state = textOnlyFixture(); mutate(state); const before = structuredClone(state.f.state);
        await assert.rejects(release.inspectBrowserPublication(state.args, state.f)); assert.deepEqual(state.f.state, before);
    }
    for (const platform of ['devto', 'setka']) {
        const { args } = textOnlyFixture(); args.snapshot.identity.platform = platform;
        assert.equal(contract.browserSnapshotSchema.safeParse(args.snapshot).success, false);
    }
    for (const patch of [{ selectedAssetId: 166 }, { assetSha256: 'a'.repeat(64) }]) {
        const { args } = textOnlyFixture(); Object.assign(args.snapshot, patch);
        assert.equal(contract.browserSnapshotSchema.safeParse(args.snapshot).success, false);
    }
});

test('LI-TEXT-05: real MCP repair/release accepts the null pair and retains current canonical guards', async () => {
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    const { registerBrowserPublicationTools } = require(base + '/mcp/tools/browser_publication_tools.js');
    const { f, args } = textOnlyFixture();
    const methods = ['repairBrowserPublicationMetadata', 'releaseBrowserPublication'], originals = new Map();
    for (const method of methods) { originals.set(method, release[method]); release[method] = input => originals.get(method)(input, f); }
    const server = new McpServer({ name: 'synthetic-browser', version: '1' }), client = new Client({ name: 'synthetic-client', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
        registerBrowserPublicationTools(server); await server.connect(a); await client.connect(b);
        const repaired = await client.callTool({ name: 'ba_repair_browser_publication_metadata', arguments: { ...args, apply: true, idempotencyKey: 'repair' } });
        assert.notEqual(repaired.isError, true);
        const released = await client.callTool({ name: 'ba_release_browser_publication', arguments: { ...args, apply: true } });
        assert.notEqual(released.isError, true); assert.equal(f.state.work.length, 1); assert.equal(f.state.attempts.length, 0);
    } finally { for (const method of methods) release[method] = originals.get(method); await client.close(); await server.close(); }
});

test('LI-TEXT-06: missing legacy handoff materializes no image and no content/revision/date change', async () => {
    const { f, args, body } = textOnlyFixture(); delete f.state.task.quality_report.handoff_bundle;
    const before = structuredClone(f.state);
    const preview = await release.repairBrowserPublicationMetadata(args, f);
    assert.equal(preview.handoff_materialization.eligible, true); assert.deepEqual(f.state, before);
    await release.repairBrowserPublicationMetadata({ ...args, apply: true }, f);
    assert.equal(f.state.task.quality_report.handoff_bundle.publication.body, body);
    assert.equal(f.state.task.quality_report.handoff_bundle.publication.image_url ?? null, null);
    for (const key of ['draft_text', 'content_revision', 'accepted_revision', 'selected_asset_id', 'schedule_at', 'publish_at', 'channel_id']) {
        assert.deepEqual(f.state.task[key], before.task[key]);
    }
    for (const tooLong of ['', 'a'.repeat(3001)]) {
        const next = textOnlyFixture(); next.f.state.task.draft_text = tooLong;
        next.f.state.task.quality_report.handoff_bundle.publication.body = tooLong; next.args.snapshot.bodySha256 = sha(tooLong);
        await assert.rejects(release.inspectBrowserPublication(next.args, next.f), /BROWSER_SNAPSHOT_MISMATCH/);
    }
});

test('LI-TEXT-03: zero-image native observation permits once and confirms exact identity/body; image injection fails', async () => {
    for (const type of ['personal', 'company_page']) {
        const { f, send, observed } = await started(type), before = structuredClone(f.state);
        assert.equal(f.state.attempts.length, 1);
        for (const patch of [{ attachedImageCount: 1 }, { observedAssetSha256: 'a'.repeat(64) },
            { observedProviderAccountId: 'different' }, { observedAccountType: type === 'personal' ? 'company_page' : 'personal' },
            { observedBodySha256: '0'.repeat(64) }, { duplicateAbsent: false }]) {
            await assert.rejects(execute.preSubmitBrowserSubmission({ ...observed, ...patch }, f)); assert.deepEqual(f.state, before);
        }
        assert.equal((await execute.preSubmitBrowserSubmission(observed, f)).submission_permitted, true);
        assert.equal((await execute.preSubmitBrowserSubmission(observed, f)).submission_permitted, false);
        const confirmed = { ...observed, publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:987654321/',
            providerObjectId: 'urn:li:activity:987654321', publishedAt: new Date().toISOString() };
        await confirmation.confirmBrowserSubmission(confirmed, f, writer(f));
        assert.equal(f.state.attempts[0].status, 'delivered'); assert.ok(f.state.fact);
        const after = structuredClone(f.state);
        assert.equal((await confirmation.confirmBrowserSubmission(confirmed, f, writer(f))).replayed, true); assert.deepEqual(f.state, after);
    }
});

test('LI-TEXT-04: UNKNOWN remains same-attempt reconciliation, never another start or permit', async () => {
    const { f, send, observed } = await started(); await execute.preSubmitBrowserSubmission(observed, f);
    await execute.markBrowserSubmissionUncertain({ ...send, attemptId: observed.attemptId, reasonCode: 'PROVIDER_RESULT_UNCERTAIN' }, f);
    f.state.work[0].lease_expires_at = new Date(0);
    await assert.rejects(execute.preSubmitBrowserSubmission(observed, f));
    await assert.rejects(execute.startBrowserSubmission({ ...send, idempotencyKey: 'second-send' }, f));
    const { leaseToken, ...sameAttempt } = observed;
    const result = await confirmation.reconcileBrowserSubmission({ ...sameAttempt,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:987654321/', providerObjectId: 'urn:li:activity:987654321',
        publishedAt: new Date().toISOString() }, f, writer(f));
    assert.equal(result.retry_allowed, false); assert.equal(f.state.attempts.length, 1);
});
