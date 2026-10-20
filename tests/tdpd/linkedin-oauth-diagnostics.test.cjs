const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { verifyOAuthCode } = require('/source/src/services/linkedin_oauth_provider.ts');
const { oauthDiagnostic } = require('/source/src/services/linkedin_oauth_contract.ts');
process.env.API_URL = 'https://ui.example.invalid'; process.env.FRONTEND_URL = 'https://ui.example.invalid';
process.env.LINKEDIN_CLIENT_ID = 'synthetic-client'; process.env.LINKEDIN_CLIENT_SECRET = 'private-app-marker';
process.env.CHANNEL_SECRETS_KEY = 'synthetic-encryption-key-with-32-characters';
const valid = () => ({ active: true, client_id: 'synthetic-client', expires_at: Math.floor(Date.now()/1000)+3600, scope: 'r_basicprofile,w_member_social' });
const cases = [
    ['inactive', { active: false }, 'LINKEDIN_OAUTH_TOKEN_INACTIVE'],
    ['missing active', { active: undefined }, 'LINKEDIN_OAUTH_INTROSPECTION_INVALID'],
    ['missing client', { client_id: undefined }, 'LINKEDIN_OAUTH_TOKEN_CLIENT_MISSING'],
    ['foreign client', { client_id: 'foreign' }, 'LINKEDIN_OAUTH_TOKEN_CLIENT_MISMATCH'],
    ['missing expiry', { expires_at: undefined }, 'LINKEDIN_OAUTH_TOKEN_EXPIRY_INVALID'],
    ['invalid expiry', { expires_at: 'future' }, 'LINKEDIN_OAUTH_TOKEN_EXPIRY_INVALID'],
    ['expired', { expires_at: 1 }, 'LINKEDIN_OAUTH_TOKEN_EXPIRED'],
    ['missing scopes', { scope: undefined }, 'LINKEDIN_OAUTH_TOKEN_SCOPES_MISSING'],
    ['invalid scopes', { scope: 'r_basicprofile,private secret-marker' }, 'LINKEDIN_OAUTH_TOKEN_SCOPES_INVALID'],
    ['missing profile permission', { scope: 'w_member_social' }, 'LINKEDIN_OAUTH_PROFILE_SCOPE_REQUIRED'],
];
for (const [name, patch, expected] of cases) test(`diagnostic ${name} is specific and redacted`, async t => {
    const old = global.fetch; let profileReads = 0;
    global.fetch = async url => {
        if (String(url).includes('/accessToken')) return Response.json({ access_token: 'private-token-marker' });
        if (String(url).includes('/introspectToken')) return Response.json({ ...valid(), ...patch });
        profileReads++; return Response.json({ id: 'synthetic' });
    };
    t.after(() => { global.fetch = old; });
    await assert.rejects(verifyOAuthCode('private-code-marker', `${process.env.API_URL}/api/auth/linkedin/callback`, 'urn:li:person:synthetic', 'personal', null), error => {
        const diagnostic = oauthDiagnostic(error); assert.equal(diagnostic.code, expected);
        assert.ok(diagnostic.action); assert.doesNotMatch(JSON.stringify(diagnostic), /private-|secret-marker/); return true;
    });
    assert.equal(profileReads, 0);
});
test('invalid member ID differs from introspection errors', async t => {
    const old = global.fetch;
    global.fetch = async url => String(url).includes('/accessToken') ? Response.json({ access_token: 'private-token-marker' })
        : String(url).includes('/introspectToken') ? Response.json(valid()) : Response.json({ id: 'invalid profile secret' });
    t.after(() => { global.fetch = old; });
    await assert.rejects(verifyOAuthCode('synthetic', `${process.env.API_URL}/api/auth/linkedin/callback`, null, 'personal', null), error => error.code === 'LINKEDIN_OAUTH_PROFILE_ID_INVALID');
});
test('introspection authentication denial is redacted and distinguished', async t => {
    const old = global.fetch;
    global.fetch = async url => String(url).includes('/accessToken') ? Response.json({ access_token: 'private-token-marker' }) : new Response('private-provider-marker', { status: 401 });
    t.after(() => { global.fetch = old; });
    await assert.rejects(verifyOAuthCode('synthetic', `${process.env.API_URL}/api/auth/linkedin/callback`, null, 'personal', null), error => {
        assert.equal(error.code, 'LINKEDIN_OAUTH_APP_CREDENTIALS_REJECTED');
        assert.doesNotMatch(JSON.stringify(oauthDiagnostic(error)), /private-/); return true;
    });
});
