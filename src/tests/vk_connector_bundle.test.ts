import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CONNECTOR-BUNDLE-001 standalone artifact starts without checkout dependencies and rejects missing private config safely', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-bundle-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const build = spawnSync(process.execPath, ['scripts/build_vk_connector_consumer.cjs'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 60_000
    });
    assert.equal(build.status, 0, 'Standalone build must succeed');
    const artifact = path.join(root, 'consumer.cjs');
    fs.copyFileSync(path.join(process.cwd(), 'dist/connector/vk_connector_consumer.cjs'), artifact);
    const output = spawnSync(process.execPath, [artifact, path.join(root, 'missing-private-config.json')], {
        cwd: root, encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH ?? '' }
    });
    assert.equal(output.status, 1);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, /^\[VK_CONNECTOR_STOPPED\]/);
    assert.equal(output.stderr.includes('TypeError'), false);
    assert.equal(output.stderr.includes('MODULE_NOT_FOUND'), false);
});

test('CONNECTOR-BUNDLE-002 private config with unavailable credentials stops before connecting', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-bundle-auth-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const artifact = path.join(root, 'consumer.cjs');
    fs.copyFileSync(path.join(process.cwd(), 'dist/connector/vk_connector_consumer.cjs'), artifact);
    const configFile = path.join(root, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ projectId: 10, hostId: 'vk-connector-local-1048',
        endpoint: 'https://planner-mcp-production.up.railway.app/mcp/publisher',
        runtimeDir: path.join(root, 'runtime'), mode: 'vk_feed_provider', buildVersion: 'offline-bundle-test',
        tokenEnvVar: 'CONTENTOPS_ANALYSTCRAFT_PUBLISHER_TOKEN' }), { mode: 0o600 });
    const output = spawnSync(process.execPath, [artifact, configFile], {
        cwd: root, encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH ?? '' }
    });
    assert.equal(output.status, 1);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, /^\[VK_CONNECTOR_AUTH_UNAVAILABLE\]/);
    assert.equal(fs.existsSync(path.join(root, 'runtime')), false, 'Auth failure precedes lock and MCP connection');
});

test('CONNECTOR-BUNDLE-003 competing local lock stops before connecting and preserves operator evidence', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-bundle-lock-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const artifact = path.join(root, 'consumer.cjs');
    fs.copyFileSync(path.join(process.cwd(), 'dist/connector/vk_connector_consumer.cjs'), artifact);
    const runtimeDir = path.join(root, 'runtime');
    fs.mkdirSync(runtimeDir, { mode: 0o700 });
    const lock = path.join(runtimeDir, 'consumer.lock');
    const evidence = '{"operator":"existing-lock-fixture"}';
    fs.writeFileSync(lock, evidence, { mode: 0o600 });
    const tokenFile = path.join(root, 'synthetic-token');
    fs.writeFileSync(tokenFile, 'offline-only-not-a-real-credential', { mode: 0o600 });
    const configFile = path.join(root, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ projectId: 10, hostId: 'vk-connector-local-1048',
        endpoint: 'https://planner-mcp-production.up.railway.app/mcp/publisher', runtimeDir,
        mode: 'infrastructure_only', buildVersion: 'offline-bundle-test', tokenFile }), { mode: 0o600 });
    const output = spawnSync(process.execPath, [artifact, configFile], {
        cwd: root, encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH ?? '' }
    });
    assert.equal(output.status, 1);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, /^\[VK_CONNECTOR_ALREADY_RUNNING_OR_STALE_LOCK\]/);
    assert.equal(fs.readFileSync(lock, 'utf8'), evidence);
    assert.deepEqual(fs.readdirSync(runtimeDir), ['consumer.lock']);
});
