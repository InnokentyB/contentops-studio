"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("../bootstrap-env");
const crypto_1 = require("crypto");
const express_js_1 = require("@modelcontextprotocol/sdk/server/express.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const shared_1 = require("./shared");
const schema_plan_service_1 = __importDefault(require("../services/schema_plan.service"));
const remote_auth_1 = require("./remote-auth");
function parsePort(value, fallback) {
    const parsed = Number(value || fallback);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid port value: ${value}`);
    }
    return parsed;
}
function getBearerToken(headerValue) {
    if (!headerValue) {
        return null;
    }
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const match = raw.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}
function safeTokenEquals(expected, actual) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length) {
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(expectedBuffer, actualBuffer);
}
async function main() {
    const port = parsePort(process.env.PORT || process.env.MCP_PORT, 8080);
    const host = process.env.MCP_HOST || '0.0.0.0';
    const authToken = (process.env.MCP_AUTH_TOKEN || '').trim();
    const principalUserId = Number(process.env.MCP_PRINCIPAL_USER_ID || 0);
    const principal = Number.isInteger(principalUserId) && principalUserId > 0
        ? { userId: principalUserId, actorId: `user:${principalUserId}`, profile: 'owner' }
        : null;
    const defaultProjectId = Number(process.env.MCP_PROJECT_ID || 0);
    const buildScopedCredential = (profile) => {
        const upper = profile.toUpperCase();
        const token = String(process.env[`MCP_${upper}_AUTH_TOKEN`] || '').trim();
        const userId = Number(process.env[`MCP_${upper}_USER_ID`] || principalUserId || 0);
        const projectId = Number(process.env[`MCP_${upper}_PROJECT_ID`] || defaultProjectId || 0);
        if (!token || !Number.isInteger(userId) || userId <= 0 || !Number.isInteger(projectId) || projectId <= 0) {
            return null;
        }
        return {
            token,
            principal: { userId, actorId: `user:${userId}`, projectId, profile }
        };
    };
    const plannerCredential = buildScopedCredential('planner');
    const writerCredential = buildScopedCredential('writer');
    const isProduction = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
    if (isProduction && (!authToken || !principal)) {
        throw new Error('Production remote MCP requires MCP_AUTH_TOKEN and MCP_PRINCIPAL_USER_ID');
    }
    const sessions = new Map();
    const app = (0, express_js_1.createMcpExpressApp)({ host });
    function requireAuth(req, res, next) {
        if (!authToken) {
            next();
            return;
        }
        const token = getBearerToken(req.headers.authorization);
        if (!token || !safeTokenEquals(authToken, token)) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing or invalid bearer token'
            });
            return;
        }
        next();
    }
    async function closeSession(sessionId) {
        const entry = sessions.get(sessionId);
        if (!entry) {
            return;
        }
        sessions.delete(sessionId);
        try {
            await entry.server.close();
        }
        catch (_error) {
            // Ignore server close errors during cleanup.
        }
    }
    async function getOrCreateSession(sessionId, body, res, endpoint = '/mcp', profile = 'owner') {
        if (sessionId && sessions.has(sessionId)) {
            const entry = sessions.get(sessionId);
            if (entry.endpoint !== endpoint || entry.profile !== profile) {
                res.status(403).json({ error: 'MCP session capability mismatch' });
                return null;
            }
            return entry;
        }
        if (sessionId && !sessions.has(sessionId)) {
            res.status(404).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'Unknown MCP session'
                },
                id: null
            });
            return null;
        }
        if (!(0, types_js_1.isInitializeRequest)(body)) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided'
                },
                id: null
            });
            return null;
        }
        let transport;
        const server = (0, shared_1.createPlannerMcpServer)({ profile });
        transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: () => (0, crypto_1.randomUUID)(),
            enableJsonResponse: true,
            onsessioninitialized: (newSessionId) => {
                sessions.set(newSessionId, { transport, server, endpoint, profile });
            }
        });
        transport.onclose = () => {
            const currentSessionId = transport.sessionId;
            if (currentSessionId && sessions.has(currentSessionId)) {
                sessions.delete(currentSessionId);
            }
        };
        transport.onerror = (error) => {
            console.error('[MCP Remote] Transport error:', error);
        };
        await server.connect(transport);
        return { transport, server };
    }
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            ts: new Date().toISOString(),
            uptime_s: Math.round(process.uptime()),
            transport: 'streamable-http',
            auth: {
                bearer_required: Boolean(authToken),
                principal_scoped: Boolean(principal)
            },
            capability_endpoints: {
                planner: plannerCredential ? {
                    configured: true,
                    project_id: plannerCredential.principal.projectId,
                    user_id: plannerCredential.principal.userId
                } : { configured: false },
                writer: writerCredential ? {
                    configured: true,
                    project_id: writerCredential.principal.projectId,
                    user_id: writerCredential.principal.userId
                } : { configured: false }
            },
            active_sessions: sessions.size,
            schema_plan: schema_plan_service_1.default.getPlan(),
            parser: {
                api_base_url_configured: Boolean(process.env.PARSER_API_BASE_URL)
            }
        });
    });
    app.options('/mcp', (_req, res) => {
        res.set('Allow', 'GET, POST, DELETE, OPTIONS').status(204).send();
    });
    app.get('/mcp', requireAuth, async (req, res) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
        const entry = sessionId ? sessions.get(sessionId) : null;
        if (!entry || entry.endpoint !== '/mcp') {
            res.status(400).send('Invalid or missing session ID');
            return;
        }
        await entry.transport.handleRequest(req, res);
    });
    app.post('/mcp', requireAuth, async (req, res) => {
        try {
            const scopedRequest = (0, remote_auth_1.scopeRemoteMcpRequest)(req.body, principal);
            if (!scopedRequest.allowed) {
                res.status(403).json({
                    jsonrpc: '2.0',
                    error: { code: -32003, message: 'Tool is not available through scoped remote MCP' },
                    id: req.body?.id ?? null
                });
                return;
            }
            req.body = scopedRequest.body;
            const sessionIdHeader = req.headers['mcp-session-id'];
            const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
            const entry = await getOrCreateSession(sessionId, req.body, res);
            if (!entry) {
                return;
            }
            await entry.transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            console.error('[MCP Remote] Failed to handle POST request:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error'
                    },
                    id: null
                });
            }
        }
    });
    app.delete('/mcp', requireAuth, async (req, res) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
        const entry = sessionId ? sessions.get(sessionId) : null;
        if (!entry || entry.endpoint !== '/mcp') {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided'
                },
                id: null
            });
            return;
        }
        await entry.transport.handleRequest(req, res, req.body);
    });
    function registerScopedEndpoint(endpoint, credential) {
        const requireScopedAuth = (req, res, next) => {
            if (!credential) {
                res.status(503).json({ error: 'Capability endpoint is not configured' });
                return;
            }
            const token = getBearerToken(req.headers.authorization);
            if (!token || !safeTokenEquals(credential.token, token)) {
                res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid bearer token' });
                return;
            }
            next();
        };
        app.get(endpoint, requireScopedAuth, async (req, res) => {
            const sessionIdHeader = req.headers['mcp-session-id'];
            const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
            const entry = sessionId ? sessions.get(sessionId) : null;
            if (!entry || entry.endpoint !== endpoint || entry.profile !== credential?.principal.profile) {
                res.status(400).send('Invalid or missing session ID');
                return;
            }
            await entry.transport.handleRequest(req, res);
        });
        app.post(endpoint, requireScopedAuth, async (req, res) => {
            try {
                const scopedRequest = (0, remote_auth_1.scopeRemoteMcpRequest)(req.body, credential.principal);
                if (!scopedRequest.allowed) {
                    res.status(403).json({
                        jsonrpc: '2.0',
                        error: { code: -32003, message: 'Tool is not available for this MCP capability profile' },
                        id: req.body?.id ?? null
                    });
                    return;
                }
                req.body = scopedRequest.body;
                const sessionIdHeader = req.headers['mcp-session-id'];
                const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
                const entry = await getOrCreateSession(sessionId, req.body, res, endpoint, credential.principal.profile);
                if (!entry)
                    return;
                await entry.transport.handleRequest(req, res, req.body);
            }
            catch (error) {
                console.error(`[MCP Remote] Failed to handle ${endpoint} POST request:`, error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: { code: -32603, message: 'Internal server error' },
                        id: null
                    });
                }
            }
        });
        app.delete(endpoint, requireScopedAuth, async (req, res) => {
            const sessionIdHeader = req.headers['mcp-session-id'];
            const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
            const entry = sessionId ? sessions.get(sessionId) : null;
            if (!entry || entry.endpoint !== endpoint || entry.profile !== credential?.principal.profile) {
                res.status(400).json({ error: 'Invalid or missing session ID' });
                return;
            }
            await entry.transport.handleRequest(req, res, req.body);
        });
    }
    registerScopedEndpoint('/mcp/planner', plannerCredential);
    registerScopedEndpoint('/mcp/writer', writerCredential);
    const server = app.listen(port, host, () => {
        console.log(`[MCP Remote] listening on http://${host}:${port} (auth required: ${Boolean(authToken)})`);
    });
    async function shutdown(signal, code = 0) {
        console.log(`[MCP Remote] Shutting down on ${signal}`);
        for (const sessionId of Array.from(sessions.keys())) {
            await closeSession(sessionId);
        }
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        await (0, shared_1.shutdownMcpResources)();
        process.exit(code);
    }
    process.on('SIGINT', () => {
        shutdown('SIGINT', 0).catch((error) => {
            console.error('[MCP Remote] SIGINT shutdown failed:', error);
            process.exit(1);
        });
    });
    process.on('SIGTERM', () => {
        shutdown('SIGTERM', 0).catch((error) => {
            console.error('[MCP Remote] SIGTERM shutdown failed:', error);
            process.exit(1);
        });
    });
}
main().catch(async (error) => {
    console.error('[MCP Remote] Startup failed:', error);
    await (0, shared_1.shutdownMcpResources)().catch(() => { });
    process.exit(1);
});
