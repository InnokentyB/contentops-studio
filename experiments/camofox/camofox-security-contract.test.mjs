import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const candidate = (...parts) => path.join(root, ...parts);

function requiredText(relativePath) {
  const absolute = candidate(relativePath);
  assert.ok(fs.existsSync(absolute), `RED: hardened candidate is absent: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

test('SEC-01/02 reproducible supply chain has pinned hashes, SBOM and zero high findings', () => {
  const provenance = JSON.parse(requiredText('infra/camofox/provenance.json'));
  assert.match(provenance.camofox?.sha256 || '', /^[a-f0-9]{64}$/);
  assert.match(provenance.ublock?.sha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(provenance.lifecycle_scripts, false);
  const audit = JSON.parse(requiredText('infra/camofox/dependency-audit.json'));
  assert.equal(audit.metadata?.vulnerabilities?.critical, 0);
  assert.equal(audit.metadata?.vulnerabilities?.high, 0);
  assert.ok(fs.existsSync(candidate('infra/camofox/sbom.cdx.json')), 'RED: CycloneDX SBOM is absent');
});

test('SEC-03/06/07 hardened runtime disables telemetry and persistence and contains the container', () => {
  const compose = requiredText('infra/camofox/compose.hardened.yml');
  for (const contract of [
    /CAMOFOX_CRASH_REPORT_ENABLED:\s*["']?false/i,
    /CAMOFOX_PERSISTENCE_ENABLED:\s*["']?false/i,
    /read_only:\s*true/i,
    /cap_drop:[\s\S]*-\s*ALL/i,
    /tmpfs:/i,
    /user:\s*["']?[1-9][0-9]*:[1-9][0-9]*/i,
    /mem_limit:/i,
    /cpus:/i
  ]) assert.match(compose, contract);
  assert.doesNotMatch(compose, /volumes:[\s\S]*\/Users|\/home|\$HOME/i);
});

test('SEC-04/09 URL and browser network policy blocks private targets, rebinding, redirects and writes', async () => {
  const modulePath = candidate('src/services/browser/camofox_radar_policy.js');
  assert.ok(fs.existsSync(modulePath), 'RED: read-only Radar URL policy is absent');
  const policy = await import(modulePath);
  for (const url of [
    'http://127.0.0.1', 'http://localhost', 'http://10.0.0.1', 'http://172.16.0.1',
    'http://192.168.1.1', 'http://169.254.169.254/latest/meta-data', 'http://[::1]'
  ]) await assert.rejects(policy.authorizeRadarNavigation({ projectId: 29, url, method: 'GET' }));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await assert.rejects(policy.authorizeRadarNavigation({ projectId: 29, url: 'https://example.com', method }));
  }
  assert.equal(policy.requiresDnsValidationBeforeAndAfterRedirect, true);
});

test('SEC-05/08 facade is project-scoped and exposes only bounded read operations', async () => {
  const modulePath = candidate('src/services/browser/camofox_radar_facade.js');
  assert.ok(fs.existsSync(modulePath), 'RED: project-scoped Camofox facade is absent');
  const facade = await import(modulePath);
  assert.deepEqual(facade.publicOperations.sort(), ['close_session', 'navigate_public', 'snapshot_accessibility']);
  for (const forbidden of ['evaluate', 'upload', 'download', 'cookie_import', 'cookie_export', 'vnc', 'plugin_install']) {
    assert.equal(facade.publicOperations.includes(forbidden), false);
  }
  await assert.rejects(facade.authorize({ credential: null, projectId: 29, sessionProjectId: 29 }));
  await assert.rejects(facade.authorize({ credential: 'project:29', projectId: 29, sessionProjectId: 10 }));
});

test('POL-01/OPS-01 challenge, login wall and crash terminate safely without bypass or mutating retry', async () => {
  const modulePath = candidate('src/services/browser/camofox_radar_facade.js');
  assert.ok(fs.existsSync(modulePath), 'RED: safe challenge/crash result contract is absent');
  const facade = await import(modulePath);
  for (const reason of ['captcha', 'login_wall', 'forbidden_domain']) {
    assert.deepEqual(await facade.classifyStop(reason), { status: 'browser_required', retry: false, bypass_attempted: false });
  }
  assert.deepEqual(await facade.classifyStop('crash'), { status: 'failed', retry: false, session_destroyed: true });
});

test('CMP-01 comparison corpus is approved, fixed and contains 20–30 oracle-labelled tasks', () => {
  const corpus = JSON.parse(requiredText('experiments/camofox/corpus.approved.json'));
  assert.ok(corpus.tasks.length >= 20 && corpus.tasks.length <= 30);
  assert.equal(corpus.approved_by_owner, true);
  for (const task of corpus.tasks) {
    assert.ok(task.id && task.url && task.oracle_ref && task.expected_fields);
    assert.equal(task.authenticated, false);
  }
});
