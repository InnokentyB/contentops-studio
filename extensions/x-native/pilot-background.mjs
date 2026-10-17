import { publicInstallation, readProof, receiptProof, pairingProof, textSha } from './native-wire.mjs';
import { validatePackage, validateChallenge, assertSamePackage, journalKey } from './package.mjs';
import { journal } from './store.mjs';
import { nativeClickOnce } from './pilot-click.mjs';
const API = 'https://publishplanner-production.up.railway.app/api/integrations/x-native/';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let heartbeatState = null;
async function request(operation, value) {
    if (!['read', 'advance', 'receipt', 'reconcile', 'refresh', 'pair-read', 'pair-receipt', 'heartbeat'].includes(operation)) throw Error('LOCAL_OPERATION_INVALID');
    if (operation !== 'heartbeat' && heartbeatState?.failed) throw Error('LOCAL_HEARTBEAT_FAILED');
    const response = await fetch(`${API}${operation}`, { method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error('PLANNER_REQUEST_BLOCKED');
    return response.json();
}
async function target() {
    const tabs = await chrome.tabs.query({ url: 'https://x.com/*', lastFocusedWindow: true });
    if (tabs.length !== 1 || !Number.isInteger(tabs[0].id)) throw Error('NATIVE_TAB_AMBIGUOUS');
    return tabs[0].id;
}
async function navigate(tab, url, expected) {
    if (![expected.profileUrl, 'https://x.com/compose/post'].includes(url)) throw Error('NATIVE_TARGET_INVALID');
    await chrome.tabs.update(tab, { url });
    for (let count = 0; count < 75; count++) {
        const state = await chrome.tabs.get(tab);
        if (state.status === 'complete' && state.url === url) return;
        await wait(200);
    }
    throw Error('NATIVE_NAVIGATION_TIMEOUT');
}
async function native(tab, operation, text, expected, permit) {
    const result = await chrome.tabs.sendMessage(tab, { operation, text, packageData: expected, ...(permit ? { permit } : {}) });
    if (result?.ok !== true) throw Error(/^NATIVE_[A-Z0-9_]+$/.test(result?.code || '') ? result.code : 'NATIVE_SURFACE_BLOCKED');
    return result.value;
}
async function prepare(tab, text, expected) {
    if (typeof text !== 'string' || text.length < 1 || text.length > 280 || await textSha(text) !== expected.bodySha256) throw Error('LOCAL_BODY_MISMATCH');
    await navigate(tab, expected.profileUrl, expected);
    const history = await native(tab, 'history', text, expected);
    await navigate(tab, 'https://x.com/compose/post', expected);
    // Native reader only compares the existing draft. It never replaces unknown content.
    return { ...await native(tab, 'editor', text, expected), ...history };
}
function checkedStage(stage, expected) {
    validateChallenge(stage?.challenge); assertSamePackage(stage.challenge, expected);
    if (stage.challenge.purpose === 'pair' || typeof stage.accepted_text !== 'string') throw Error('LOCAL_STAGE_INVALID');
    return stage;
}
function heartbeatStage(stage) {
    if (heartbeatState) { heartbeatState.nonce = stage.challenge.nonce; heartbeatState.packageData = validatePackage(stage.challenge); }
}
async function signedRequest(operation, nonce, expected) {
    return request(operation, await readProof(nonce, operation, expected));
}
function publicResult(value) {
    // Never serialize raw execution context, lease, challenges, accepted text or permits into the page.
    const mode = ['published', 'unknown', 'reconciliation_required', 'reconcile_only', 'prestart_recovery'].includes(value?.mode)
        ? value.mode : 'reconciliation_required';
    const result = { mode, submission_permitted: false };
    if (mode === 'published' && typeof value.public_url === 'string'
        && /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9]\d*$/.test(value.public_url)) result.public_url = value.public_url;
    return result;
}
async function readResult(tab, stage, expected) {
    await navigate(tab, expected.profileUrl, expected);
    let observation;
    try { observation = await native(tab, 'result', stage.accepted_text, expected); }
    catch { observation = { kind: 'unknown', observedAt: new Date().toISOString(), reason: 'native_gap' }; }
    return observation;
}
async function reconcile(tab, flight, expected) {
    const stage = await signedRequest('reconcile', flight.nonce, expected);
    if (stage.mode === 'published' || stage.mode === 'prestart_recovery') return publicResult(stage);
    checkedStage(stage, expected);
    if (stage.challenge.phase !== 'reconcile') throw Error('LOCAL_RECONCILE_MODE_INVALID');
    const observation = await readResult(tab, stage, expected);
    const fresh = checkedStage(await signedRequest('reconcile', flight.nonce, expected), expected);
    if (fresh.challenge.phase !== 'reconcile') throw Error('LOCAL_RECONCILE_MODE_INVALID');
    return publicResult(await request('receipt', { receipt: await receiptProof(fresh.challenge, observation) }));
}
async function persistFlight(expected, flight, add = false) {
    await journal(add ? 'add' : 'put', journalKey('flight', { ...expected, releaseKeySha256: flight.releaseKeySha256 }), flight);
    await journal(add ? 'add' : 'put', journalKey('index', expected), flight);
}
async function run(nonce, expected) {
    const tab = await target();
    const existing = await journal('get', journalKey('index', expected));
    if (existing) return reconcile(tab, existing, expected);
    let stage = checkedStage(await signedRequest('read', nonce, expected), expected);
    heartbeatStage(stage);
    if (stage.challenge.phase !== 'start' || stage.challenge.attemptId !== null) throw Error('LOCAL_START_REQUIRED');
    const releaseKeySha256 = stage.challenge.releaseKeySha256;
    if (await journal('get', journalKey('release-click', { ...expected, releaseKeySha256 }))) throw Error('LOCAL_RECONCILE_ONLY');
    const first = await prepare(tab, stage.accepted_text, expected);
    if (Date.now() >= Date.parse(stage.challenge.expiresAt)) stage = checkedStage(await signedRequest('refresh', stage.challenge.nonce, expected), expected);
    if (stage.challenge.phase !== 'start' || stage.challenge.attemptId !== null || stage.challenge.releaseKeySha256 !== releaseKeySha256) throw Error('LOCAL_START_REQUIRED');
    heartbeatStage(stage);
    // Persist before server start. Lost acknowledgements or crash can only reconcile, never restart.
    await persistFlight(expected, { nonce: stage.challenge.nonce, releaseKeySha256, state: 'starting' }, true);
    await request('receipt', { receipt: await receiptProof(stage.challenge, first) });
    const finalStage = checkedStage(await signedRequest('advance', stage.challenge.nonce, expected), expected);
    heartbeatStage(finalStage);
    if (finalStage.challenge.phase !== 'permit' || finalStage.challenge.releaseKeySha256 !== releaseKeySha256) throw Error('LOCAL_RECONCILE_ONLY');
    await persistFlight(expected, { nonce: finalStage.challenge.nonce, releaseKeySha256, state: 'attempt_started', attemptId: finalStage.challenge.attemptId });
    const observation = { ...await native(tab, 'editor', stage.accepted_text, expected), historyFrom: first.historyFrom,
        historyThrough: first.historyThrough, historyComplete: first.historyComplete,
        duplicateFound: first.duplicateFound, scannedStatuses: first.scannedStatuses };
    const permit = await request('receipt', { receipt: await receiptProof(finalStage.challenge, observation) });
    await nativeClickOnce({ ...expected, releaseKeySha256, attemptId: finalStage.challenge.attemptId, serverAttemptId: permit.attempt_id,
        nonce: finalStage.challenge.nonce, expiresAt: permit.expires_at, submissionPermitted: permit.submission_permitted }, () => {
        if (heartbeatState?.failed) throw Error('LOCAL_HEARTBEAT_FAILED');
        return native(tab, 'click', stage.accepted_text, expected, { attemptId: finalStage.challenge.attemptId, expiresAt: permit.expires_at });
    });
    const observed = await readResult(tab, finalStage, expected);
    const resultStage = checkedStage(await signedRequest('advance', finalStage.challenge.nonce, expected), expected);
    heartbeatStage(resultStage);
    if (resultStage.challenge.phase !== 'result') throw Error('LOCAL_RECONCILE_ONLY');
    return publicResult(await request('receipt', { receipt: await receiptProof(resultStage.challenge, observed) }));
}
let active = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('pilot.html')) return false;
    if (!message || !['identity', 'uat', 'run', 'readiness', 'reconcile'].includes(message.operation)) return false;
    if (active) { respond({ code: 'LOCAL_SINGLE_FLIGHT', retry_allowed: false }); return false; }
    active = true;
    const heartbeat = message.operation === 'run' ? { nonce: null, packageData: null, failed: false } : null;
    heartbeatState = heartbeat;
    const timer = heartbeat ? setInterval(() => {
        if (!heartbeat.nonce || heartbeat.failed) return;
        signedRequest('heartbeat', heartbeat.nonce, heartbeat.packageData).catch(() => { heartbeat.failed = true; });
    }, 60000) : null;
    (async () => {
        if (message.operation === 'identity') return { ...await publicInstallation(), extensionId: chrome.runtime.id, publication_authorized: false };
        const expected = validatePackage(message.packageData);
        if (message.operation === 'uat') {
            const pairing = message.nonce ? await request('pair-read', await readProof(message.nonce, 'pair', expected)) : null;
            if (pairing) { validateChallenge(pairing.challenge); assertSamePackage(pairing.challenge, expected); }
            const observation = await prepare(await target(), pairing?.accepted_text || message.text, expected);
            if (pairing && !pairing.already_verified) await request('pair-receipt', await pairingProof(pairing.challenge, observation));
            return { no_send: true, account: observation.account, body_sha256: await textSha(observation.text),
                history_complete: observation.historyComplete, pairing_verified: Boolean(pairing), publication_authorized: false };
        }
        if (message.operation === 'readiness') {
            const flight = await journal('get', journalKey('index', expected));
            if (flight) return { ready: false, submission_permitted: false, reconcile_only: true };
            const stage = checkedStage(await signedRequest('read', message.nonce, expected), expected);
            return { ready: stage.challenge.phase === 'start' && stage.challenge.attemptId === null,
                task_id: stage.challenge.taskId, expires_at: stage.challenge.expiresAt, submission_permitted: false };
        }
        if (message.operation === 'reconcile') {
            const flight = await journal('get', journalKey('index', expected));
            if (!flight) throw Error('LOCAL_NO_STARTED_ATTEMPT');
            return reconcile(await target(), flight, expected);
        }
        return run(message.nonce, expected);
    })().then(value => respond(value), error => respond({ code: error instanceof Error && /^(LOCAL|NATIVE|PLANNER)_[A-Z0-9_]+$/.test(error.message)
        ? error.message : 'LOCAL_EXECUTION_STOPPED', retry_allowed: false,
        next_action: 'Read Planner state and reconcile the same attempt; never clear the journal or resend.' }))
        .finally(() => { if (timer) clearInterval(timer); heartbeatState = null; active = false; });
    return true;
});
