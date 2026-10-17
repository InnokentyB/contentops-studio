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


module.exports = {fixture, hash, before, after, sourceFile, policyFile};
