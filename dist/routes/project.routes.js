"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = projectRoutes;
const auth_service_1 = __importDefault(require("../services/auth.service"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const multi_agent_service_1 = __importDefault(require("../services/multi_agent.service"));
const content_dictionary_service_1 = __importDefault(require("../services/content_dictionary.service"));
const content_policy_matrix_service_1 = __importDefault(require("../services/content_policy_matrix.service"));
const publication_plan_service_1 = __importDefault(require("../services/publication_plan.service"));
const egress_diagnostics_1 = require("../utils/egress_diagnostics");
const parser_integration_service_1 = __importDefault(require("../services/parser_integration.service"));
const storage_service_1 = __importDefault(require("../services/storage.service"));
const generator_service_1 = __importDefault(require("../services/generator.service"));
const project_utils_1 = require("../utils/project.utils");
const channel_utils_1 = require("../utils/channel.utils");
const dzen_service_1 = __importDefault(require("../services/dzen.service"));
const initiative_service_1 = __importDefault(require("../services/initiative.service"));
const work_queue_service_1 = __importDefault(require("../services/work_queue.service"));
const planner_service_1 = require("../services/planner.service");
const agentSettingKeyMap = {
    post_creator: {
        prompt: multi_agent_service_1.default.KEY_POST_CREATOR_PROMPT,
        key: multi_agent_service_1.default.KEY_POST_CREATOR_KEY,
        model: multi_agent_service_1.default.KEY_POST_CREATOR_MODEL
    },
    post_critic: {
        prompt: multi_agent_service_1.default.KEY_POST_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_POST_CRITIC_MODEL
    },
    post_fixer: {
        prompt: multi_agent_service_1.default.KEY_POST_FIXER_PROMPT,
        key: multi_agent_service_1.default.KEY_POST_FIXER_KEY,
        model: multi_agent_service_1.default.KEY_POST_FIXER_MODEL
    },
    topic_creator: {
        prompt: multi_agent_service_1.default.KEY_TOPIC_CREATOR_PROMPT,
        key: multi_agent_service_1.default.KEY_TOPIC_CREATOR_KEY,
        model: multi_agent_service_1.default.KEY_TOPIC_CREATOR_MODEL
    },
    topic_critic: {
        prompt: multi_agent_service_1.default.KEY_TOPIC_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_TOPIC_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_TOPIC_CRITIC_MODEL
    },
    topic_fixer: {
        prompt: multi_agent_service_1.default.KEY_TOPIC_FIXER_PROMPT,
        key: multi_agent_service_1.default.KEY_TOPIC_FIXER_KEY,
        model: multi_agent_service_1.default.KEY_TOPIC_FIXER_MODEL
    },
    visual_architect: {
        prompt: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_PROMPT,
        key: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_KEY,
        model: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_MODEL
    },
    structural_critic: {
        prompt: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_MODEL
    },
    precision_fixer: {
        prompt: multi_agent_service_1.default.KEY_PRECISION_FIXER_PROMPT,
        key: multi_agent_service_1.default.KEY_PRECISION_FIXER_KEY,
        model: multi_agent_service_1.default.KEY_PRECISION_FIXER_MODEL
    },
    image_critic: {
        prompt: multi_agent_service_1.default.KEY_IMAGE_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_IMAGE_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_IMAGE_CRITIC_MODEL
    }
};
function detectProviderFromKey(key) {
    if (key.startsWith('sk-ant'))
        return 'Anthropic';
    if (key.startsWith('AIza'))
        return 'Gemini';
    if (key.startsWith('sk-'))
        return 'OpenAI';
    return 'Other';
}
function inferManualContentType(channelType, fileType) {
    if (channelType === 'linkedin')
        return 'linkedin:manual_content';
    if (channelType === 'reddit')
        return 'reddit:manual_content';
    if (channelType === 'tilda')
        return 'tilda:manual_content';
    if (channelType === 'medium')
        return 'medium:manual_content';
    if (channelType === 'indiehackers')
        return 'indiehackers:manual_content';
    if (fileType === 'html')
        return `${channelType}:manual_html`;
    return `${channelType}:manual_markdown`;
}
function inferManualResourceKind(fileName, mimeType) {
    const lowerName = fileName.toLowerCase();
    const lowerMime = (mimeType || '').toLowerCase();
    if (lowerMime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(lowerName)) {
        return 'image';
    }
    if (lowerMime.includes('html') || /\.(html|htm)$/.test(lowerName)) {
        return 'html';
    }
    if (lowerMime.includes('markdown') || /\.(md|markdown)$/.test(lowerName)) {
        return 'markdown';
    }
    if (lowerMime.startsWith('text/') || /\.(txt|json|ya?ml)$/.test(lowerName)) {
        return 'text';
    }
    return 'file';
}
function readMultipartField(field) {
    if (field == null)
        return '';
    if (typeof field === 'string')
        return field;
    if (typeof field?.value === 'string')
        return field.value;
    return '';
}
function isAutoCanvasChannel(channel) {
    const workflowMode = channel?.config?.workflow_mode || channel?.config?.raw_account?.planner_generation_mode || null;
    if (workflowMode === 'auto_canvas')
        return true;
    const normalizedName = String(channel?.name || '').toLowerCase();
    return normalizedName.includes('analysts_thinking')
        || normalizedName.includes('analyst_thinking')
        || normalizedName.includes('аналитик который думал');
}
function createConnectionId(name) {
    const base = (0, project_utils_1.slugifyProjectName)(name) || 'skill-connection';
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
function parseProjectId(raw) {
    const value = parseInt(raw, 10);
    if (Number.isNaN(value)) {
        throw new Error('Invalid project id');
    }
    return value;
}
async function makeUniqueProjectSlug(baseSlug, fallbackName, excludeProjectId) {
    const source = baseSlug?.trim() || fallbackName || 'project';
    const normalized = (0, project_utils_1.slugifyProjectName)(source) || `project-${Date.now()}`;
    let candidate = normalized;
    let suffix = 1;
    while (await planner_service_1.prisma.project.findFirst({
        where: {
            slug: candidate,
            ...(excludeProjectId ? { id: { not: excludeProjectId } } : {})
        }
    })) {
        candidate = `${normalized}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}
function parseImportedProjectConfig(rawConfig) {
    const trimmed = rawConfig.trim();
    if (!trimmed) {
        throw new Error('Configuration is empty');
    }
    const parsed = js_yaml_1.default.load(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Configuration must be a YAML or JSON object');
    }
    return parsed;
}
async function buildImportedProjectData(rawConfig, userId) {
    const parsed = parseImportedProjectConfig(rawConfig);
    const projectBlock = parsed.project || {};
    const name = projectBlock.name?.trim();
    if (!name) {
        throw new Error('`project.name` is required');
    }
    const slug = await makeUniqueProjectSlug(projectBlock.slug, name);
    const description = projectBlock.description?.trim() || null;
    const kind = (0, project_utils_1.normalizeProjectKind)(projectBlock.kind);
    const settings = Object.entries(parsed.settings || {})
        .filter(([key, value]) => typeof key === 'string' && key.trim() && value !== undefined && value !== null)
        .map(([key, value]) => ({
        key: key.trim(),
        value: typeof value === 'string' ? value : JSON.stringify(value)
    }));
    const dictionaryYaml = parsed.content_dictionary !== undefined
        ? content_dictionary_service_1.default.normalizeToYaml(parsed.content_dictionary)
        : null;
    const contentPolicyMatrixYaml = parsed.content_policy_matrix !== undefined
        ? content_policy_matrix_service_1.default.normalizeToYaml(parsed.content_policy_matrix)
        : null;
    const channels = (parsed.channels || []).map((channel, index) => {
        if (!channel?.type || !channel?.name) {
            throw new Error(`channels[${index}] must include both type and name`);
        }
        return {
            type: channel.type.trim(),
            name: channel.name.trim(),
            config: (channel.config || {})
        };
    });
    const providerKeys = (parsed.provider_keys || []).map((providerKey, index) => {
        if (!providerKey?.name || !providerKey?.key) {
            throw new Error(`provider_keys[${index}] must include name and key`);
        }
        return {
            name: providerKey.name.trim(),
            key: providerKey.key.trim(),
            provider: providerKey.provider?.trim() || detectProviderFromKey(providerKey.key.trim())
        };
    });
    const agentSettings = Object.entries(parsed.agents || {}).flatMap(([role, config]) => {
        if (role === 'gpt_image_gen') {
            if (config?.prompt === undefined) {
                throw new Error('gpt_image_gen must include prompt');
            }
            return [{ key: 'image_generation_prompt', value: String(config.prompt) }];
        }
        if (role === 'nano_image_gen') {
            if (config?.prompt === undefined) {
                throw new Error('nano_image_gen must include prompt');
            }
            return [{ key: 'nano_banana_image_prompt', value: String(config.prompt) }];
        }
        const keys = agentSettingKeyMap[role];
        if (!keys) {
            throw new Error(`Unsupported agent role: ${role}`);
        }
        const entries = [];
        if (config?.prompt !== undefined)
            entries.push({ key: keys.prompt, value: String(config.prompt) });
        if (config?.apiKey !== undefined)
            entries.push({ key: keys.key, value: String(config.apiKey) });
        if (config?.model !== undefined)
            entries.push({ key: keys.model, value: String(config.model) });
        return entries;
    });
    const presets = (parsed.presets || []).map((preset, index) => {
        if (!preset?.name || !preset?.role || !preset?.prompt_text) {
            throw new Error(`presets[${index}] must include name, role and prompt_text`);
        }
        return {
            name: preset.name.trim(),
            role: preset.role.trim(),
            prompt_text: preset.prompt_text
        };
    });
    const skillConnections = (parsed.skill_connections || []).map((connection, index) => {
        if (!connection?.name || !connection?.provider || !connection?.model) {
            throw new Error(`skill_connections[${index}] must include name, provider and model`);
        }
        const providerKeyName = connection.providerKeyName?.trim();
        if (providerKeyName && !providerKeys.find((key) => key.name === providerKeyName)) {
            throw new Error(`skill_connections[${index}] references unknown provider key: ${providerKeyName}`);
        }
        return {
            id: connection.id?.trim() || createConnectionId(connection.name),
            name: connection.name.trim(),
            provider: connection.provider.trim(),
            model: connection.model.trim(),
            providerKeyId: typeof connection.providerKeyId === 'number' ? connection.providerKeyId : null,
            providerKeyName: providerKeyName || null,
            endpointType: connection.endpointType?.trim() || 'native',
            skillMode: connection.skillMode?.trim() || 'native_skills',
            enabledSkills: Array.isArray(connection.enabledSkills)
                ? connection.enabledSkills.map((skill) => String(skill).trim()).filter(Boolean)
                : [],
            systemPrompt: connection.systemPrompt || '',
            notes: connection.notes || '',
            enabled: connection.enabled !== false,
            supportsSkills: connection.supportsSkills !== false
        };
    });
    const uniqueSettings = Array.from(new Map([
        ...settings,
        ...agentSettings,
        ...(dictionaryYaml ? [{ key: 'content_dictionary_yaml', value: dictionaryYaml }] : []),
        ...(contentPolicyMatrixYaml ? [{ key: 'content_policy_matrix_yaml', value: contentPolicyMatrixYaml }] : [])
    ].map((setting) => [setting.key, setting])).values());
    return {
        project: {
            name,
            slug,
            description,
            kind,
            members: {
                create: {
                    user_id: userId,
                    role: 'owner'
                }
            }
        },
        settings: uniqueSettings,
        providerKeys,
        channels,
        presets,
        skillConnections
    };
}
async function projectRoutes(fastify) {
    // Middleware-like check for project routes
    fastify.addHook('preHandler', async (request, reply) => {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Auth required' });
            return;
        }
        try {
            request.user = auth_service_1.default.verifyToken(token);
        }
        catch (e) {
            reply.code(401).send({ error: 'Invalid token' });
        }
    });
    // List user projects
    fastify.get('/api/projects', async (request, reply) => {
        const user = request.user;
        const projects = await auth_service_1.default.getUserProjects(user.id);
        return projects;
    });
    fastify.get('/api/projects/:id/operational-calendar', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { fromDate, toDate } = request.query;
        const projectId = parseProjectId(id);
        const from = fromDate || new Date().toISOString().slice(0, 10);
        const to = toDate || from;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
            return reply.code(400).send({ error: 'fromDate and toDate must be a valid ascending YYYY-MM-DD range' });
        }
        const actorId = `user:${user.id}`;
        try {
            return await initiative_service_1.default.getOperationalCalendarView({
                projectId,
                actorId,
                fromDate: from,
                toDate: to
            });
        }
        catch (error) {
            const denied = /Access denied|Security/.test(error?.message || '');
            return reply.code(denied ? 403 : 400).send({ error: error?.message || 'Unable to load operational calendar' });
        }
    });
    // Create project
    fastify.post('/api/projects', async (request, reply) => {
        const user = request.user;
        const { name, slug, description, kind } = request.body;
        const finalSlug = await makeUniqueProjectSlug(slug, name);
        const project = await planner_service_1.prisma.project.create({
            data: {
                name,
                slug: finalSlug,
                description,
                kind: (0, project_utils_1.normalizeProjectKind)(kind),
                members: {
                    create: {
                        user_id: user.id,
                        role: 'owner'
                    }
                }
            }
        });
        return project;
    });
    fastify.post('/api/projects/import', async (request, reply) => {
        const user = request.user;
        const { config } = request.body;
        if (!config || typeof config !== 'string') {
            return reply.code(400).send({ error: 'Configuration text is required' });
        }
        try {
            const imported = await buildImportedProjectData(config, user.id);
            const project = await planner_service_1.prisma.$transaction(async (tx) => {
                const createdProject = await tx.project.create({
                    data: imported.project
                });
                if (imported.settings.length > 0) {
                    await tx.projectSettings.createMany({
                        data: imported.settings.map((setting) => ({
                            project_id: createdProject.id,
                            key: setting.key,
                            value: setting.value
                        }))
                    });
                }
                const createdProviderKeys = new Map();
                for (const providerKey of imported.providerKeys) {
                    const createdKey = await tx.providerKey.create({
                        data: {
                            project_id: createdProject.id,
                            name: providerKey.name,
                            key: providerKey.key,
                            provider: providerKey.provider
                        }
                    });
                    createdProviderKeys.set(providerKey.name, createdKey.id);
                }
                if (imported.channels.length > 0) {
                    await tx.socialChannel.createMany({
                        data: imported.channels.map((channel) => ({
                            project_id: createdProject.id,
                            type: channel.type,
                            name: channel.name,
                            config: channel.config
                        }))
                    });
                }
                if (imported.presets.length > 0) {
                    await tx.promptPreset.createMany({
                        data: imported.presets.map((preset) => ({
                            project_id: createdProject.id,
                            name: preset.name,
                            role: preset.role,
                            prompt_text: preset.prompt_text
                        }))
                    });
                }
                if (imported.skillConnections.length > 0) {
                    await tx.projectSettings.create({
                        data: {
                            project_id: createdProject.id,
                            key: 'llm_skill_connections',
                            value: JSON.stringify(imported.skillConnections.map((connection) => ({
                                ...connection,
                                providerKeyId: connection.providerKeyName
                                    ? (createdProviderKeys.get(connection.providerKeyName) || null)
                                    : connection.providerKeyId
                            })))
                        }
                    });
                }
                return createdProject;
            });
            return {
                ...project,
                imported: {
                    settings: imported.settings.length,
                    providerKeys: imported.providerKeys.length,
                    channels: imported.channels.length,
                    presets: imported.presets.length,
                    skillConnections: imported.skillConnections.length
                }
            };
        }
        catch (error) {
            return reply.code(400).send({ error: error.message || 'Failed to import project configuration' });
        }
    });
    fastify.post('/api/projects/import-publication-plan', async (request, reply) => {
        const user = request.user;
        const { planJson, planPath, workspaceRoots, importMode } = request.body;
        if (!planJson && !planPath) {
            return reply.code(400).send({ error: 'planJson or planPath is required' });
        }
        try {
            const result = await publication_plan_service_1.default.importPlan({
                rawPlan: planJson,
                planPath,
                userId: user.id,
                workspaceRoots: Array.isArray(workspaceRoots) ? workspaceRoots : undefined,
                importMode: importMode || 'delta_safe'
            });
            (0, egress_diagnostics_1.logEgressDiagnostic)('projects.import_publication_plan', {
                userId: user.id,
                importMode: importMode || 'delta_safe',
                planJsonBytes: (0, egress_diagnostics_1.textBytes)(planJson),
                planPathBytes: (0, egress_diagnostics_1.textBytes)(planPath),
                workspaceRootCount: Array.isArray(workspaceRoots) ? workspaceRoots.length : 0,
                responseBytes: (0, egress_diagnostics_1.jsonBytes)(result),
                importedAccounts: result?.imported?.accounts,
                importedActions: result?.imported?.actions,
                processedActions: result?.imported?.processedActions,
                importedAssets: result?.imported?.assets,
                assetSnapshots: result?.imported?.assetSnapshots,
                contentFileSnapshots: result?.imported?.contentFileSnapshots
            });
            return result;
        }
        catch (error) {
            return reply.code(400).send({ error: error.message || 'Failed to import publication plan' });
        }
    });
    // Update project settings
    fastify.post('/api/projects/:id/settings', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { key, value } = request.body;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const setting = await planner_service_1.prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: key
                }
            },
            update: { value },
            create: {
                project_id: projectId,
                key,
                value
            }
        });
        if (key === 'default_channel_id') {
            const channelId = parseInt(value);
            if (!isNaN(channelId)) {
                await planner_service_1.prisma.post.updateMany({
                    where: {
                        project_id: projectId,
                        status: { notIn: ['published', 'publishing'] }
                    },
                    data: {
                        channel_id: channelId
                    }
                });
            }
        }
        return setting;
    });
    // Get project details
    fastify.get('/api/projects/:id', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId);
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const project = await planner_service_1.prisma.project.findUnique({
            where: { id: projectId },
            include: {
                channels: true,
                settings: true,
                _count: { select: { weeks: true } }, // Removed members count as we fetch list
                members: {
                    include: { user: { select: { id: true, name: true, email: true } } }
                }
            }
        });
        if (project && project.channels) {
            project.channels = project.channels.map(channel => ({
                ...channel,
                config: (0, channel_utils_1.sanitizeChannelConfig)(channel.type, channel.config)
            }));
        }
        return project;
    });
    fastify.get('/api/projects/:id/mcp/status', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const projectId = parseInt(id, 10);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            return reply.code(403).send({ error: 'Only owners can inspect MCP settings' });
        }
        const endpoint = (process.env.MCP_REMOTE_URL || 'http://127.0.0.1:8080/mcp').replace(/\/+$/, '');
        const healthUrl = endpoint.endsWith('/mcp') ? endpoint.slice(0, -4) + '/health' : `${endpoint}/health`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        try {
            const response = await fetch(healthUrl, { signal: controller.signal });
            const health = response.ok ? await response.json() : null;
            const capabilityEndpoints = health?.capability_endpoints || {};
            const capabilityStatus = (profile) => {
                const remote = capabilityEndpoints[profile];
                const configured = remote === true || remote?.configured === true;
                const boundProjectId = Number(remote?.project_id || 0) || null;
                return {
                    endpoint: `${endpoint}/${profile.replace('_', '-')}`,
                    configured: configured && (!boundProjectId || boundProjectId === projectId),
                    bound_project_id: boundProjectId
                };
            };
            return {
                status: response.ok && health?.status === 'ok' ? 'online' : 'degraded',
                endpoint,
                health_url: healthUrl,
                transport: health?.transport || null,
                bearer_required: Boolean(health?.auth?.bearer_required),
                uptime_s: health?.uptime_s || 0,
                active_sessions: health?.active_sessions || 0,
                capability_endpoints: {
                    planner: capabilityStatus('planner'),
                    writer: capabilityStatus('writer'),
                    art_director: capabilityStatus('art_director')
                },
                checked_at: new Date().toISOString()
            };
        }
        catch (error) {
            return {
                status: 'offline',
                endpoint,
                health_url: healthUrl,
                bearer_required: null,
                checked_at: new Date().toISOString(),
                message: error?.name === 'AbortError' ? 'MCP health check timed out' : 'MCP server is unreachable'
            };
        }
        finally {
            clearTimeout(timeout);
        }
    });
    fastify.get('/api/projects/:id/parser/health', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        try {
            const projectId = parseProjectId(id);
            const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId);
            if (!hasAccess) {
                return reply.code(403).send({ error: 'No access' });
            }
            return await parser_integration_service_1.default.getHealth();
        }
        catch (error) {
            return reply.code(400).send({ error: error.message || 'Failed to fetch parser health' });
        }
    });
    fastify.post('/api/projects/:id/parser/search', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        try {
            const projectId = parseProjectId(id);
            const result = await parser_integration_service_1.default.createSearchJob({
                projectId,
                ...request.body
            }, { userId: user.id, minRole: 'editor' });
            return reply.code(202).send(result);
        }
        catch (error) {
            const message = error.message || 'Failed to create parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.get('/api/projects/:id/parser/search/:jobId', async (request, reply) => {
        const user = request.user;
        const { id, jobId } = request.params;
        try {
            const projectId = parseProjectId(id);
            return await parser_integration_service_1.default.getSearchJob(projectId, jobId, { userId: user.id });
        }
        catch (error) {
            const message = error.message || 'Failed to fetch parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.post('/api/projects/:id/parser/search/:jobId/refresh', async (request, reply) => {
        const user = request.user;
        const { id, jobId } = request.params;
        try {
            const projectId = parseProjectId(id);
            const body = (request.body || {});
            const result = await parser_integration_service_1.default.refreshSearchJob({
                projectId,
                jobId,
                idempotencyKey: body.idempotencyKey
            }, { userId: user.id, minRole: 'editor' });
            return reply.code(202).send(result);
        }
        catch (error) {
            const message = error.message || 'Failed to refresh parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.get('/api/projects/:id/parser/posts', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { limit, offset } = request.query;
        try {
            const projectId = parseProjectId(id);
            return await parser_integration_service_1.default.listPosts(projectId, { userId: user.id }, {
                limit: limit !== undefined ? parseInt(limit, 10) : undefined,
                offset: offset !== undefined ? parseInt(offset, 10) : undefined
            });
        }
        catch (error) {
            const message = error.message || 'Failed to list parser posts';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.get('/api/projects/:id/parser/insights', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { limit, offset, jobId, type } = request.query;
        try {
            const projectId = parseProjectId(id);
            return await parser_integration_service_1.default.getInsights({
                projectId,
                limit: limit !== undefined ? parseInt(limit, 10) : undefined,
                offset: offset !== undefined ? parseInt(offset, 10) : undefined,
                jobId,
                type
            }, { userId: user.id });
        }
        catch (error) {
            const message = error.message || 'Failed to fetch parser insights';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.get('/api/projects/:id/parser/summaries/:jobId', async (request, reply) => {
        const user = request.user;
        const { id, jobId } = request.params;
        try {
            const projectId = parseProjectId(id);
            return await parser_integration_service_1.default.getSummary({
                projectId,
                jobId
            }, { userId: user.id });
        }
        catch (error) {
            const message = error.message || 'Failed to fetch parser summary';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.get('/api/projects/:id/parser/templates', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        try {
            const projectId = parseProjectId(id);
            return await parser_integration_service_1.default.listTemplates(projectId, { userId: user.id });
        }
        catch (error) {
            const message = error.message || 'Failed to list parser templates';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.post('/api/projects/:id/parser/templates/import', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        try {
            const projectId = parseProjectId(id);
            const result = await parser_integration_service_1.default.importTemplates({
                projectId,
                ...request.body
            }, { userId: user.id, minRole: 'editor' });
            return reply.code(202).send(result);
        }
        catch (error) {
            const message = error.message || 'Failed to import parser templates';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    fastify.post('/api/projects/:id/parser/templates/:templateId/run', async (request, reply) => {
        const user = request.user;
        const { id, templateId } = request.params;
        try {
            const projectId = parseProjectId(id);
            const body = (request.body || {});
            const result = await parser_integration_service_1.default.runTemplate({
                projectId,
                templateId,
                idempotencyKey: body.idempotencyKey
            }, { userId: user.id, minRole: 'editor' });
            return reply.code(202).send(result);
        }
        catch (error) {
            const message = error.message || 'Failed to run parser template';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
    // Channels management
    fastify.post('/api/projects/:id/channels', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { type, name, config } = request.body;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        let storedConfig;
        try {
            storedConfig = (0, channel_utils_1.prepareChannelConfigForStorage)(type, config);
        }
        catch (error) {
            return reply.code(400).send({ error: error.message });
        }
        const channel = await planner_service_1.prisma.socialChannel.create({
            data: {
                project_id: projectId,
                type,
                name,
                config: storedConfig
            }
        });
        return {
            ...channel,
            config: (0, channel_utils_1.sanitizeChannelConfig)(channel.type, channel.config)
        };
    });
    // Edit channel
    fastify.put('/api/projects/:id/channels/:channelId', async (request, reply) => {
        const user = request.user;
        const { id, channelId } = request.params;
        const { name, config } = request.body;
        const projectId = parseInt(id);
        const parsedChannelId = parseInt(channelId);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const existingChannel = await planner_service_1.prisma.socialChannel.findUnique({
            where: { id: parsedChannelId, project_id: projectId }
        });
        if (!existingChannel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }
        let mergedConfig;
        try {
            mergedConfig = (0, channel_utils_1.prepareChannelConfigForStorage)(existingChannel.type, (0, channel_utils_1.mergeChannelConfig)(config, existingChannel.config || {}));
        }
        catch (error) {
            return reply.code(400).send({ error: error.message });
        }
        const channel = await planner_service_1.prisma.socialChannel.update({
            where: { id: parsedChannelId, project_id: projectId },
            data: {
                name,
                config: mergedConfig
            }
        });
        return {
            ...channel,
            config: (0, channel_utils_1.sanitizeChannelConfig)(channel.type, channel.config)
        };
    });
    fastify.post('/api/projects/:id/channels/:channelId/test-connection', async (request, reply) => {
        const user = request.user;
        const { id, channelId } = request.params;
        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess)
            return reply.code(403).send({ error: 'No access' });
        const channel = await planner_service_1.prisma.socialChannel.findFirst({
            where: { id: parsedChannelId, project_id: projectId }
        });
        if (!channel)
            return reply.code(404).send({ error: 'Channel not found' });
        if (!['zen', 'zen_article', 'dzen'].includes(channel.type)) {
            return reply.code(400).send({ error: 'Connection test is not supported for this channel type' });
        }
        try {
            const storedConfig = channel.config?.raw_account || channel.config;
            const result = await dzen_service_1.default.testConnection((0, channel_utils_1.resolveChannelConfigSecrets)(channel.type, storedConfig));
            return { success: true, result };
        }
        catch (error) {
            return reply.code(400).send({
                error: error.message || 'Dzen connection test failed',
                code: 'DZEN_CONNECTION_TEST_FAILED'
            });
        }
    });
    // Delete channel
    fastify.delete('/api/projects/:id/channels/:channelId', async (request, reply) => {
        const user = request.user;
        const { id, channelId } = request.params;
        const projectId = parseInt(id);
        const parsedChannelId = parseInt(channelId);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const defaultChannelSetting = await planner_service_1.prisma.projectSettings.findFirst({
            where: { project_id: projectId, key: 'default_channel_id', value: String(parsedChannelId) }
        });
        if (defaultChannelSetting) {
            await planner_service_1.prisma.projectSettings.delete({
                where: { id: defaultChannelSetting.id }
            });
        }
        await planner_service_1.prisma.socialChannel.delete({
            where: { id: parsedChannelId, project_id: projectId }
        });
        return { success: true };
    });
    fastify.post('/api/projects/:id/channels/:channelId/manual-content', async (request, reply) => {
        const user = request.user;
        const { id, channelId } = request.params;
        const { fileName, fileType, content, note, publishedLink, publishNow, outcome } = request.body;
        const projectId = parseInt(id);
        const parsedChannelId = parseInt(channelId);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        if (!content?.trim()) {
            return reply.code(400).send({ error: 'content is required' });
        }
        const channel = await planner_service_1.prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });
        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }
        const safeFileName = (fileName || 'manual-content').trim();
        const title = safeFileName.replace(/\.(md|markdown|html|htm)$/i, '').replace(/[-_]+/g, ' ').trim() || safeFileName;
        const normalizedPublishedLink = publishedLink?.trim() || null;
        const publicationOutcome = outcome || 'published';
        const shouldMarkPublished = publishNow === true && Boolean(normalizedPublishedLink);
        const item = await planner_service_1.prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: channel.id,
                type: inferManualContentType(channel.type, fileType || null),
                layer: channel.type,
                title,
                brief: note?.trim() || `Manual ${fileType || 'text'} upload for ${channel.name}`,
                draft_text: content,
                status: shouldMarkPublished ? 'published' : 'drafted',
                assets: {
                    source: 'manual_upload',
                    manual_upload: {
                        file_name: safeFileName,
                        file_type: fileType || 'unknown',
                        note: note || null,
                        published_link: normalizedPublishedLink
                    }
                },
                quality_report: {
                    execution_mode: 'manual',
                    content_origin: 'manual_upload',
                    manual_publication_note: note || null,
                    publication_outcome: shouldMarkPublished ? publicationOutcome : null,
                    handoff_bundle: {
                        mode: 'manual',
                        account: {
                            ref: channel.name,
                            details: channel.config || null
                        },
                        task: {
                            id: `manual-${Date.now()}`,
                            display_name: title,
                            channel: channel.type,
                            action_type: 'manual_upload'
                        },
                        publication: {
                            body: content,
                            html_bundle: fileType === 'html' ? [{ file_name: safeFileName }] : [],
                            link_url: normalizedPublishedLink,
                            visuals: []
                        },
                        resource_files: [
                            {
                                role: 'manual_upload',
                                purpose: 'User-provided channel content',
                                file_name: safeFileName,
                                relative_path: null,
                                full_path: null,
                                section_marker: null,
                                exists: true,
                                url: null,
                                content
                            }
                        ],
                        manual_checklist: ['Review the uploaded content and continue the channel workflow.'],
                        verification: [],
                        post_actions: [],
                        dependencies: []
                    }
                },
                metrics: {
                    content_origin: 'manual_upload',
                    channel_ref: channel.name,
                    uploaded_at: new Date().toISOString(),
                    publication_outcome: shouldMarkPublished ? publicationOutcome : null,
                    manual_confirmation_at: shouldMarkPublished ? new Date().toISOString() : null
                },
                published_link: normalizedPublishedLink
            },
            include: {
                channel: true
            }
        });
        return item;
    });
    fastify.post('/api/projects/:id/channels/:channelId/manual-content-upload', async (request, reply) => {
        const user = request.user;
        const { id, channelId } = request.params;
        const data = await request.file();
        const projectId = parseInt(id);
        const parsedChannelId = parseInt(channelId);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        if (!data) {
            return reply.code(400).send({ error: 'No file uploaded' });
        }
        const channel = await planner_service_1.prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });
        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }
        const note = readMultipartField(data.fields?.note).trim();
        const publishedLink = readMultipartField(data.fields?.publishedLink).trim() || null;
        const publishNow = readMultipartField(data.fields?.publishNow) === 'true';
        const outcome = (readMultipartField(data.fields?.outcome) || 'published');
        const buffer = await data.toBuffer();
        const safeFileName = (data.filename || 'manual-upload').trim();
        const resourceKind = inferManualResourceKind(safeFileName, data.mimetype);
        const normalizedPublishedLink = publishedLink;
        const shouldMarkPublished = publishNow === true && Boolean(normalizedPublishedLink);
        const title = safeFileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || safeFileName;
        let content = null;
        let fileUrl = null;
        let previewUrl = null;
        if (resourceKind === 'markdown' || resourceKind === 'html' || resourceKind === 'text') {
            content = buffer.toString('utf8');
        }
        else {
            const ext = safeFileName.split('.').pop() || 'png';
            const filename = `manual-${projectId}-${parsedChannelId}-${Date.now()}.${ext}`;
            fileUrl = await storage_service_1.default.uploadFileFromBuffer(buffer, data.mimetype || 'application/octet-stream', `uploads/${filename}`);
            previewUrl = resourceKind === 'image' ? fileUrl : null;
        }
        const item = await planner_service_1.prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: channel.id,
                type: inferManualContentType(channel.type, resourceKind === 'html' ? 'html' : resourceKind === 'markdown' ? 'markdown' : null),
                layer: channel.type,
                title,
                brief: note || `Manual ${resourceKind} upload for ${channel.name}`,
                draft_text: content,
                status: shouldMarkPublished ? 'published' : 'drafted',
                assets: {
                    source: 'manual_upload',
                    manual_upload: {
                        file_name: safeFileName,
                        file_type: resourceKind,
                        mime_type: data.mimetype || null,
                        note: note || null,
                        published_link: normalizedPublishedLink,
                        file_url: fileUrl,
                        preview_url: previewUrl
                    }
                },
                quality_report: {
                    execution_mode: 'manual',
                    content_origin: 'manual_upload',
                    manual_publication_note: note || null,
                    publication_outcome: shouldMarkPublished ? outcome : null,
                    handoff_bundle: {
                        mode: 'manual',
                        account: {
                            ref: channel.name,
                            details: channel.config || null
                        },
                        task: {
                            id: `manual-${Date.now()}`,
                            display_name: title,
                            channel: channel.type,
                            action_type: 'manual_upload'
                        },
                        publication: {
                            body: content || '',
                            html_bundle: resourceKind === 'html' ? [{ file_name: safeFileName }] : [],
                            link_url: normalizedPublishedLink,
                            visuals: previewUrl ? [{ url: previewUrl, provider: 'manual_upload' }] : []
                        },
                        resource_files: [
                            {
                                role: 'manual_upload',
                                purpose: 'User-provided channel content',
                                file_name: safeFileName,
                                relative_path: null,
                                full_path: null,
                                section_marker: null,
                                exists: true,
                                url: fileUrl,
                                preview_url: previewUrl,
                                content,
                                content_type: data.mimetype || null,
                                mime_type: data.mimetype || null
                            }
                        ],
                        manual_checklist: ['Review the uploaded content and continue the channel workflow.'],
                        verification: [],
                        post_actions: [],
                        dependencies: []
                    }
                },
                metrics: {
                    content_origin: 'manual_upload',
                    channel_ref: channel.name,
                    uploaded_at: new Date().toISOString(),
                    resource_kind: resourceKind,
                    publication_outcome: shouldMarkPublished ? outcome : null,
                    manual_confirmation_at: shouldMarkPublished ? new Date().toISOString() : null
                },
                published_link: normalizedPublishedLink
            },
            include: {
                channel: true
            }
        });
        return item;
    });
    fastify.get('/api/projects/:id/channels/:channelId/auto-canvas-status', async (request, reply) => {
        const user = request.user;
        const { id, channelId } = request.params;
        const projectId = parseInt(id);
        const parsedChannelId = parseInt(channelId);
        const requestedWeekPackageId = Number(request.query.weekPackageId || 0);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const channel = await planner_service_1.prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });
        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }
        const channelItems = await planner_service_1.prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                channel_id: parsedChannelId,
                ...(requestedWeekPackageId > 0 ? { week_package_id: requestedWeekPackageId } : {})
            },
            include: {
                week_package: true
            },
            orderBy: [
                { schedule_at: 'asc' },
                { id: 'asc' }
            ]
        });
        const latestWeekPackage = channelItems
            .map((item) => item.week_package)
            .filter(Boolean)
            .sort((left, right) => {
            const leftTime = new Date(left.week_start).getTime();
            const rightTime = new Date(right.week_start).getTime();
            return rightTime - leftTime;
        })[0] || null;
        const packageItems = latestWeekPackage
            ? await planner_service_1.prisma.contentItem.findMany({
                where: {
                    project_id: projectId,
                    week_package_id: latestWeekPackage.id,
                    type: { not: 'week_theme' }
                },
                include: { channel: true },
                orderBy: [{ publish_at: 'asc' }, { id: 'asc' }]
            })
            : [];
        const visibleItems = packageItems.filter((item) => item.channel_id === parsedChannelId
            && item.item_key?.startsWith(`week-topic:${latestWeekPackage?.id}:`));
        return {
            channel: {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                workflow_mode: channel.config?.workflow_mode || channel.config?.raw_account?.planner_generation_mode || null,
                auto_canvas_enabled: isAutoCanvasChannel(channel)
            },
            week_package: latestWeekPackage ? {
                id: latestWeekPackage.id,
                week_theme: latestWeekPackage.week_theme,
                core_thesis: latestWeekPackage.core_thesis,
                approval_status: latestWeekPackage.approval_status,
                plan_version: latestWeekPackage.plan_version,
                week_start: latestWeekPackage.week_start,
                week_end: latestWeekPackage.week_end
            } : null,
            stats: {
                total: visibleItems.length,
                planned: visibleItems.filter((item) => item.status === 'planned').length,
                drafted: visibleItems.filter((item) => item.status === 'drafted').length,
                published: visibleItems.filter((item) => item.status === 'published').length,
                failed: visibleItems.filter((item) => item.status === 'failed').length
            },
            items: visibleItems.map((item) => ({
                id: item.id,
                title: item.title,
                brief: item.brief,
                key_points: item.key_points,
                status: item.status,
                schedule_at: item.schedule_at,
                draft_text: item.draft_text,
                published_link: item.published_link
            })),
            plan_items: packageItems.map((item) => ({
                id: item.id,
                title: item.title,
                type: item.type,
                status: item.status,
                schedule_at: item.schedule_at,
                publish_at: item.publish_at,
                published_link: item.published_link,
                channel: item.channel ? {
                    id: item.channel.id,
                    name: item.channel.name,
                    type: item.channel.type
                } : null,
                is_week_topic: item.channel_id === parsedChannelId
                    && item.item_key?.startsWith(`week-topic:${latestWeekPackage?.id}:`)
            }))
        };
    });
    fastify.post('/api/projects/:id/channels/:channelId/week-plans/:weekPackageId/decision', async (request, reply) => {
        const user = request.user;
        const { id, channelId, weekPackageId } = request.params;
        const { decision, comment } = request.body;
        const projectId = Number(id);
        const parsedChannelId = Number(channelId);
        const parsedWeekPackageId = Number(weekPackageId);
        if (![projectId, parsedChannelId, parsedWeekPackageId].every(Number.isInteger) || !['approved', 'rejected'].includes(String(decision))) {
            return reply.code(400).send({ error: 'Invalid week-plan decision request' });
        }
        if (!await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner')) {
            return reply.code(403).send({ error: 'Only the project owner can approve the weekly plan' });
        }
        const weekPackage = await planner_service_1.prisma.weekPackage.findFirst({
            where: {
                id: parsedWeekPackageId,
                project_id: projectId,
                content_items: { some: { channel_id: parsedChannelId, type: { not: 'week_theme' } } }
            }
        });
        if (!weekPackage)
            return reply.code(404).send({ error: 'Weekly plan not found for this channel' });
        if (!weekPackage.plan_version)
            return reply.code(409).send({ error: 'Weekly plan has no current version to approve' });
        return work_queue_service_1.default.decideWeekPlan({
            projectId,
            actorId: `user:${user.id}`,
            weekPackageId: parsedWeekPackageId,
            planVersion: weekPackage.plan_version,
            decision: decision,
            comment: comment?.trim() || undefined,
            idempotencyKey: `ui-week-plan:${parsedWeekPackageId}:${weekPackage.plan_version}:${decision}`
        });
    });
    fastify.post('/api/projects/:id/channels/:channelId/auto-canvas-generate', async (request, reply) => {
        const user = request.user;
        const { id, channelId } = request.params;
        const { limit } = request.body;
        const projectId = parseInt(id);
        const parsedChannelId = parseInt(channelId);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const channel = await planner_service_1.prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });
        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }
        if (!isAutoCanvasChannel(channel)) {
            return reply.code(400).send({ error: 'This channel is not configured for automatic canvas generation.' });
        }
        const itemsToProcess = await planner_service_1.prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                channel_id: parsedChannelId,
                status: { in: ['planned', 'failed'] },
                week_package: { approval_status: 'approved' }
            },
            orderBy: [
                { schedule_at: 'asc' },
                { id: 'asc' }
            ],
            take: Math.max(1, Math.min(limit || 10, 50))
        });
        const results = [];
        for (const item of itemsToProcess) {
            try {
                await generator_service_1.default.generateContentItemText(item.id);
                results.push({ id: item.id, status: 'drafted' });
            }
            catch (error) {
                await planner_service_1.prisma.contentItem.update({
                    where: { id: item.id },
                    data: { status: 'failed' }
                });
                results.push({ id: item.id, status: 'failed', error: error?.message || 'Generation failed' });
            }
        }
        return {
            channel_id: parsedChannelId,
            processed: results.length,
            results
        };
    });
    fastify.put('/api/projects/:id', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { name, slug, description, kind } = request.body;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can edit project details' });
            return;
        }
        const existing = await planner_service_1.prisma.project.findUnique({
            where: { id: projectId }
        });
        if (!existing) {
            reply.code(404).send({ error: 'Project not found' });
            return;
        }
        const finalSlug = typeof slug === 'string' && slug.trim()
            ? await makeUniqueProjectSlug(slug, existing.name, existing.id)
            : undefined;
        const project = await planner_service_1.prisma.project.update({
            where: { id: projectId },
            data: {
                ...(typeof name === 'string' ? { name } : {}),
                ...(typeof description === 'string' || description === null ? { description } : {}),
                ...(finalSlug ? { slug: finalSlug } : {}),
                ...(typeof kind === 'string' ? { kind: (0, project_utils_1.normalizeProjectKind)(kind) } : {})
            }
        });
        return project;
    });
    fastify.post('/api/projects/:id/archive', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { archived } = request.body;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can archive project details' });
            return;
        }
        const nextArchived = archived !== false;
        const project = await planner_service_1.prisma.project.update({
            where: { id: projectId },
            data: {
                is_archived: nextArchived,
                archived_at: nextArchived ? new Date() : null
            }
        });
        return project;
    });
    // Members management
    fastify.post('/api/projects/:id/members', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { email, role } = request.body; // role: editor, viewer
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can add members' });
            return;
        }
        // Find user by email
        const targetUser = await planner_service_1.prisma.user.findUnique({ where: { email } });
        // If user not found, create invitation
        if (!targetUser) {
            // Check existing invitation
            const existingInvite = await planner_service_1.prisma.projectInvitation.findFirst({
                where: { project_id: projectId, email }
            });
            if (existingInvite) {
                // Return existing token
                return {
                    status: 'invited',
                    message: 'Invitation already exists',
                    invite_link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${existingInvite.token}`
                };
            }
            // Create new invitation
            const token = require('crypto').randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry
            const invitation = await planner_service_1.prisma.projectInvitation.create({
                data: {
                    project_id: projectId,
                    email,
                    role: role || 'viewer',
                    token,
                    expires_at: expiresAt,
                    created_by: user.id
                }
            });
            return {
                status: 'invited',
                message: 'Invitation created',
                invite_link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${token}`
            };
        }
        // Check if already member
        const existing = await planner_service_1.prisma.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: targetUser.id } }
        });
        if (existing) {
            return reply.code(400).send({ error: 'User already in project' });
        }
        const member = await planner_service_1.prisma.projectMember.create({
            data: {
                project_id: projectId,
                user_id: targetUser.id,
                role: role || 'viewer'
            },
            include: { user: { select: { id: true, name: true, email: true } } }
        });
        return member;
    });
    // --- Invitation Routes ---
    // Get invitation details
    fastify.get('/api/invitations/:token', async (request, reply) => {
        const { token } = request.params;
        const invitation = await planner_service_1.prisma.projectInvitation.findUnique({
            where: { token },
            include: {
                project: { select: { name: true, description: true } },
                creator: { select: { name: true, email: true } }
            }
        });
        if (!invitation) {
            return reply.code(404).send({ error: 'Invitation not found' });
        }
        if (new Date() > invitation.expires_at) {
            return reply.code(410).send({ error: 'Invitation expired' });
        }
        return {
            email: invitation.email,
            role: invitation.role,
            project_name: invitation.project.name,
            inviter_name: invitation.creator?.name || 'Unknown'
        };
    });
    // Accept invitation
    fastify.post('/api/invitations/:token/accept', async (request, reply) => {
        const tokenHeader = request.headers.authorization?.split(' ')[1];
        if (!tokenHeader) {
            return reply.code(401).send({ error: 'Auth required' });
        }
        let user;
        try {
            user = auth_service_1.default.verifyToken(tokenHeader);
        }
        catch (e) {
            return reply.code(401).send({ error: 'Invalid token' });
        }
        const { token } = request.params;
        const invitation = await planner_service_1.prisma.projectInvitation.findUnique({
            where: { token }
        });
        if (!invitation) {
            return reply.code(404).send({ error: 'Invitation not found' });
        }
        if (new Date() > invitation.expires_at) {
            return reply.code(410).send({ error: 'Invitation expired' });
        }
        // Optional: strict email check
        // if (invitation.email !== user.email) { ... }
        // For now, allow accepting with any email as long as they have the link (flexible)
        // Add to project
        try {
            await planner_service_1.prisma.projectMember.create({
                data: {
                    project_id: invitation.project_id,
                    user_id: user.id,
                    role: invitation.role
                }
            });
        }
        catch (e) {
            // Ignore if already member
        }
        // Delete invitation
        await planner_service_1.prisma.projectInvitation.delete({ where: { token } });
        return { success: true, projectId: invitation.project_id };
    });
    // DELETE member
    fastify.delete('/api/projects/:id/members/:userId', async (request, reply) => {
        const user = request.user;
        const { id, userId } = request.params;
        const projectId = parseInt(id);
        const targetUserId = parseInt(userId);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can remove members' });
            return;
        }
        if (user.id === targetUserId) {
            return reply.code(400).send({ error: 'Cannot remove yourself' });
        }
        await planner_service_1.prisma.projectMember.delete({
            where: { project_id_user_id: { project_id: projectId, user_id: targetUserId } }
        });
        return { success: true };
    });
}
