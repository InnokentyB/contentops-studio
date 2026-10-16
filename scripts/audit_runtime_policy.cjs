// Read-only candidate collector; never executes an imported project module.
const fs = require('node:fs'), cp = require('node:child_process'), path = require('node:path'), ts = require('typescript');
const {readSource, repositoryFiles} = require('./runtime_policy_source.cjs');
const all = repositoryFiles();
const classify = f => /(?:^|\/)(?:tests?|fixtures|__tests__|migrations)\//.test(f) || /\.(test|spec|fixture)\./.test(f) ? 'test_fixture_migration' : /(?:^|[\/_-])seed(?:[\/_-]|\.)/.test(f) ? 'seed' : f.startsWith('docs/') ? 'docs' : /^(?:\.tdpd|skill-updates)\//.test(f) ? 'governance' : f.includes('package-lock') ? 'lock' : f.startsWith('ops/sql/') ? 'historical_ops_migration' : /^(src|frontend|scripts|prisma|ops|\.github)\//.test(f) || /^(?:\.mcp\.example\.json|package\.json|Dockerfile|docker-compose\.yml|[^/]*config\.[^/]+)$/.test(f) ? 'operational' : 'other';
const task = /(?:task|linkedin|dzen|threads|telegram|devto|medium|habr|setka|recovery|vk|x)[_-]?\d{3,}/i;
const business = /^(?:(?:project|task|channel|account|actor|owner|user|work_?item|attempt|decision|release|selected_?asset|content_?item)(?:_?ids?)?|(?:accepted|content|source_?content)_?revision|(?:body|text|image|asset|manifest)_?(?:sha256|checksum)|(?:schedule|publish)(?:_?at)?|(?:profile|account)_?(?:url|ref))$/i;
const nodes = [], findings = [], tools = [];
for (const file of all) {
    if (!/\.(?:[cm]?js|jsx|tsx?|prisma|sql|json|ya?ml|html|css)$/.test(file))
        continue;
    const category = classify(file), text = readSource(file), imports = [], unique = new Map();
    const source = /\.[cm]?[jt]sx?$/.test(file) ? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) : null;
    function add(n, rule, value) { const k = rule + ':' + value; if (unique.has(k)) {
        unique.get(k).count++;
        return;
    } const r = { file, line: source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1, rule, value, count: 1 }; unique.set(k, r); }
    function walk(n) {
        if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier))
            imports.push(n.moduleSpecifier.text);
        if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
            const name = n.expression.getText(source);
            if (name === 'require' || n.expression.kind === ts.SyntaxKind.ImportKeyword)
                imports.push(n.arguments[0].text);
            if (name.endsWith('.registerTool') && task.test(n.arguments[0].text))
                tools.push({ file, line: source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1, name: n.arguments[0].text });
        }
        if (ts.isIdentifier(n) && task.test(n.text))
            add(n, 'task_identifier', n.text);
        if (ts.isStringLiteralLike(n)) {
            if (/^ba_/.test(n.text) && task.test(n.text))
                add(n, 'task_command', n.text);
            if (/^(?:sha256:)?[a-f0-9]{64}$/.test(n.text))
                add(n, 'fixed_digest', n.text);
            if (/^202[0-9]-\d\d-\d\dT/.test(n.text))
                add(n, 'fixed_date', n.text);
            if (/^user:\d+$/.test(n.text))
                add(n, 'fixed_actor', n.text);
        }
        if (ts.isPropertyAssignment(n)) {
            const k = n.name.getText(source).replace(/['"]/g, '');
            if (business.test(k) && (ts.isNumericLiteral(n.initializer) || ts.isStringLiteralLike(n.initializer)))
                add(n, 'business_literal', k + '=' + n.initializer.getText(source));
        }
        if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind) && business.test(n.left.getText(source).split('.').pop()) && (ts.isNumericLiteral(n.right) || ts.isStringLiteralLike(n.right)))
            add(n, 'business_comparison', n.left.getText(source) + n.operatorToken.getText(source) + n.right.getText(source));
        ts.forEachChild(n, walk);
    }
    if (source)
        walk(source);
    nodes.push({ file, category, lines: text.split('\n').length, imports, findings: unique.size });
    for (const r of unique.values())
        findings.push({ ...r, category });
}
const map = new Map(nodes.map(n => [n.file, n]));
const roots = ['src/server.ts', 'src/mcp/server.ts', 'src/mcp/remote-server.ts', 'src/publication-scheduler.ts', 'frontend/src/main.tsx', ...nodes.filter(n => n.file.startsWith('src/workers/')).map(n => n.file)];
const seen = new Set();
function visit(f) { if (seen.has(f) || !map.has(f))
    return; seen.add(f); for (const i of map.get(f).imports) {
    if (!i.startsWith('.'))
        continue;
    const b = path.posix.normalize(path.posix.join(path.posix.dirname(f), i));
    const resolved = [b, b + '.ts', b + '.tsx', b + '.js', b + '.mjs', b + '.cjs', b + '/index.ts', b + '/index.tsx'].find(k => map.has(k));
    if (resolved)
        visit(resolved);
} }
roots.forEach(visit);
for (const n of nodes)
    n.runtimeReachable = seen.has(n.file);
for (const f of findings)
    f.runtimeReachable = seen.has(f.file);
const categories = {}, rules = {};
for (const n of nodes)
    categories[n.category] = (categories[n.category] || 0) + 1;
for (const f of findings)
    rules[f.category + ':' + f.rule] = (rules[f.category + ':' + f.rule] || 0) + 1;
const mode = process.argv[2] || 'summary';
const page = Number(mode.split(':').at(-1)) || 0;
const selected = mode.startsWith('files:') ? nodes.map(({ imports, ...n }) => n).slice(page * 80, (page + 1) * 80) : mode.startsWith('edges:') ? nodes.filter(n => n.runtimeReachable).map(n => ({ file: n.file, imports: n.imports })).slice(page * 60, (page + 1) * 60) : mode.startsWith('findings:') ? findings.filter(n => n.category === 'operational').slice(page * 70, (page + 1) * 70) : mode === 'summary' ? { revision: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), trackedFileCount: all.length, parsedFileCount: nodes.length, categories, rules, roots, runtimeReachableCount: seen.size, taskNamedOperationalFiles: nodes.filter(n => n.category === 'operational' && task.test(n.file)).length, taskTools: tools.length } : mode === 'tools' ? tools : mode === 'files' ? nodes.map(({ imports, ...n }) => n) : mode === 'edges' ? nodes.filter(n => n.runtimeReachable).map(n => ({ file: n.file, imports: n.imports })) : findings.filter(n => n.category === 'operational' && n.file.startsWith(mode));
console.log(JSON.stringify(selected));
