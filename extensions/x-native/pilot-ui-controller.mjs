import { validatePackage } from './package.mjs';

const fields = ['projectId', 'taskId', 'channelId', 'revision', 'bodySha256', 'account', 'profileUrl', 'scheduleAt'];
export function parseInput(input) {
    if (typeof input.packageText !== 'string' || input.packageText.length > 4096) throw Error('LOCAL_PACKAGE_INVALID');
    let raw;
    try { raw = JSON.parse(input.packageText); } catch { throw Error('LOCAL_PACKAGE_INVALID'); }
    if (!raw || Array.isArray(raw) || Object.keys(raw).length !== fields.length
        || Object.keys(raw).some(key => !fields.includes(key))) throw Error('LOCAL_PACKAGE_INVALID');
    const packageData = validatePackage(raw);
    const nonce = typeof input.nonce === 'string' ? input.nonce.trim() : '';
    if (nonce && !/^[a-f0-9]{64}$/.test(nonce)) throw Error('LOCAL_NONCE_INVALID');
    const text = typeof input.text === 'string' ? input.text : '';
    if (text.length > 280) throw Error('LOCAL_BODY_MISMATCH');
    return { packageData, nonce, text };
}

export function publicView(value, expected) {
    if (!value || typeof value !== 'object') return { status: 'LOCAL_RESPONSE_INVALID' };
    if (/^(LOCAL|NATIVE|PLANNER)_[A-Z0-9_]+$/.test(value.code || '')) return { status: value.code };
    if (value.no_send === true && value.publication_authorized === false) {
        return { status: value.pairing_verified === true ? 'PAIRING_VERIFIED_NO_SEND' : 'CHECK_COMPLETE_NO_SEND' };
    }
    if (value.reconcile_only === true) return { status: 'RECONCILIATION_REQUIRED' };
    if (value.ready === true && value.submission_permitted === false) return { status: 'PLANNER_READY_NOT_SENT' };
    if (value.mode === 'published') {
        const prefix = expected ? `${expected.profileUrl}/status/` : '';
        const suffix = prefix && typeof value.public_url === 'string' && value.public_url.startsWith(prefix)
            ? value.public_url.slice(prefix.length) : '';
        return { status: 'PUBLICATION_CONFIRMED', ...(/^[1-9]\d*$/.test(suffix) ? { url: value.public_url } : {}) };
    }
    if (['unknown', 'reconciliation_required', 'reconcile_only', 'prestart_recovery'].includes(value.mode)) {
        return { status: 'RECONCILIATION_REQUIRED' };
    }
    if (value.publication_authorized === false && /^[a-f0-9]{64}$/.test(value.installationId || '')
        && /^[a-p]{32}$/.test(value.extensionId || '') && value.publicKey?.kty === 'EC'
        && value.publicKey.crv === 'P-256' && ['x', 'y'].every(k => /^[A-Za-z0-9_-]{43}$/.test(value.publicKey[k] || ''))
        && value.publicKey.d === undefined) {
        return { status: 'LOCAL_IDENTITY_NOT_ENROLLED', installation: { installationId: value.installationId,
            extensionId: value.extensionId, publicKey: { kty: 'EC', crv: 'P-256', x: value.publicKey.x, y: value.publicKey.y } } };
    }
    return { status: 'LOCAL_RESPONSE_INVALID' };
}

/** Local intent is not server authority. No automatic requests, sends or retry/reset path. */
export function createController({ send, now = Date.now, changed = () => undefined }) {
    let input = { packageText: '', nonce: '', text: '' };
    let busy = false; let consent = false; let readyUntil = 0; let generation = 0;
    let result = { status: 'NOT_CHECKED' };
    const invoked = new Set();
    const fingerprint = () => JSON.stringify(parseInput(input));
    const view = () => {
        let canConsent = false;
        try { canConsent = !busy && now() < readyUntil && !invoked.has(fingerprint()); }
        catch { canConsent = false; }
        const visible = result.status === 'PLANNER_READY_NOT_SENT' && !busy && !canConsent
            ? { status: 'LOCAL_READINESS_EXPIRED' } : result;
        return { busy, canRun: canConsent && consent, canConsent, consent, result: visible };
    };
    const update = () => changed(view());
    return {
        view,
        edit(value) { generation++; input = { ...value }; consent = false; readyUntil = 0; result = { status: 'NOT_CHECKED' }; update(); },
        consent(value) { consent = value === true && now() < readyUntil; update(); },
        async perform(operation) {
            if (busy || !['identity', 'uat', 'readiness', 'run', 'reconcile'].includes(operation)) return;
            if (operation === 'run' && !view().canRun) return;
            let data;
            try {
                data = operation === 'identity' ? null : parseInput(input);
                if (['readiness', 'run'].includes(operation) && !data.nonce) throw Error('LOCAL_NONCE_REQUIRED');
                if (operation === 'uat' && !data.nonce && !data.text) throw Error('LOCAL_BODY_REQUIRED');
            } catch (error) {
                readyUntil = 0; consent = false; result = publicView({ code: error.message }); update(); return;
            }
            const startedGeneration = generation;
            if (operation === 'run') invoked.add(fingerprint());
            busy = true; readyUntil = 0; consent = false; result = { status: 'CHECKING' }; update();
            try {
                const value = await send({ operation, ...(data ? { packageData: data.packageData,
                    ...(data.nonce ? { nonce: data.nonce } : {}),
                    ...(operation === 'uat' && !data.nonce ? { text: data.text } : {}) } : {}) });
                if (generation !== startedGeneration) return;
                result = publicView(value, data?.packageData);
                if (operation === 'readiness' && value?.ready === true && value.submission_permitted === false
                    && value.task_id === data.packageData.taskId && !invoked.has(fingerprint())) {
                    readyUntil = Math.min(Date.parse(value.expires_at), now() + 30000);
                }
            } catch { if (generation === startedGeneration) result = { status: 'LOCAL_CONNECTION_LOST' }; }
            finally { busy = false; update(); }
        },
    };
}
