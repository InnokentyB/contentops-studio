const { generateKeyPairSync, sign } = require('node:crypto');
const { xFixture } = require('./shared-x-native.fixture.cjs');
const base = process.env.SHARED_BROWSER_DIST || '/opt/planner/dist';
const pairing = require(base + '/services/x_native_pairing.js');
const registry = require(base + '/services/x_native_registry.js');
const wire = require(base + '/services/x_native_receipt.js');
const release = require(base + '/services/browser_publication_release.js');
async function recoveryFixture(t) {
    const actualNow = Date.now, start = actualNow(); let now = start;
    Date.now = () => now; t.after(() => { Date.now = actualNow; });
    const { f, args } = xFixture(6191);
    f.state.nativeSettings = [];
    const matches = (r, w) => Object.entries(w).every(([k, v]) => r[k] === v);
    f.db.projectSettings = {
        findUnique: async ({ where }) => f.state.nativeSettings.find(r => matches(r, where.project_id_key || where)) || null,
        create: async ({ data }) => {
            if (f.state.nativeSettings.some(r => r.project_id === data.project_id && r.key === data.key)) throw Error('synthetic unique conflict');
            const row = { id: 900 + f.state.nativeSettings.length, ...data }; f.state.nativeSettings.push(row); return row;
        },
        updateMany: async ({ where, data }) => {
            const rows = f.state.nativeSettings.filter(r => matches(r, where));
            rows.forEach(r => Object.assign(r, data)); return { count: rows.length };
        }
    };
    const create = f.db.workflowEvent.create;
    f.db.workflowEvent.create = ({ data }) => create({ data: { created_at: new Date(Date.now()), ...data } });
    await release.repairBrowserPublicationMetadata({ ...args, idempotencyKey: 'metadata', apply: true }, f);
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), raw = keys.publicKey.export({ format: 'jwk' });
    const publicKey = wire.nativePublicKeySchema.parse({ kty: raw.kty, crv: raw.crv, x: raw.x, y: raw.y });
    const installationId = wire.nativeKeyFingerprint(publicKey), extensionId = 'a'.repeat(32), bundleSha256 = '8'.repeat(64);
    const setup = { ...args, publicKey, installationId, extensionId, bundleSha256 };
    const signature = value => sign('sha256', Buffer.from(value), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const verify = async challenge => {
        const unsigned = { challenge, account: challenge.account, bodySha256: challenge.bodySha256, observedAt: new Date(now).toISOString() };
        return pairing.verifyNativePairing({ ...unsigned, signature: signature(pairing.nativePairingMessage(unsigned)) }, f, `chrome-extension://${extensionId}`);
    };
    const first = await pairing.issueNativePairing(setup, f);
    await verify(first.challenge);
    const ordinary = async () => pairing.issueNativePairing(setup, f);
    const recovery = (phase, grantId, overrides = {}) => pairing.issueNativePairing({ ...setup, ...overrides,
        recovery: { phase, predecessorNonce: first.challenge.nonce, approvalReference: 'Explicit synthetic Owner recovery approval', ...(grantId ? { grantId } : {}) } }, f);
    const enroll = (challenge = first.challenge, overrides = {}) => registry.registerNativeInstallation({ ...setup,
        pairingNonce: challenge.nonce, uatReference: 'Actual synthetic human no-send acceptance', apply: true, ...overrides }, f);
    const manifestOnly = () => {
        setup.snapshot = { ...setup.snapshot, manifestChecksum: 'sha256:' + 'd'.repeat(64) };
        f.state.manifest = setup.snapshot.manifestChecksum;
    };
    return { f, setup, first, verify, ordinary, recovery, enroll, manifestOnly, start,
        time: ms => { now = start + ms; }, registry, pairing };
}
module.exports = { recoveryFixture };
