const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID, generateKeyPairSync, createHash } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, 'synthetic-db');
assert.equal(url.pathname, '/shared_browser_synthetic'); assert.equal(url.username, 'synthetic');
const base = process.env.SHARED_BROWSER_DIST || '/opt/planner/dist';
const { prisma: db, pool } = require(path.join(base, 'db.js'));
const contract = require(path.join(base, 'services/x_native_diagnostics_contract.js'));
const { getXNativeState } = require(path.join(base, 'services/x_native_diagnostics.js'));
const { nativeInstallationSchema } = require(path.join(base, 'services/x_native_registry.js'));
const { nativeKeyFingerprint } = require(path.join(base, 'services/x_native_receipt.js'));
const sha = value => createHash('sha256').update(value).digest('hex');
const deps = { db, enabled: () => true };

async function setup(t) {
    const suffix = randomUUID();
    const user = await db.user.create({ data: { name: 'Synthetic owner', email: `x-state-${suffix}@example.invalid`, password_hash: 'not-a-login' } });
    const project = await db.project.create({ data: { name: 'Synthetic X state read', slug: `x-state-${suffix}` } });
    const extraUsers = [];
    t.after(async () => {
        assert.equal((await db.project.findUnique({ where: { id: project.id } })).slug, `x-state-${suffix}`);
        await db.connectorDispatchJob.deleteMany({ where: { project_id: project.id } });
        await db.project.delete({ where: { id: project.id } });
        for (const id of [user.id, ...extraUsers]) await db.user.delete({ where: { id } });
    });
    await db.projectMember.create({ data: { project_id: project.id, user_id: user.id, role: 'owner' } });
    const config = { account_ref: '@synthetic_x', account_type: 'personal', channel_url: 'https://x.com/synthetic_x',
        api_key: 'hidden-synthetic-config-value' };
    const channel = await db.socialChannel.create({ data: { project_id: project.id, name: 'synthetic_state_x', type: 'x', config } });
    const identity = { platform: 'x', accountType: 'personal', accountRef: '@synthetic_x',
        profileUrl: 'https://x.com/synthetic_x', providerAccountId: 'synthetic_x' };
    const task = await db.contentItem.create({ data: { project_id: project.id, channel_id: channel.id,
        type: 'publication', draft_text: 'hidden-synthetic-accepted-copy', content_revision: 2, accepted_revision: 2,
        quality_report: { browser_identity_binding: { identity } } } });
    const args = { projectId: project.id, channelId: channel.id, taskId: task.id,
        actorId: `user:${user.id}`, candidateInstallationId: '0'.repeat(64) };
    return { args, project, channel, task, identity, config, extraUsers };
}

function makeRecord(s, overrides = {}) {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const raw = keys.publicKey.export({ format: 'jwk' });
    const publicKey = { kty: raw.kty, crv: raw.crv, x: raw.x, y: raw.y };
    return nativeInstallationSchema.parse({ projectId: s.args.projectId, channelId: s.args.channelId,
        actorId: s.args.actorId, installationId: nativeKeyFingerprint(publicKey), publicKey,
        bundleSha256: '1'.repeat(64), extensionId: 'a'.repeat(32), uatReference: 'synthetic UAT reference not provider proof',
        revoked: false, ...overrides });
}
async function install(s, overrides = {}) {
    const record = makeRecord(s, overrides);
    const key = `${record.channelId}:${record.installationId}`;
    const setting = await db.projectSettings.create({ data: { project_id: record.projectId,
        key: `x_native:installation:v1:${key}`, value: JSON.stringify(record) } });
    const event = await db.workflowEvent.create({ data: { project_id: record.projectId, content_item_id: s.task.id,
        actor_id: record.actorId, command: 'x_native_register_installation', idempotency_key: key,
        after_state: { registration_sha256: sha(JSON.stringify(record)), hidden: 'hidden-synthetic-audit-value' } } });
    return { record, setting, event };
}
async function fingerprint(s) {
    const where = { project_id: s.project.id };
    const rows = await Promise.all([db.projectSettings.findMany({ where, orderBy: { id: 'asc' } }),
        db.workflowEvent.findMany({ where, orderBy: { id: 'asc' } }), db.contentItem.findMany({ where, orderBy: { id: 'asc' } }),
        db.workItem.findMany({ where, orderBy: { id: 'asc' } }), db.deliveryAttempt.findMany({ where, orderBy: { id: 'asc' } }),
        db.publicationFact.findMany({ where, orderBy: { id: 'asc' } }), db.connectorDispatchJob.findMany({ where, orderBy: { id: 'asc' } })]);
    return sha(JSON.stringify(rows));
}
function wrappedDb(intercept) {
    return new Proxy(db, { get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key);
        return (run, options) => db.$transaction(tx => run(new Proxy(tx, { get(client, operation) {
            const value = Reflect.get(client, operation);
            if (operation === '$queryRaw' || operation === '$executeRaw') {
                return async (...args) => intercept({ operation, query: args[0], call: () => value.apply(client, args), tx: client });
            }
            return typeof value === 'function' ? value.bind(client) : value;
        } })), options);
    } });
}
module.exports = { db, pool, deps, contract, getXNativeState, setup, makeRecord, install, fingerprint, wrappedDb, sha };
