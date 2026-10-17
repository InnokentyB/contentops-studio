// Operator walkthrough, not a test of whether an agent understood instructions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const source = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-context-walkthrough-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const rows = [];
function safeSource(base, file) {
    assert.ok(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'));
    let current = base;
    for (const part of file.split('/')) {
        current = path.join(current, part);
        assert.ok(!fs.lstatSync(current).isSymbolicLink(), 'source symlink rejected');
    }
    const relative = path.relative(fs.realpathSync(base), fs.realpathSync(current));
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(fs.lstatSync(current).isFile());
    return current;
}
function quality(phase, expected) {
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, ['scripts/check_quality_gate.mjs'], {
        cwd: root, encoding: 'utf8', timeout: 30000,
        env: {...process.env, RUNTIME_POLICY_BASE_REF: 'HEAD'}
    });
    assert.equal(result.error, undefined);
    const report = JSON.parse(result.stdout);
    rows.push({phase, startedAt, endedAt: new Date().toISOString(),
        command: 'node scripts/check_quality_gate.mjs', status: result.status,
        verdict: report.verdict, outputSha256: hash(result.stdout)});
    assert.equal(result.status, expected, JSON.stringify(report));
    if (expected !== 0) assert.ok(report.hard_stops.some(stop => stop.id === 'runtime_policy_no_new_debt'));
}
try {
    const files = execFileSync('git', ['ls-files', '-z'], {cwd: source, encoding: 'utf8'}).split('\0').filter(Boolean);
    for (const file of files) {
        const from = safeSource(source, file), to = path.join(root, file);
        fs.mkdirSync(path.dirname(to), {recursive: true});
        fs.copyFileSync(from, to);
    }
    git(['init', '--quiet']);
    git(['add', '.']);
    const inputTree = git(['write-tree']);
    const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {cwd: source, encoding: 'utf8'}).trim();
    assert.equal(inputTree, sourceTree, 'tracked copy must equal committed checkpoint');
    git(['-c', 'user.name=Pilot', '-c', 'user.email=pilot@example.invalid',
        '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'isolated checkpoint']);
    quality('restored-checkpoint', 0);
    const violation = path.join(root, 'src/services/task424242.ts');
    assert.ok(!fs.existsSync(violation));
    fs.writeFileSync(violation, 'export function publishTask424242() { throw new Error("MUST_NOT_EXECUTE"); }\n');
    quality('deliberate-violation', 1);
    fs.unlinkSync(violation);
    quality('restored-after-removal', 0);
    git(['add', '.']);
    assert.equal(git(['write-tree']), inputTree);
    fs.mkdirSync(path.join(root, 'synthetic-target'));
    fs.writeFileSync(path.join(root, 'synthetic-target', 'sample'), 'synthetic only');
    fs.symlinkSync(path.join(root, 'synthetic-target'), path.join(root, 'synthetic-link'));
    assert.throws(() => safeSource(root, 'synthetic-link/sample'), /source symlink rejected/);
    console.log(JSON.stringify({schemaVersion: 1, resumeMode: 'simulated-manual',
        inputTree, sourceTree, restoredTree: inputTree, ancestorSymlinkRejected: true, results: rows}));
} finally {
    // Only this invocation's private mkdtemp directory; source is never modified.
    fs.rmSync(root, {recursive: true, force: true});
}
