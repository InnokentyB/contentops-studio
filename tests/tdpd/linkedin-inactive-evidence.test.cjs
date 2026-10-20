const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { verifyOAuthCode } = require('/source/src/services/linkedin_oauth_provider.ts');
const { oauthDiagnostic } = require('/source/src/services/linkedin_oauth_contract.ts');
const { connectionDiagnostic } = (() => {
    const ts = require('typescript'), fs = require('node:fs'), vm = require('node:vm');
    function load(path) { const mod = { exports: {} }; const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        vm.runInNewContext(code, { exports: mod.exports, module: mod, URL, require: () => load('/source/frontend/src/components/linkedin-oauth-failure-copy.ts') }); return mod.exports; }
    return load('/source/frontend/src/components/linkedin-connection-state.ts');
})();
Object.assign(process.env, { API_URL: 'https://ui.example.invalid', FRONTEND_URL: 'https://ui.example.invalid', LINKEDIN_CLIENT_ID: 'synthetic-client', LINKEDIN_CLIENT_SECRET: 'private-secret+&=', CHANNEL_SECRETS_KEY: 'synthetic-encryption-key-with-32-characters' });
const token = 'private-token+ /&=%?\u00e9';
for (const [name, response, expected] of [
    ['revoked', { active: false, status: 'revoked' }, 'LINKEDIN_OAUTH_TOKEN_REVOKED'],
    ['expired', { active: false, status: 'expired' }, 'LINKEDIN_OAUTH_TOKEN_EXPIRED'],
    ['explicit other app', { active: false, client_id: 'other-app' }, 'LINKEDIN_OAUTH_TOKEN_CLIENT_MISMATCH'],
    ['contradictory status', { active: false, status: 'active' }, 'LINKEDIN_OAUTH_INTROSPECTION_INCONSISTENT'],
    ['no reason', { active: false }, 'LINKEDIN_OAUTH_TOKEN_INACTIVE'],
    ['unknown raw reason', { active: false, status: 'private-provider-secret' }, 'LINKEDIN_OAUTH_TOKEN_INACTIVE'],
]) test(`inactive evidence: ${name}; exact exchange token is encoded once and never exposed`, async t => {
    const old = global.fetch; const calls = [];
    global.fetch = async (url, options) => {
        calls.push(String(url)); assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
        assert.equal(options.redirect, 'error');
        const body = new URLSearchParams(options.body.toString());
        assert.equal(body.get('client_id'), process.env.LINKEDIN_CLIENT_ID);
        assert.equal(body.get('client_secret'), process.env.LINKEDIN_CLIENT_SECRET);
        if (String(url).endsWith('/accessToken')) {
            assert.equal(body.get('code'), 'synthetic-code+&=');
            return Response.json({ access_token: token, expires_in: 5184000 });
        }
        assert.equal(String(url), 'https://www.linkedin.com/oauth/v2/introspectToken');
        assert.equal(body.get('token'), token);
        assert.deepEqual([...body.keys()].sort(), ['client_id', 'client_secret', 'token']);
        return Response.json({ ...response, raw: 'private-provider-secret' });
    };
    t.after(() => { global.fetch = old; });
    await assert.rejects(verifyOAuthCode('synthetic-code+&=', `${process.env.API_URL}/api/auth/linkedin/callback`, 'urn:li:organization:123', 'organization', null), error => {
        assert.equal(error.code, expected);
        const diagnostic = oauthDiagnostic(error);
        for (const locale of ['ru', 'en']) {
            const copy = connectionDiagnostic(expected, locale);
            assert.doesNotMatch(copy, /Не удалось проверить подключение|Connection could not be checked/);
            assert.doesNotMatch(copy, /private-/);
        }
        assert.doesNotMatch(JSON.stringify(diagnostic), /private-/); return true;
    });
    assert.equal(calls.length, 2, 'one exchange, one introspection; no retry or profile/publication call');
});
test('unexplained inactive token does not claim revoked access or established root cause', () => {
    assert.match(connectionDiagnostic('LINKEDIN_OAUTH_TOKEN_INACTIVE', 'ru'), /не указал|не раскры|не сообщ/);
});
