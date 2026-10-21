const test = require('node:test'), assert = require('node:assert/strict');
const { recoveryFixture } = require('./x-native-pairing-recovery.fixture.cjs');
test('verified no-send evidence enrolls after human acceptance delay without renewing the challenge', async t => {
    const s = await recoveryFixture(t); s.time(300001);
    const before = structuredClone(s.f.state);
    assert.equal((await s.enroll(undefined, { apply: false })).mode, 'preview');
    assert.deepEqual(s.f.state, before);
    assert.equal((await s.enroll()).mode, 'registered');
    assert.equal(s.f.state.attempts.length, 0);
});
test('preview and apply reject expired enrollment, missing audit, future audit and consumed evidence without writes', async t => {
    for (const kind of ['cutoff', 'missing', 'future', 'consumed']) await t.test(kind, async sub => {
        const s = await recoveryFixture(sub); s.time(400000);
        const row = s.f.state.nativeSettings.find(r => r.key.startsWith('x_native:pairing:'));
        if (kind === 'cutoff') s.time(86400000);
        if (kind === 'missing') s.f.state.events = s.f.state.events.filter(e => e.command !== 'x_native_pairing_verified');
        if (kind === 'future') s.f.state.events.find(e => e.command === 'x_native_pairing_verified').created_at = new Date(s.start + 400001);
        if (kind === 'consumed') { const v = JSON.parse(row.value); v.consumed = true; row.value = JSON.stringify(v); }
        const before = structuredClone(s.f.state);
        for (const apply of [false, true]) await assert.rejects(s.enroll(undefined, { apply }), /PAIRING_(ENROLLMENT_EXPIRED|INVALID)/);
        assert.deepEqual(s.f.state, before);
    });
});
test('obsolete recovery phases never grant authority or consume legacy state', async t => {
    const s = await recoveryFixture(t); s.time(300001);
    const before = structuredClone(s.f.state);
    for (const phase of ['preview','authorize','apply','revoke']) {
        await assert.rejects(s.recovery(phase, ['apply','revoke'].includes(phase) ? 'f'.repeat(64) : undefined), /PAIRING_USE_CURRENT_FLOW/);
    }
    assert.deepEqual(s.f.state, before);
});
