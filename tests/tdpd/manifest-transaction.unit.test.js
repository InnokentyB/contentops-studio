const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const { loadAgentWorkspaceManifest } = require('../../dist/services/agent_workspace_manifest.service');
test('manifest validation reads project and membership from the supplied transaction only', async t => {
    const project = db.default.project;
    const original = project.findUnique;
    project.findUnique = async () => { throw new Error('GLOBAL_CLIENT_MUST_NOT_BE_USED'); };
    t.after(() => { project.findUnique = original; });
    const calls = [];
    const tx = { project: { findUnique: async () => {
        calls.push('project'); return { id: 7, name: 'synthetic', slug: 'seturon', updated_at: new Date('2026-10-15T00:00Z'), channels: [], settings: [] };
    } }, projectMember: { findUnique: async () => { calls.push('member'); return { id: 1 }; } } };
    const manifest = await loadAgentWorkspaceManifest(7, 2, tx);
    assert.equal(manifest.project.id, 7); assert.match(manifest.checksum, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(calls, ['project', 'member']);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
