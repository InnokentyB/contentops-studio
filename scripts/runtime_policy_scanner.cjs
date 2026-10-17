// Static developer control, never a source of runtime publication authority.
const ts = require('typescript');
const crypto = require('node:crypto');
const path = require('node:path');
const {readSource, repositoryFiles, classify} = require('./runtime_policy_source.cjs');
const taskName = /(?:task|linkedin|dzen|threads|telegram|devto|medium|habr|setka|recovery|vk)[_-]?\d+|x[_-]?\d{3,}|(?:publish|release|claim|confirm|reconcile|recover|prepare|execute|dispatch|repair)[_-]?x[_-]?\d+/i;
const bindingName = /^(?:allowed_?|expected_?|exact_?|bound_?|target_?|canonical_?)?(?:(?:project|task|channel|account|actor|owner|user|work_?item|attempt|decision|release|selected_?asset|content_?item)(?:_?ids?)?|(?:accepted|content|source_?content)_?revision|(?:body|text|image|asset|manifest)_?(?:sha256|checksum)|(?:schedule|publish)(?:_?at)?|(?:profile|account)_?(?:url|ref))$/i;
const jsFile = /\.[cm]?[jt]sx?$/;
const supported = /\.(?:[cm]?[jt]sx?|prisma|sql|json|ya?ml|toml|html|css|sh|zsh)$|(?:^|\/)Dockerfile(?:\.[^/]+)?$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const printer = ts.createPrinter({removeComments: true});

function nameOf(node, source) {
    return node ? node.getText(source).replace(/['"]/g, '').split('.').at(-1) : '';
}

function businessExpression(node, source) {
    if (ts.isTypeOfExpression(node)) return false;
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
        const field = node.argumentExpression.text;
        return bindingName.test(field) || (field === 'id'
            && /(?:task|publication|channel|account|actor|owner|project|content_?item|release|attempt|asset)/i.test(node.expression.getText(source)));
    }
    const name = nameOf(node, source);
    if (bindingName.test(name)) return true;
    return name === 'id' && ts.isPropertyAccessExpression(node)
        && /(?:task|publication|channel|account|actor|owner|project|content_?item|release|attempt|asset)/i.test(node.expression.getText(source));
}

function literal(node) {
    return ts.isNumericLiteral(node) || ts.isStringLiteralLike(node)
        || (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));
}

function literalContainer(node) {
    if (literal(node)) return true;
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(literal);
    if (ts.isNewExpression(node)) return (node.arguments || []).some(literalContainer);
    if (ts.isCallExpression(node) && /(?:literal|enum)$/.test(node.expression.getText()))
        return node.arguments.some(literalContainer);
    return false;
}

function scanJs(file, text, errors) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) {
        errors.push({code: 'SOURCE_PARSE_ERROR', file, line: source.getLineAndCharacterOfPosition(source.parseDiagnostics[0].start || 0).line + 1});
        return {findings: [], imports: []};
    }
    const imports = [], findings = new Map(), normalized = new WeakMap(), dispatchTables = new Set();
    function findTables(node) {
        if (ts.isElementAccessExpression(node) && node.argumentExpression && businessExpression(node.argumentExpression, source)) dispatchTables.add(node.expression.getText(source));
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && ['get', 'has'].includes(node.expression.name.text) && node.arguments.some(arg => businessExpression(arg, source))) dispatchTables.add(node.expression.expression.getText(source));
        ts.forEachChild(node, findTables);
    }
    findTables(source);
    function add(node, rule) {
        let anchor = node;
        while (anchor.parent && !ts.isStatement(anchor) && !ts.isSourceFile(anchor.parent)) anchor = anchor.parent;
        if (!normalized.has(anchor)) normalized.set(anchor, printer.printNode(ts.EmitHint.Unspecified, anchor, source));
        const identity = digest(rule + '\0' + normalized.get(anchor) + '\0' + printer.printNode(ts.EmitHint.Unspecified, node, source));
        const key = rule + identity;
        if (findings.has(key)) { findings.get(key).count++; return; }
        findings.set(key, {file, rule, identity, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, count: 1});
    }
    function walk(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
            && (node.expression.getText(source) === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword)) imports.push(node.arguments[0].text);
        if (ts.isIdentifier(node) && taskName.test(node.text)) add(node, 'task_identifier');
        if (ts.isStringLiteralLike(node)) {
            if (taskName.test(node.text) && /(?:^ba_|^\/api\/|task|publish|release)/i.test(node.text)) add(node, 'task_command_or_route');
            if (/^(?:sha256:)?[a-f0-9]{64}$/.test(node.text)) add(node, 'fixed_digest');
            if (/^202\d-\d\d-\d\dT/.test(node.text)) add(node, 'fixed_date');
            if (/^user:\d+$/.test(node.text)) add(node, 'fixed_actor');
            if (/\b(?:publication_tasks|content_items)\b/i.test(node.text) && /\b(?:id|task_id)\s*=\s*\d+/.test(node.text)) add(node, 'fixed_sql_task');
        }
        if ((ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node)) && node.initializer
            && bindingName.test(nameOf(node.name, source)) && literalContainer(node.initializer)) add(node, 'business_binding');
        if (ts.isPropertyAssignment(node) && nameOf(node.name, source) === 'id' && literalContainer(node.initializer)) {
            let parent = node.parent;
            while (parent && !ts.isStatement(parent) && !ts.isCallExpression(parent)) parent = parent.parent;
            if (parent && ts.isCallExpression(parent) && /(?:contentItem|publicationTask|channel|project|account)\./i.test(parent.expression.getText(source))) add(node, 'business_record_lookup');
        }
        if (ts.isVariableDeclaration(node) && node.initializer && dispatchTables.has(node.name.getText(source))) {
            if (ts.isObjectLiteralExpression(node.initializer) && node.initializer.properties.some(property => property.name && /^['"]?\d+['"]?$/.test(property.name.getText(source)))) add(node, 'task_dispatch_table');
            if (ts.isNewExpression(node.initializer) && (node.initializer.arguments || []).some(arg => /\b\d+\b/.test(arg.getText(source)))) add(node, 'task_dispatch_table');
        }
        if (ts.isSwitchStatement(node) && businessExpression(node.expression, source)
            && node.caseBlock.clauses.some(clause => ts.isCaseClause(clause) && literal(clause.expression))) add(node, 'task_dispatch_case');
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && ['includes', 'has'].includes(node.expression.name.text)
            && node.arguments.some(arg => businessExpression(arg, source))
            && literalContainer(node.expression.expression)) add(node, 'task_dispatch_allowlist');
        if (ts.isBinaryExpression(node)) {
            if (['==', '===', '!=', '!==', '=', '??', '||'].includes(node.operatorToken.getText(source))) {
                if ((businessExpression(node.left, source) && literalContainer(node.right))
                    || (businessExpression(node.right, source) && literalContainer(node.left))) add(node, 'business_comparison');
            }
        }
        ts.forEachChild(node, walk);
    }
    walk(source);
    return {findings: [...findings.values()], imports};
}

