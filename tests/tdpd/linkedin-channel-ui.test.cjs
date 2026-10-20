const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const frontendModules = process.env.FRONTEND_NODE_MODULES || '/opt/planner/frontend/node_modules';
const React = require(path.join(frontendModules, 'react'));
const { renderToStaticMarkup } = require(path.join(frontendModules, 'react-dom/server'));
const componentPath = path.resolve(__dirname, '../../frontend/src/components/LinkedInConnectionControl.tsx');

function load(file) {
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, AbortController, AbortSignal, URL, require(name) {
        if (name.startsWith('.')) {
            const base = path.resolve(path.dirname(file), name);
            return load(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx');
        }
        return require(path.join(frontendModules, name));
    } });
    return exports;
}
const props = { projectId: 11, token: 'synthetic-only', channel: { id: 23,
    name: 'Synthetic company page', type: 'linkedin', config: { linkedin_urn: 'urn:li:organization:12345' } },
    channels: [{ id: 23, name: 'Synthetic company page', type: 'linkedin' }], disabled: false, locale: 'ru' };

test('existing channel owns its connection panel without another channel selector', () => {
    const { LinkedInConnectionControl } = load(componentPath);
    const html = renderToStaticMarkup(React.createElement(LinkedInConnectionControl, props));
    assert.doesNotMatch(html, /<select/);
    assert.match(html, /urn:li:organization:12345/);
    assert.match(html, /Проверить подключение/);
    assert.match(html, /Подключить LinkedIn/);
    assert.doesNotMatch(html, /Analytics access needed|Нужен доступ к аналитике/);
});
test('non-owner sees a clear restriction and disabled connection actions', () => {
    const { LinkedInConnectionControl } = load(componentPath);
    const html = renderToStaticMarkup(React.createElement(LinkedInConnectionControl, { ...props, disabled: true }));
    assert.match(html, /владелец проекта/);
    assert.equal((html.match(/<button[^>]*disabled/g) || []).length, 2);
});
test('English panel keeps channel identity but never renders a stored token', () => {
    const { LinkedInConnectionControl } = load(componentPath);
    const channel = { ...props.channel, config: { ...props.channel.config, access_token: 'must-not-render-secret' } };
    const html = renderToStaticMarkup(React.createElement(LinkedInConnectionControl, { ...props, channel, locale: 'en' }));
    assert.match(html, /Check connection/);
    assert.match(html, /Connect LinkedIn/);
    assert.doesNotMatch(html, /must-not-render-secret/);
});
test('general add form cannot start LinkedIn OAuth and channel editor binds exact channel', () => {
    const settings = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Settings.tsx'), 'utf8');
    assert.ok(!/channels=\{\(projectData\?\.channels/.test(settings), 'Remove general channel selector');
    assert.ok(/<LinkedInChannelEditor[\s\S]{0,400}channel=\{channel\}/.test(settings), 'Bind the channel editor');
    assert.ok(!/needsLinkedinAnalytics/.test(settings), 'Analytics is not connection status');
});

test('status parser rejects another channel, missing expiry and provider secrets in scopes', () => {
    const { readConnectionStatus } = load(path.join(path.dirname(componentPath), 'linkedin-connection-state.ts'));
    const status = { channelId: 23, connected: true, expiresAt: '2099-01-01T00:00:00Z', scopes: ['w_organization_social'], accountKind: 'organization',
        postReadVerified: true, imageReadPermitted: true, code: 'LINKEDIN_OAUTH_CONNECTED' };
    assert.equal(readConnectionStatus(status, 23).connected, true);
    assert.equal(readConnectionStatus({ ...status, channelId: 24 }, 23), null);
    assert.equal(readConnectionStatus({ ...status, expiresAt: null }, 23), null);
    assert.equal(readConnectionStatus({ ...status, scopes: ['Bearer secret-value'] }, 23), null);
});
test('unsafe OAuth targets and raw diagnostic messages never reach navigation or UI', () => {
    const { connectionRedirect, connectionDiagnostic } = load(path.join(path.dirname(componentPath), 'linkedin-connection-state.ts'));
    for (const url of ['https://evil.invalid/oauth/v2/authorization', 'javascript:alert(1)', 'https://secret@www.linkedin.com/oauth/v2/authorization'])
        assert.equal(connectionRedirect({ url }), null);
    assert.equal(connectionRedirect({ url: 'https://www.linkedin.com/oauth/v2/authorization?synthetic=1' }), 'https://www.linkedin.com/oauth/v2/authorization?synthetic=1');
    assert.ok(!connectionDiagnostic('raw-provider-secret', 'ru').includes('raw-provider-secret'));
});
