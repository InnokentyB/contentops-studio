const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const gate = path.resolve(__dirname, '../../scripts/check_runtime_policy.cjs');

function fixture(t, sources) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-policy-gate-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const write = (name, text) => {
        fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
        fs.writeFileSync(path.join(root, name), text);
    };
    for (const [name, text] of Object.entries(sources)) write(name, text);
    write('baseline.json', JSON.stringify({schemaVersion: 1, entries: []}));
    execFileSync('git', ['init', '--quiet'], {cwd: root});
    execFileSync('git', ['add', '.'], {cwd: root});
    const run = (...args) => {
        const result = spawnSync(process.execPath, [gate, '--baseline', 'baseline.json', ...args], {
            cwd: root, encoding: 'utf8', timeout: 15000
        });
        assert.equal(result.error, undefined);
        return {status: result.status, report: JSON.parse(result.stdout)};
    };
    const baseline = entries => write('baseline.json', JSON.stringify({schemaVersion: 1, entries}));
    const admit = findings => findings.map(f => ({...f, reason: 'Existing bounded package; preserve safety fence', owner: 'Planner maintainer', remediation: 'R3 common provider lifecycle'}));
    return {root, write, run, baseline, admit};
}

test('ordinary generic source, numeric protocol constants, comments and isolated fixtures pass', t => {
    const f = fixture(t, {
        'src/server.ts': 'export const size={width:1080,height:1920}; const status=429; const x1=2,x2=3; // task2048 example',
        'tests/fixtures/task2048.ts': 'export const exact={taskId:2048};',
        'prisma/seed.ts': 'const exact={taskId:2048};',
        'prisma/migrations/old/migration.sql': 'SELECT 2048;',
        'prisma/schema.prisma': 'model Package {\n content_revision Int @default(1)\n}'
    });
    assert.equal(f.run().report.verdict, 'PASS');
    assert.equal(f.run().status, 0);
});

for (const [name, source] of Object.entries({
    symbol: 'export function publishTask2048() {}',
    command: "server.registerTool('ba_publish_task2048', {}, ()=>{});",
    branch: 'export function check(task) { return task.id === 2048; }',
    reverse: 'export function check(task) { return 2048 === task.id; }',
    element: "export function check(task) { return task['id'] === 2048; }",
    switch: 'export function check(task) { switch(task.id) { case 2048: return true; } }',
    includes: 'export function check(task) { return [2048].includes(task.id); }',
    map: 'const routes={2048:()=>send()}; export function execute(task) { return routes[task.id](); }',
    short: "server.registerTool('ba_publish_task42', {}, ()=>{});",
    shortX: "server.registerTool('ba_publish_x42', {}, ()=>send(42));",
    shortXFunction: 'export function publishX42() { return send(42); }',
    orm: 'export function load(db) { return db.contentItem.findUnique({where:{id:42}}); }',
    sql: "export const query='SELECT * FROM publication_tasks WHERE id=42';",
    binding: 'const scope={channelId:117,accepted_revision:1};',
    schema: 'const input=z.object({taskId:z.literal(2048)});',
    array: 'const allowedTaskIds = new Set([2048,2049]);',
    profile: "const scope={account_ref:'business-profile'};"
})) test(`rejects new ${name} authority without a matching exact baseline`, t => {
    const f = fixture(t, {'src/provider.ts': source});
    const result = f.run();
    assert.equal(result.status, 1);
    assert.ok(result.report.errors.some(e => e.code === 'NEW_RUNTIME_POLICY_DEBT'), JSON.stringify(result.report));
});

test('new task-numbered modules and config/SQL bindings cannot evade the scanner', t => {
    const f = fixture(t, {
        'src/services/task2048.ts': 'export function execute() {}',
        'ops/release.yaml': 'taskId: 2048\n',
        'ops/release.json': '{"taskId":2048}',
        'prisma/schema.prisma': 'model Package {\n task_id Int @default(2048)\n}',
        'scripts/release.sql': 'UPDATE publication_tasks SET status=\'ready\' WHERE id=2048;'
    });
    const findings = f.run('--inspect').report.findings;
    for (const file of ['src/services/task2048.ts', 'ops/release.yaml', 'ops/release.json', 'prisma/schema.prisma', 'scripts/release.sql'])
        assert.ok(findings.some(finding => finding.file === file), file);
});

test('parent quality command used by CI propagates an actual policy violation', t => {
    const f = fixture(t, {
        'src/server.ts': '// gracefulShutdown $disconnect',
        'src/tests/remote_mcp_auth.test.ts': '// tenant readOnlyHint',
        'src/services/puppeteer_publisher.service.ts': '// parseBrowserCookieHeader finally close(',
        'src/routes/auth.routes.ts': '// rateLimit',
        'src/db.ts': "// pool.on('error'",
        'src/services/delivery.service.ts': '// idempotency',
        'src/tests/delivery.service.test.ts': '// publication_fact',
        'scripts/audit_code_quality.mjs': 'console.log(JSON.stringify({score:77}));'
    });
    f.write('scripts/check_runtime_policy.cjs', 'require(' + JSON.stringify(gate) + ');');
    const parent = path.resolve(__dirname, '../../scripts/check_quality_gate.mjs');
    f.write('scripts/check_quality_gate.mjs', fs.readFileSync(parent, 'utf8'));
    const check = () => {
        const result = spawnSync(process.execPath, ['scripts/check_quality_gate.mjs'], {cwd: f.root, encoding: 'utf8', timeout: 15000});
        assert.equal(result.error, undefined);
        return {status: result.status, report: JSON.parse(result.stdout)};
    };
    // The fixture uses an explicit baseline, as a real checkout does.
    f.write('docs/code-quality/runtime-policy-baseline.json', JSON.stringify({schemaVersion:1, entries:[]}));
    execFileSync('git', ['add', '.'], {cwd: f.root});
    execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic CI fixture'], {cwd: f.root});
    assert.equal(check().status, 0);
    f.write('src/provider.ts', 'export function publishTask2048() {}');
    const rejected = check();
    assert.equal(rejected.status, 1);
    assert.ok(rejected.report.hard_stops.some(stop => stop.id === 'runtime_policy_no_new_debt'));
});

