// Proposed acceptance regressions: explicit invocation only, pending exact policy approval.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const gate = path.resolve(__dirname, '../../scripts/check_runtime_policy.cjs');
const policyFile = 'docs/code-quality/runtime-policy-transitions.json';
const sourceFile = 'src/provider.ts';
const before = 'export function publishTask2048() { return launch({args:["--no-sandbox"]}); }';
const after = 'export function publishTask2048() { return launch({}); }';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function fixture(t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-policy-transition-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const write = (name, text) => {
        fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
        fs.writeFileSync(path.join(root, name), text);
    };
    const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    const runWithEnv = (environment, ...args) => {
        const result = spawnSync(process.execPath, [gate, '--baseline', 'baseline.json', ...args], {
            cwd: root, encoding: 'utf8', timeout: 15000,
            env: {...process.env, RUNTIME_POLICY_BASE_REF: '', GITHUB_ACTIONS: '', GITHUB_EVENT_NAME: '', ...environment}
        });
        assert.equal(result.error, undefined);
        return {status: result.status, report: JSON.parse(result.stdout)};
    };
    const run = (...args) => runWithEnv({}, ...args);
    const baseline = entries => write('baseline.json', JSON.stringify({schemaVersion: 1, entries}));
    const oldSource = options.before || before, newSource = options.after || after;
    write(sourceFile, oldSource);
    baseline([]);
    git('init', '--quiet');
    git('add', '.');
    const old = run('--inspect').report.findings;
    const entries = old.map(row => ({...row, reason: 'Existing authority; exact security correction only',
        owner: 'Planner maintainer', remediation: 'Replace exact provider route with shared lifecycle'}));
    baseline(entries);
    write(sourceFile, newSource);
    const next = run('--inspect').report.findings;
    write(sourceFile, oldSource);
    const transition = {schemaVersion: 1, entries: [{
        file: sourceFile, oldSourceSha256: hash(oldSource), newSourceSha256: hash(newSource),
        remaps: old.map((row, index) => ({rule: row.rule, oldIdentity: row.identity,
            newIdentity: next.find(candidate => candidate.rule === row.rule)?.identity,
            count: row.count, symbol: 'publishTask2048'})),
        review: {reference: 'synthetic independent exact source review', owner: 'Planner maintainer',
            reason: 'Restore browser sandbox without additional publication authority',
            removalPlan: 'Remove the entry when the corresponding old debt is retired'}
    }]};
    if (options.editTransition) options.editTransition(transition);
    if (options.trusted !== false) write(policyFile, options.artifactText
        ? options.artifactText(transition) : JSON.stringify(transition));
    git('add', '.');
    git('-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid',
        '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'trusted synthetic policy base');
    const base = git('rev-parse', 'HEAD');
    const apply = () => {
        write(sourceFile, newSource);
        baseline(next.map((row, index) => ({...(entries[index] || entries[0]), ...row})));
    };
    return {root, write, git, run, runWithEnv, baseline, old, next, entries, transition, base, apply,
        checked: () => run('--base-ref', base)};
}

test('proposed R1: exact previously reviewed security correction can replace context fingerprints', t => {
    const f = fixture(t); f.apply();
    const result = f.checked();
    assert.equal(result.status, 0, JSON.stringify(result.report));
    assert.equal(result.report.verdict, 'PASS');
});

test('proposed R2: unchanged reviewed debt and its pending transition remain admissible', t => {
    const f = fixture(t);
    assert.equal(f.checked().status, 0);
});

test('proposed R3: current-branch transition cannot authorize its own new baseline', t => {
    const f = fixture(t, {trusted: false}); f.apply();
    f.write(policyFile, JSON.stringify(f.transition));
    assert.equal(f.checked().status, 1);
});

test('proposed R4: remapping requires a trusted base, never only the working tree', t => {
    const f = fixture(t); f.apply();
    assert.equal(f.run().status, 1);
});

test('proposed R5: exact transition cannot cover an additional source edit or task authority', t => {
    const f = fixture(t); f.apply();
    f.write(sourceFile, after + '\nexport function publishTask4096() { return send(); }');
    assert.equal(f.checked().status, 1);
});

test('proposed R6: duplicated authority cannot consume a one-occurrence transition', t => {
    const f = fixture(t); f.apply();
    f.write(sourceFile, after + '\n' + after);
    f.baseline(f.next.map((row, index) => ({...f.entries[index], ...row, count: row.count + 1})));
    assert.equal(f.checked().status, 1);
});

test('proposed R7: expanded task comparison remains unadmitted', t => {
    const f = fixture(t); f.apply();
    f.write(sourceFile, 'export function publishTask2048(task) { return task.id === 2048 || task.id === 4096; }');
    assert.equal(f.checked().status, 1);
});

test('proposed R8: business binding identities cannot be remapped, even with an exact source proposal', t => {
    const f = fixture(t, {before: 'export const scope={taskId:2048};', after: 'export const scope={taskId:4096};'});
    f.apply();
    assert.equal(f.checked().status, 1);
});

test('proposed R9: stale old permission cannot remain beside the new fingerprint', t => {
    const f = fixture(t); f.apply();
    f.baseline([...f.entries, ...f.next.map((row, index) => ({...f.entries[index], ...row}))]);
    assert.equal(f.checked().status, 1);
});

test('proposed R10: old source hash mismatch invalidates an otherwise matching proposal', t => {
    const f = fixture(t);
    f.transition.entries[0].oldSourceSha256 = '0'.repeat(64);
    f.write(policyFile, JSON.stringify(f.transition));
    f.git('add', policyFile);
    f.git('-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid',
        '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'invalid synthetic source binding');
    const base = f.git('rev-parse', 'HEAD'); f.apply();
    assert.equal(f.run('--base-ref', base).status, 1);
});

for (const field of ['owner', 'reason', 'remediation']) test(`proposed R11: changed baseline ${field} is not admitted`, t => {
    const f = fixture(t); f.apply();
    f.baseline(f.next.map((row, index) => ({...f.entries[index], ...row, [field]: 'unreviewed replacement metadata'})));
    assert.equal(f.checked().status, 1);
});

test('proposed R12: a previously retired finding cannot be resurrected using a pending transition', t => {
    const f = fixture(t);
    f.write(sourceFile, 'export const retired=true;'); f.baseline([]);
    f.git('add', '.');
    f.git('-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid',
        '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'retire synthetic authority');
    const base = f.git('rev-parse', 'HEAD'); f.apply();
    assert.equal(f.run('--base-ref', base).status, 1);
});

test('proposed R13: a new task symbol cannot inherit an existing symbol allowance', t => {
    const f = fixture(t, {after: 'export function publishTask4096() { return launch({}); }'});
    f.apply();
    assert.equal(f.checked().status, 1);
});

test('proposed R14: duplicate trusted remaps are ambiguous and rejected', t => {
    const f = fixture(t, {editTransition: transition => {
        transition.entries[0].remaps.push({...transition.entries[0].remaps[0]});
    }});
    f.apply();
    assert.equal(f.checked().status, 1);
});

test('proposed R15: exact task-identifier transition cannot also admit a new business binding', t => {
    const f = fixture(t, {
        before: 'export function publishTask2048(task) { return launch({args:["--no-sandbox"]}); }',
        after: 'export function publishTask2048(task) { if(task.id === 4096) return launch({}); return null; }'
    });
    assert.equal(f.transition.entries[0].remaps.length, 1);
    assert.equal(f.transition.entries[0].remaps[0].rule, 'task_identifier');
    assert.ok(f.next.some(row => row.rule === 'business_comparison'));
    f.apply();
    const result = f.checked();
    assert.equal(result.status, 1);
    assert.ok(result.report.errors.some(error => error.code === 'BASELINE_WIDENED'));
});

test('proposed R16: modified working-tree review cannot extend the trusted source hash', t => {
    const f = fixture(t); f.apply();
    const changed = after + '\nexport const scope={taskId:4096};';
    f.write(sourceFile, changed);
    const findings = f.run('--inspect').report.findings;
    f.baseline(findings.map(row => ({...f.entries[0], ...row})));
    f.transition.entries[0].newSourceSha256 = hash(changed);
    f.write(policyFile, JSON.stringify(f.transition));
    assert.equal(f.checked().status, 1);
});

for (const event of ['pull_request', 'push']) test(`proposed R17: matching full ${event} event base can consume the transition`, t => {
    const f = fixture(t); f.apply();
    const result = f.runWithEnv({RUNTIME_POLICY_BASE_REF: f.base, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: event});
    assert.equal(result.status, 0, JSON.stringify(result.report));
});

test('proposed R18: a conflicting CLI base cannot replace the event base', t => {
    const f = fixture(t);
    f.git('-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid',
        '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'another synthetic base');
    const other = f.git('rev-parse', 'HEAD'); f.apply();
    assert.equal(f.runWithEnv({RUNTIME_POLICY_BASE_REF: f.base}, '--base-ref', other).status, 1);
});

for (const base of ['HEAD', '0000000000000000000000000000000000000000', 'deadbeef'])
test(`proposed R19: transition cannot consume symbolic, zero or unavailable base ${base}`, t => {
    const f = fixture(t); f.apply();
    assert.equal(f.run('--base-ref', base).status, 1);
});

test('proposed R20: unknown artifact fields are not a reviewed extension', t => {
    const f = fixture(t, {editTransition: transition => {transition.allowUnreviewed = true;}});
    f.apply(); assert.equal(f.checked().status, 1);
});

test('proposed R21: many-to-one remaps cannot merge distinct allowances', t => {
    const f = fixture(t, {editTransition: transition => {
        transition.entries[0].remaps.push({...transition.entries[0].remaps[0], oldIdentity:'0'.repeat(64)});
    }});
    f.apply(); assert.equal(f.checked().status, 1);
});

test('proposed R22: duplicate entries for one source file are ambiguous', t => {
    const f = fixture(t, {editTransition: transition => {transition.entries.push({...transition.entries[0]});}});
    f.apply(); assert.equal(f.checked().status, 1);
});

test('proposed R23: artifact traversal paths cannot authorize a replacement', t => {
    const f = fixture(t, {editTransition: transition => {transition.entries[0].file='../provider.ts';}});
    f.apply(); assert.equal(f.checked().status, 1);
});

test('proposed R24: an artifact over 64 KiB cannot authorize a replacement', t => {
    const f = fixture(t, {artifactText: transition => JSON.stringify(transition) + ' '.repeat(65537)});
    f.apply(); assert.equal(f.checked().status, 1);
});

test('proposed R25: artifact symlink in the trusted tree is not JSON authority', t => {
    const f = fixture(t);
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: f.root, input: JSON.stringify(f.transition), encoding: 'utf8'
    }).trim();
    f.git('update-index', '--cacheinfo', '120000', blob, policyFile);
    f.git('-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid',
        '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'symlink synthetic artifact');
    const base = f.git('rev-parse', 'HEAD'); f.apply();
    assert.equal(f.run('--base-ref', base).status, 1);
});

test('proposed R26: workflow_dispatch cannot consume a transition using a supplied commit', t => {
    const f = fixture(t); f.apply();
    assert.equal(f.runWithEnv({RUNTIME_POLICY_BASE_REF:f.base,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch'}).status, 1);
});
