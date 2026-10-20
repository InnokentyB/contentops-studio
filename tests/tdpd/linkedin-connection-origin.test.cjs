const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const componentPath = path.resolve(__dirname, '../../frontend/src/components/LinkedInConnectionControl.tsx');

async function exercise(configuredOrigin) {
    const requests = [], navigations = [], effects = [];
    const states = ['urn:li:organization:12345', false, '', null, false, 0];
    let index = 0;
    const source = readFileSync(componentPath, 'utf8').replaceAll('import.meta.env.VITE_API_URL', JSON.stringify(configuredOrigin));
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports = {};
    const jsx = (type, props) => ({ type, props });
    vm.runInNewContext(compiled, {
        exports,
        AbortController, AbortSignal, URL,
        require(name) {
            if (name === 'react') return {
                useState: () => [states[index++], () => {}],
                useEffect: effect => effects.push(effect),
                useRef: value => ({ current: value }),
            };
            if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
            if (name === './linkedin-connection-state') {
                const helpers = {};
                const helperSource = readFileSync(path.join(path.dirname(componentPath), 'linkedin-connection-state.ts'), 'utf8');
                const copy = {};
                const copySource = readFileSync(path.join(path.dirname(componentPath), 'linkedin-oauth-failure-copy.ts'), 'utf8');
                vm.runInNewContext(ts.transpileModule(copySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: copy });
                vm.runInNewContext(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: helpers, URL, require: name => {
                    if (name === './linkedin-oauth-failure-copy') return copy;
                    throw new Error('Unexpected helper dependency');
                } });
                return helpers;
            }
            throw new Error('Unexpected dependency');
        },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, json: async () => ({ url: 'https://www.linkedin.com/oauth/v2/authorization?synthetic=1' }) };
        },
        window: { location: { assign: url => navigations.push(url) } },
    });
    const tree = exports.LinkedInConnectionControl({ projectId: 11, token: 'synthetic-only',
        channel: { id: 23, name: 'Synthetic organization', type: 'linkedin', config: { linkedin_urn: 'urn:li:organization:12345' } }, disabled: false, locale: 'en' });
    for (const effect of effects) effect();
    function findButton(node) {
        if (!node || typeof node !== 'object') return undefined;
        if (node.type === 'button') return node;
        return [node.props?.children].flat().map(findButton).find(Boolean);
    }
    await findButton(tree).props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    return { requests, navigations };
}

for (const configuredOrigin of ['', 'http://localhost:3003', 'https://different-origin.invalid']) {
    test(`Owner status/connect stay on current origin despite build setting ${configuredOrigin || '(unset)'}`, async () => {
        const { requests, navigations } = await exercise(configuredOrigin);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].url, '/api/auth/linkedin/status?projectId=11&channelId=23');
        assert.equal(requests[1].url, '/api/auth/linkedin/connect?projectId=11&channelId=23&expectedAuthorUrn=urn%3Ali%3Aorganization%3A12345');
        for (const request of requests) assert.equal(request.options.headers.Authorization, 'Bearer synthetic-only');
        assert.equal(requests[1].options.credentials, 'include');
        assert.deepEqual(navigations, ['https://www.linkedin.com/oauth/v2/authorization?synthetic=1']);
    });
}
