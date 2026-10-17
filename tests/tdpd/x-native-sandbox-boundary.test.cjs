const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');

test('synthetic extension reuses the reviewed namespace/seccomp boundary without broad privilege', () => {
    const config = yaml.load(fs.readFileSync('ops/x-native-extension/compose.yaml', 'utf8')).services['browser-fixture'];
    assert.deepEqual(config.cap_drop, ['ALL']); assert.deepEqual(config.cap_add, ['SYS_CHROOT']);
    assert.deepEqual(config.security_opt, ['no-new-privileges:true', 'seccomp=./seccomp_profile.json']);
    assert.equal(config.user, '1000:1000'); assert.equal(config.read_only, true);
    assert.equal(config.network_mode, 'none'); assert.equal(config.shm_size, '512m');
    assert.equal(config.privileged, undefined); assert.equal(config.ports, undefined);
    assert.equal(config.ulimits.core, 0);
    assert.ok(config.volumes.every(mount => !/docker\.sock|profile|\/home\/:/.test(mount)));
    const bytes = fs.readFileSync('ops/x-native-extension/seccomp_profile.json');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
        'cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849');
    const profile = JSON.parse(bytes);
    assert.equal(profile.defaultAction, 'SCMP_ACT_ERRNO');
    assert.ok(profile.syscalls.some(row => row.action === 'SCMP_ACT_ALLOW'
        && ['clone', 'setns', 'unshare'].every(name => row.names.includes(name))
        && Object.keys(row.includes).length === 0));
});
