import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const plugin = JSON.parse(readFileSync(resolve(root, 'plugins/contentops-workspace/.codex-plugin/plugin.json'), 'utf8'))
const mcp = JSON.parse(readFileSync(resolve(root, 'plugins/contentops-workspace/.mcp.json'), 'utf8'))
const onboarding = readFileSync(resolve(root, 'plugins/contentops-workspace/skills/contentops-onboarding/SKILL.md'), 'utf8')
const oauthPage = readFileSync(resolve(root, 'frontend/src/pages/OAuthAuthorize.tsx'), 'utf8')
const remoteServer = readFileSync(resolve(root, 'src/mcp/remote-server.ts'), 'utf8')
const settings = readFileSync(resolve(root, 'frontend/src/pages/Settings.tsx'), 'utf8')
const projectRoutes = readFileSync(resolve(root, 'src/routes/project.routes.ts'), 'utf8')

test('external plugin declares the seven OAuth-backed role servers without embedded secrets', () => {
    assert.equal(plugin.name, 'contentops-workspace')
    assert.equal(plugin.mcpServers, './.mcp.json')
    assert.deepEqual(Object.keys(mcp.mcpServers).sort(), [
        'contentops-art-director', 'contentops-editor', 'contentops-growth-analyst', 'contentops-planner',
        'contentops-publisher', 'contentops-strategist', 'contentops-writer'
    ])
    for (const server of Object.values(mcp.mcpServers)) {
        assert.equal(server.type, 'http')
        assert.deepEqual(server.scopes, ['contentops:workspace'])
        assert.doesNotMatch(JSON.stringify(server), /Authorization|Bearer|mcp_[A-Za-z0-9_-]{20,}/)
    }
})

test('onboarding preserves role and publishing boundaries', () => {
    assert.match(onboarding, /ba_get_agent_workspace_manifest/)
    assert.match(onboarding, /matching the active manifest role/)
    assert.match(onboarding, /Do not publish merely because onboarding is requested/)
    assert.match(onboarding, /provider object ID or permalink/)
})

test('OAuth consent keeps project choice in Planner and MCP advertises discovery', () => {
    assert.match(oauthPage, /project\.role === 'owner'/)
    assert.match(oauthPage, /Пароль Planner в Codex не передаётся/)
    assert.match(remoteServer, /oauth-protected-resource/)
    assert.match(remoteServer, /WWW-Authenticate/)
    assert.match(remoteServer, /mcpOAuthService\.authenticate/)
    assert.match(settings, /mcp\/oauth-grants/)
    assert.match(settings, /OAuth-подключение отключено/)
    assert.match(projectRoutes, /revokeProjectGrant/)
})