function scanText(file, text, errors) {
    if (/\.json$/.test(file)) {
        try {
            if (/(?:^|\/)tsconfig[^/]*\.json$/.test(file)) {
                if (ts.parseConfigFileTextToJson(file, text).error) throw new Error('JSONC_PARSE_ERROR');
            } else JSON.parse(text);
        } catch { errors.push({code: 'SOURCE_PARSE_ERROR', file}); return []; }
    }
    if (/\.ya?ml$/.test(file)) {
        try { require('js-yaml').load(text); } catch { errors.push({code: 'SOURCE_PARSE_ERROR', file}); return []; }
    }
    const findings = new Map();
    for (const [offset, line] of text.split('\n').entries()) {
        if (/^\s*(?:#|\/\/|--)/.test(line)) continue;
        const binding = /(?:task|channel|project|account|actor|accepted_revision|content_revision)(?:_?ids?)?["']?\s*[:=]\s*["']?[\w:./-]+/i.test(line);
        // Initial model revision counters are protocol defaults, not a concrete task binding.
        const schemaDefault = /\b(?:task|channel|project|account|actor)(?:_?ids?)?\s+\w+\??\s+@default\(\s*["']?[\w:./-]+/i.test(line);
        const sqlTask = /\b(?:publication_tasks|content_items)\b/i.test(text) && /\b(?:id|task_id)\s*=\s*\d+/.test(line);
        if (taskName.test(line) || binding || schemaDefault || sqlTask) {
            const identity = digest(line.trim());
            if (findings.has(identity)) findings.get(identity).count++;
            else findings.set(identity, {file, rule: 'config_or_script_binding', identity, line: offset + 1, count: 1});
        }
    }
    return [...findings.values()];
}

function scanRepository() {
    const files = repositoryFiles(true), errors = [], records = new Map();
    for (const file of files) {
        if (!supported.test(file) || /(?:^|\/)\.env(?:\.|$)/.test(file)) continue;
        const category = classify(file);
        if (category === 'lock' || (category === 'historical' && !jsFile.test(file))) continue;
        const text = readSource(file);
        const result = jsFile.test(file) ? scanJs(file, text, errors) : {findings: scanText(file, text, errors), imports: []};
        if (taskName.test(file)) result.findings.push({file, rule: 'task_specific_module', identity: digest(file), line: 1, count: 1});
        records.set(file, {...result, category});
    }
    // Production importing a fixture/seed makes its bindings subject to the same gate.
    const active = new Set();
    function visit(file) {
        if (active.has(file) || !records.has(file)) return;
        active.add(file);
        for (const specifier of records.get(file).imports) {
            if (!specifier.startsWith('.')) continue;
            const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
            const target = [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'].map(ext => base + ext)].find(candidate => records.has(candidate));
            if (target) visit(target);
        }
    }
    for (const [file, record] of records) if (record.category === 'operational') visit(file);
    const findings = [...records].filter(([file]) => active.has(file)).flatMap(([, record]) => record.findings)
        .sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.identity.localeCompare(b.identity));
    return {findings, errors, scannedFiles: records.size, operationalFiles: active.size};
}

module.exports = {scanRepository, digest};
