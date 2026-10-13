import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
/** Traverse actual local provider imports; comments/docs are not executable API calls. */
test('VKROUTE-005 governed adapter graph cannot import Computer Use or call personal-tab/CDP controls', () => {
    const root = path.resolve('src');
    const pending = ['workers/vk_connector_consumer.ts', 'services/vk1048_operator_dispatch.ts', 'services/vk1048_provider_execution.ts']
        .map(file => path.join(root, file));
    const seen = new Set<string>(), forbidden: string[] = [];
    while (pending.length) {
        const file = pending.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const inspectImport = (value: string) => {
            if (/cua|computer[-_]use|unified[-_]computer/i.test(value)) forbidden.push(`${file}: forbidden dependency`);
            if (value.startsWith('.')) {
                const resolved = path.resolve(path.dirname(file), value.replace(/\.js$/, ''));
                const target = [`${resolved}.ts`, path.join(resolved, 'index.ts')].find(p => fs.existsSync(p));
                if (target && target.startsWith(`${root}${path.sep}`)) pending.push(target);
            }
        };
        const visit = (node: ts.Node): void => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) inspectImport(node.moduleSpecifier.text);
            if (ts.isCallExpression(node)) {
                const expression = node.expression;
                if ((expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expression) && expression.text === 'require'))
                    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) inspectImport(node.arguments[0].text);
                if (ts.isPropertyAccessExpression(expression) && ['getTab', 'getApp', 'connectOverCDP', 'createBrowserTab'].includes(expression.name.text)) {
                    forbidden.push(`${file}: forbidden control call`);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    assert.ok(seen.size > 10, 'provider dependency graph must be traversed');
    assert.deepEqual(forbidden, []);
});