test('unchanged individually classified debt passes; duplicates and changed branches fail', t => {
    const f = fixture(t, {'src/provider.ts': 'export function check(task) { return task.id === 2048; }'});
    const findings = f.run('--inspect').report.findings;
    assert.ok(findings.length > 0);
    f.baseline(f.admit(findings));
    assert.equal(f.run().status, 0);
    f.write('src/provider.ts', 'export function check(task) { return task.id === 2048 || task.id === 2049; }');
    assert.equal(f.run().status, 1);
    f.write('src/provider.ts', 'export function check(task) { return task.id === 2048; }\nexport function other(task) { return task.id === 2048; }');
    assert.equal(f.run().status, 1);
});

test('malformed, duplicate or undocumented baseline entries fail closed', t => {
    const f = fixture(t, {'src/provider.ts': 'const scope={taskId:2048};'});
    const entries = f.admit(f.run('--inspect').report.findings);
    for (const bad of [[...entries, entries[0]], [{...entries[0], reason: ''}], [{...entries[0], count: 0}]]) {
        f.baseline(bad);
        assert.ok(f.run().report.errors.some(e => e.code === 'INVALID_BASELINE'));
    }
    f.write('baseline.json', '{broken');
    assert.ok(f.run().report.errors.some(e => e.code === 'INVALID_BASELINE'));
});

test('parse errors fail closed without printing the source or source secrets', t => {
    const f = fixture(t, {'src/provider.ts': "export const broken = { token: 'SYNTHETIC_PRIVATE_VALUE', ;"});
    const result = f.run();
    assert.equal(result.status, 1);
    assert.ok(result.report.errors.some(e => e.code === 'SOURCE_PARSE_ERROR'));
    assert.ok(!JSON.stringify(result.report).includes('SYNTHETIC_PRIVATE_VALUE'));
});

test('new untracked files and runtime-imported fixture authority are checked', t => {
    const f = fixture(t, {'src/server.ts': "import '../tests/fixtures/exact';", 'tests/fixtures/exact.ts': 'export const scope={taskId:2048};'});
    assert.equal(f.run().status, 1);
    f.write('src/task4096.ts', 'export function execute() {}');
    assert.ok(f.run('--inspect').report.findings.some(x => x.file === 'src/task4096.ts'));
});

test('trusted-base comparison rejects matching code plus new baseline rows', t => {
    const f = fixture(t, {'src/provider.ts': 'export const ready=true;'});
    execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'base'], {cwd: f.root});
    f.write('src/provider.ts', 'const scope={taskId:2048};');
    f.baseline(f.admit(f.run('--inspect').report.findings));
    assert.ok(f.run('--base-ref', 'HEAD').report.errors.some(e => e.code === 'BASELINE_WIDENED'));
});

test('JSONC compiler config is valid but malformed JSON/YAML fail closed', t => {
    const f = fixture(t, {'tsconfig.json': '{"compilerOptions": {"strict": true,}, // compiler config\n}'});
    assert.equal(f.run().status, 0);
    f.write('ops/settings.json', '{broken');
    f.write('ops/release.yaml', 'value: [unterminated');
    assert.equal(f.run().report.errors.filter(e => e.code === 'SOURCE_PARSE_ERROR').length, 2);
});

test('historical or documentation source imported into runtime does not grant an exception', t => {
    const f = fixture(t, {'src/server.ts': "import '../docs/legacy/package';", 'docs/legacy/package.ts': 'export const scope={taskId:2048};'});
    assert.equal(f.run().status, 1);
});

test('baseline comparison must have an existing trusted Git revision', t => {
    const f = fixture(t, {'src/server.ts': 'export const ready=true;'});
    assert.ok(f.run('--base-ref', 'deadbeef').report.errors.some(e => e.code === 'TRUSTED_BASELINE_UNAVAILABLE'));
});

test('removed debt cannot leave a dormant baseline permission for later resurrection', t => {
    const f = fixture(t, {'src/provider.ts': 'const scope={taskId:2048};'});
    f.baseline(f.admit(f.run('--inspect').report.findings));
    assert.equal(f.run().status, 0);
    f.write('src/provider.ts', 'export const ready=true;');
    assert.ok(f.run().report.errors.some(e => e.code === 'STALE_BASELINE_ENTRY'));
    f.baseline([]);
    assert.equal(f.run().status, 0);
    f.write('src/provider.ts', 'const scope={taskId:2048};');
    assert.equal(f.run().status, 1);
});
