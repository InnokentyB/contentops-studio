const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const collector = path.resolve(__dirname, '../../scripts/audit_runtime_policy.cjs');

function repository(t, sources) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-policy-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: directory });
    execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: directory });
    for (const [name, body] of Object.entries(sources)) {
        const file = path.join(directory, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
    }
    execFileSync('git', ['add', '.'], { cwd: directory });
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic fixture'], { cwd: directory });
    const run = mode => JSON.parse(execFileSync(process.execPath, [collector, mode], {
        cwd: directory, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']
    }));
    run.directory = directory;
    return run;
}

test('collector discovers runtime function/tool/literal authority without executing the source', t => {
    const run = repository(t, {
        'src/server.ts': "import './services/provider'; throw Error('MUST NOT EXECUTE');",
        'src/services/provider.ts': "export function publishTask2048() {}\nconst scope={taskId:2048};\nserver.registerTool('ba_publish_task2048', {}, ()=>{});"
    });
    const summary = run('summary');
    assert.equal(summary.trackedFileCount, 2);
    assert.equal(summary.runtimeReachableCount, 2);
    assert.equal(summary.taskTools, 1);
    const findings = run('findings:0');
    assert.ok(findings.some(f => f.rule === 'task_identifier' && f.value === 'publishTask2048' && f.runtimeReachable));
    assert.ok(findings.some(f => f.rule === 'business_literal' && f.value === 'taskId=2048'));
    assert.deepEqual(run('tools'), [{ file: 'src/services/provider.ts', line: 3, name: 'ba_publish_task2048' }]);
});

test('ordinary protocol numbers, dimensions and comment examples are not task-specific authority', t => {
    const run = repository(t, {
        'src/server.ts': "export const size={width:1080,height:1920};\nconst sha256 = 'sha256';\nconst http=429;\n// publishTask2048 example, not an export\n"
    });
    assert.deepEqual(run('findings:0'), []);
    assert.equal(run('summary').taskTools, 0);
});

test('fixtures, seeds, historical migrations and vendored governance are classified separately', t => {
    const run = repository(t, {
        'src/server.ts': 'export const ready=true;',
        'tests/tdpd/example.cjs': 'const sample={taskId:2048};',
        'src/tests/example.test.ts': 'const sample={taskId:2048};',
        'tests/fixtures/example.ts': 'const sample={taskId:2048};',
        'prisma/seed.ts': 'const sample={taskId:2048};',
        'prisma/migrations/historical/migration.sql': 'SELECT 2048;',
        'ops/sql/historical.sql': 'SELECT 2048;',
        'skill-updates/version/tool.cjs': 'const sample={taskId:2048};'
    });
    const files = new Map(run('files:0').map(f => [f.file, f]));
    assert.equal(files.get('tests/tdpd/example.cjs').category, 'test_fixture_migration');
    assert.equal(files.get('src/tests/example.test.ts').category, 'test_fixture_migration');
    assert.equal(files.get('prisma/seed.ts').category, 'seed');
    assert.equal(files.get('prisma/migrations/historical/migration.sql').category, 'test_fixture_migration');
    assert.equal(files.get('ops/sql/historical.sql').category, 'historical_ops_migration');
    assert.equal(files.get('skill-updates/version/tool.cjs').category, 'governance');
    assert.deepEqual(run('findings:0'), []);
});

test('runtime fixture import stays visible in the graph; classification grants no execution authority', t => {
    const run = repository(t, {
        'src/server.ts': "import '../tests/fixtures/package';",
        'tests/fixtures/package.ts': 'export const fixed={taskId:2048};'
    });
    const fixture = run('files:0').find(f => f.file === 'tests/fixtures/package.ts');
    assert.equal(fixture.category, 'test_fixture_migration');
    assert.equal(fixture.runtimeReachable, true);
    assert.deepEqual(run('edges:0')[0].imports, ['../tests/fixtures/package']);
});

test('collector refuses tracked source symlinks instead of reading outside repository data', t => {
    const run = repository(t, { 'src/server.ts': 'export const ready=true;' });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-policy-outside-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const outside = path.join(directory, 'private.ts');
    fs.writeFileSync(outside, 'export const synthetic={taskId:4096};');
    fs.symlinkSync(outside, path.join(run.directory, 'src/external.ts'));
    execFileSync('git', ['add', 'src/external.ts'], { cwd: run.directory });
    assert.throws(() => run('summary'), /TRACKED_SOURCE_SYMLINK_UNSUPPORTED/);
});

test('collector refuses a replaced ancestor directory symlink before reading tracked source', t => {
    const run = repository(t, { 'src/services/provider.ts': 'export const ready=true;' });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-policy-parent-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'provider.ts'), 'export const synthetic={taskId:4096};');
    fs.renameSync(path.join(run.directory, 'src/services'), path.join(run.directory, 'saved-services'));
    fs.symlinkSync(directory, path.join(run.directory, 'src/services'));
    assert.throws(() => run('summary'), /TRACKED_SOURCE_SYMLINK_UNSUPPORTED/);
});
