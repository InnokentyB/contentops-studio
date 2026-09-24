import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import multiAgentService from '../../services/multi_agent.service';
import generatorService from '../../services/generator.service';
import commentService from '../../services/comment.service';
import contentDictionaryService from '../../services/content_dictionary.service';
import contentPolicyMatrixService from '../../services/content_policy_matrix.service';
import modelService from '../../services/model.service';
import { safeEncryptProviderKey, safeDecryptProviderKey } from '../../utils/channel_secrets';
import { maskApiKey, safeJsonParse, formatJson } from './helpers';
import { CreateCommentSchema } from '../../schemas/routes.schema';

interface RoleParams {
    role: string;
}

interface AgentConfigBody {
    prompt: string;
    apiKey: string;
    model: string;
}

interface SkillConnectionInput {
    id?: string;
    name?: string;
    provider?: string;
    model?: string;
    providerKeyId?: number | null;
    endpointType?: string;
    skillMode?: string;
    enabledSkills?: string[];
    systemPrompt?: string;
    notes?: string;
    enabled?: boolean;
    supportsSkills?: boolean;
}

export default async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/api/settings/agents', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const projectId = (request as unknown as { projectId?: number }).projectId;
            if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

            const roles = ['post_creator', 'post_critic', 'post_fixer', 'topic_creator', 'topic_critic', 'topic_fixer', 'visual_architect', 'structural_critic', 'precision_fixer', 'image_critic'] as const;
            const agents = [];

            for (const role of roles) {
                try {
                    const config = await multiAgentService.getAgentConfig(projectId, role as any);

                    let provider = 'Not Configured';
                    if (config.apiKey) {
                        if (config.apiKey.startsWith('sk-ant')) provider = 'Anthropic';
                        else if (config.apiKey.startsWith('AIza')) provider = 'Gemini';
                        else if (config.apiKey.startsWith('sk-')) provider = 'OpenAI';
                        else provider = 'Unknown';
                    }

                    agents.push({
                        role,
                        prompt: config.prompt,
                        apiKey: maskApiKey(config.apiKey),
                        model: config.model,
                        provider
                    });
                } catch (e) {
                    console.error(`Failed to fetch config for role ${role}`, e);
                    agents.push({
                        role,
                        prompt: '',
                        apiKey: '',
                        model: '',
                        provider: 'Error'
                    });
                }
            }

            try {
                const dallePrompt = await generatorService.getImagePromptTemplate(projectId, 'gpt-image');
                agents.push({
                    role: 'gpt_image_gen',
                    prompt: dallePrompt,
                    apiKey: '',
                    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
                    provider: 'OpenAI (Env)'
                });
            } catch (e) {
                console.error('Failed to fetch DALL-E config', e);
            }

            try {
                const nanoPrompt = await generatorService.getImagePromptTemplate(projectId, 'nano');
                agents.push({
                    role: 'nano_image_gen',
                    prompt: nanoPrompt,
                    apiKey: '',
                    model: 'gemini-3.1-flash-image',
                    provider: 'Google (Env)'
                });
            } catch (e) {
                console.error('Failed to fetch Nano config', e);
            }

            return agents;
        } catch (e: unknown) {
            console.error('Error in GET /api/settings/agents:', e);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.get('/api/settings/model-usage', async (request: FastifyRequest<{ Querystring: { days?: string } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const daysRaw = Number(request.query?.days || 30);
        const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 30;

        const rows = await prisma.$queryRaw<Array<{
            provider: string | null;
            model: string | null;
            calls: number;
            failed_calls: number;
            input_tokens: number;
            output_tokens: number;
            estimated_cost_usd: string | null;
            avg_latency_ms: number | null;
        }>>(Prisma.sql`
            SELECT provider,
                   model,
                   COUNT(*)::int AS calls,
                   COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_calls,
                   COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                   COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                   SUM(estimated_cost_usd)::text AS estimated_cost_usd,
                   AVG(latency_ms)::int AS avg_latency_ms
              FROM planner.agent_runs
             WHERE project_id = ${projectId}
               AND type = 'model_invocation'
               AND created_at >= NOW() - (${days} * INTERVAL '1 day')
             GROUP BY provider, model
             ORDER BY SUM(estimated_cost_usd) DESC NULLS LAST, COUNT(*) DESC
        `);

        return {
            period_days: days,
            exact_cost_coverage: rows.filter((row) => row.estimated_cost_usd !== null).reduce((sum, row) => sum + row.calls, 0),
            total_calls: rows.reduce((sum, row) => sum + row.calls, 0),
            total_estimated_cost_usd: Number(rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0).toFixed(6)),
            by_model: rows.map((row) => ({
                ...row,
                estimated_cost_usd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd)
            }))
        };
    });

    fastify.put('/api/settings/agents/:role', async (request: FastifyRequest<{ Params: RoleParams; Body: AgentConfigBody }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { role } = request.params;
        const { prompt, apiKey, model } = request.body;

        if (role === 'gpt_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'gpt-image');
            return { success: true };
        }
        if (role === 'nano_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'nano');
            return { success: true };
        }

        const roleMap: Record<string, { prompt: string; key: string; model: string }> = {
            'post_creator': {
                prompt: multiAgentService.KEY_POST_CREATOR_PROMPT,
                key: multiAgentService.KEY_POST_CREATOR_KEY,
                model: multiAgentService.KEY_POST_CREATOR_MODEL
            },
            'post_critic': {
                prompt: multiAgentService.KEY_POST_CRITIC_PROMPT,
                key: multiAgentService.KEY_POST_CRITIC_KEY,
                model: multiAgentService.KEY_POST_CRITIC_MODEL
            },
            'post_fixer': {
                prompt: multiAgentService.KEY_POST_FIXER_PROMPT,
                key: multiAgentService.KEY_POST_FIXER_KEY,
                model: multiAgentService.KEY_POST_FIXER_MODEL
            },
            'topic_creator': {
                prompt: multiAgentService.KEY_TOPIC_CREATOR_PROMPT,
                key: multiAgentService.KEY_TOPIC_CREATOR_KEY,
                model: multiAgentService.KEY_TOPIC_CREATOR_MODEL
            },
            'topic_critic': {
                prompt: multiAgentService.KEY_TOPIC_CRITIC_PROMPT,
                key: multiAgentService.KEY_TOPIC_CRITIC_KEY,
                model: multiAgentService.KEY_TOPIC_CRITIC_MODEL
            },
            'topic_fixer': {
                prompt: multiAgentService.KEY_TOPIC_FIXER_PROMPT,
                key: multiAgentService.KEY_TOPIC_FIXER_KEY,
                model: multiAgentService.KEY_TOPIC_FIXER_MODEL
            },
            'visual_architect': {
                prompt: multiAgentService.KEY_VISUAL_ARCHITECT_PROMPT,
                key: multiAgentService.KEY_VISUAL_ARCHITECT_KEY,
                model: multiAgentService.KEY_VISUAL_ARCHITECT_MODEL
            },
            'structural_critic': {
                prompt: multiAgentService.KEY_STRUCTURAL_CRITIC_PROMPT,
                key: multiAgentService.KEY_STRUCTURAL_CRITIC_KEY,
                model: multiAgentService.KEY_STRUCTURAL_CRITIC_MODEL
            },
            'precision_fixer': {
                prompt: multiAgentService.KEY_PRECISION_FIXER_PROMPT,
                key: multiAgentService.KEY_PRECISION_FIXER_KEY,
                model: multiAgentService.KEY_PRECISION_FIXER_MODEL
            },
            'image_critic': {
                prompt: multiAgentService.KEY_IMAGE_CRITIC_PROMPT,
                key: multiAgentService.KEY_IMAGE_CRITIC_KEY,
                model: multiAgentService.KEY_IMAGE_CRITIC_MODEL
            }
        };

        const keys = roleMap[role];
        if (!keys) {
            return reply.code(400).send({ error: 'Invalid role' });
        }

        try {
            const saveSetting = async (key: string, value: string) => {
                const existing = await prisma.projectSettings.findUnique({
                    where: { project_id_key: { project_id: projectId, key } }
                });
                if (existing) {
                    await prisma.projectSettings.update({
                        where: { id: existing.id },
                        data: { value }
                    });
                } else {
                    await prisma.projectSettings.create({
                        data: { project_id: projectId, key, value }
                    });
                }
            };

            await saveSetting(keys.prompt, prompt);
            if (apiKey !== undefined) {
                if (apiKey === '') {
                    await saveSetting(keys.key, '');
                } else if (!apiKey.includes('••••')) {
                    await saveSetting(keys.key, safeEncryptProviderKey(apiKey));
                }
            }
            await saveSetting(keys.model, model);

            return { success: true };
        } catch (e: unknown) {
            const err = e as Error;
            console.error(`Failed to save settings for ${role}`, err);
            return reply.code(500).send({ error: 'Failed to save settings', details: err.message });
        }
    });

    fastify.get('/api/settings/runs', async () => {
        const runs = await prisma.agentRun.findMany({
            orderBy: { created_at: 'desc' },
            take: 50
        });
        return runs;
    });

    fastify.get('/api/comments', async (request: FastifyRequest<{ Querystring: { entityType?: string; entityId?: string } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { entityType, entityId } = request.query;
        if (!entityType || !entityId) return reply.code(400).send({ error: 'Missing params' });

        return await commentService.getComments(projectId, entityType, parseInt(entityId, 10));
    });

    fastify.post('/api/comments', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const parseResult = CreateCommentSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.code(400).send({ error: parseResult.error.message });
        }
        const { entityType, entityId, text } = parseResult.data;

        return await commentService.createComment(projectId, entityType, entityId, text, 'user');
    });

    fastify.get('/api/settings/content-dictionary', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });

        const yamlValue = setting?.value || contentDictionaryService.getDefaultYaml();
        const parsed = contentDictionaryService.parseYaml(yamlValue);

        return {
            yaml: yamlValue,
            parsed,
            updated_at: setting?.updated_at || null
        };
    });

    fastify.put('/api/settings/content-dictionary', async (request: FastifyRequest<{ Body: { yaml?: string } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { yaml: yamlText } = request.body || {};
        if (typeof yamlText !== 'string' || !yamlText.trim()) {
            return reply.code(400).send({ error: 'yaml is required' });
        }

        try {
            const normalizedYaml = contentDictionaryService.normalizeToYaml(yamlText);
            const parsed = contentDictionaryService.parseYaml(normalizedYaml);

            const saved = await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } },
                update: { value: normalizedYaml },
                create: {
                    project_id: projectId,
                    key: 'content_dictionary_yaml',
                    value: normalizedYaml
                }
            });

            return {
                yaml: saved.value,
                parsed,
                updated_at: saved.updated_at
            };
        } catch (error: unknown) {
            const err = error as Error;
            return reply.code(400).send({ error: err.message || 'Invalid dictionary YAML' });
        }
    });

    fastify.get('/api/settings/content-policy-matrix', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_policy_matrix_yaml' } }
        });

        const yamlValue = setting?.value || contentPolicyMatrixService.getDefaultYaml();
        const parsed = contentPolicyMatrixService.parseYaml(yamlValue);

        return {
            yaml: yamlValue,
            parsed,
            updated_at: setting?.updated_at || null
        };
    });

    fastify.put('/api/settings/content-policy-matrix', async (request: FastifyRequest<{ Body: { yaml?: string } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { yaml: yamlText } = request.body || {};
        if (typeof yamlText !== 'string' || !yamlText.trim()) {
            return reply.code(400).send({ error: 'yaml is required' });
        }

        try {
            const normalizedYaml = contentPolicyMatrixService.normalizeToYaml(yamlText);
            const parsed = contentPolicyMatrixService.parseYaml(normalizedYaml);

            const saved = await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'content_policy_matrix_yaml' } },
                update: { value: normalizedYaml },
                create: {
                    project_id: projectId,
                    key: 'content_policy_matrix_yaml',
                    value: normalizedYaml
                }
            });

            return {
                yaml: saved.value,
                parsed,
                updated_at: saved.updated_at
            };
        } catch (error: unknown) {
            const err = error as Error;
            return reply.code(400).send({ error: err.message || 'Invalid content policy matrix YAML' });
        }
    });

    fastify.get('/api/settings/atoma-context', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const settings = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['atoma_files_description', 'atoma_files_payload'] }
            }
        });

        const descriptionSetting = settings.find((setting) => setting.key === 'atoma_files_description') || null;
        const payloadSetting = settings.find((setting) => setting.key === 'atoma_files_payload') || null;
        const parsedPayload = safeJsonParse(payloadSetting?.value || null);
        const updatedAt = [descriptionSetting?.updated_at, payloadSetting?.updated_at]
            .filter(Boolean)
            .sort((a, b) => new Date(b as Date).getTime() - new Date(a as Date).getTime())[0] || null;

        return {
            description: descriptionSetting?.value || '',
            payload: parsedPayload,
            payload_text: payloadSetting?.value
                ? (parsedPayload !== null ? formatJson(parsedPayload) : payloadSetting.value)
                : '',
            updated_at: updatedAt
        };
    });

    fastify.put('/api/settings/atoma-context', async (request: FastifyRequest<{ Body: { description?: string; payloadText?: string } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { description, payloadText } = request.body || {};
        if (typeof description !== 'string' || typeof payloadText !== 'string') {
            return reply.code(400).send({ error: 'description and payloadText are required' });
        }

        const normalizedDescription = description.trim();
        const normalizedPayloadText = payloadText.trim();

        let normalizedPayloadValue = '';
        let parsedPayload: unknown = null;

        if (normalizedPayloadText) {
            try {
                parsedPayload = JSON.parse(normalizedPayloadText);
                normalizedPayloadValue = formatJson(parsedPayload);
            } catch (error: unknown) {
                const err = error as Error;
                return reply.code(400).send({ error: err.message || 'Invalid ATOMA payload JSON' });
            }
        }

        await prisma.$transaction(async (tx) => {
            if (normalizedDescription) {
                await tx.projectSettings.upsert({
                    where: { project_id_key: { project_id: projectId, key: 'atoma_files_description' } },
                    update: { value: normalizedDescription },
                    create: {
                        project_id: projectId,
                        key: 'atoma_files_description',
                        value: normalizedDescription
                    }
                });
            } else {
                await tx.projectSettings.deleteMany({
                    where: { project_id: projectId, key: 'atoma_files_description' }
                });
            }

            if (normalizedPayloadValue) {
                await tx.projectSettings.upsert({
                    where: { project_id_key: { project_id: projectId, key: 'atoma_files_payload' } },
                    update: { value: normalizedPayloadValue },
                    create: {
                        project_id: projectId,
                        key: 'atoma_files_payload',
                        value: normalizedPayloadValue
                    }
                });
            } else {
                await tx.projectSettings.deleteMany({
                    where: { project_id: projectId, key: 'atoma_files_payload' }
                });
            }
        });

        const refreshed = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['atoma_files_description', 'atoma_files_payload'] }
            }
        });

        const savedDescription = refreshed.find((setting) => setting.key === 'atoma_files_description')?.value || '';
        const savedPayloadValue = refreshed.find((setting) => setting.key === 'atoma_files_payload')?.value || '';
        const savedPayload = safeJsonParse(savedPayloadValue);
        const updatedAt = refreshed
            .map((setting) => setting.updated_at)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

        return {
            description: savedDescription,
            payload: savedPayload,
            payload_text: savedPayloadValue ? (savedPayload !== null ? formatJson(savedPayload) : savedPayloadValue) : '',
            updated_at: updatedAt
        };
    });

    fastify.get('/api/settings/skill-connections', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } }
        });

        if (!setting?.value) {
            return [];
        }

        try {
            const parsed = JSON.parse(setting.value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Failed to parse llm_skill_connections', error);
            return [];
        }
    });

    fastify.put('/api/settings/skill-connections', async (request: FastifyRequest<{ Body: { connections?: SkillConnectionInput[] } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { connections } = request.body || {};
        if (!Array.isArray(connections)) {
            return reply.code(400).send({ error: 'connections must be an array' });
        }

        const normalized = connections.map((connection, index) => {
            if (!connection?.name || !connection?.provider || !connection?.model) {
                throw new Error(`connections[${index}] must include name, provider and model`);
            }

            return {
                id: String(connection.id || `skill-connection-${index + 1}`),
                name: String(connection.name).trim(),
                provider: String(connection.provider).trim(),
                model: String(connection.model).trim(),
                providerKeyId: typeof connection.providerKeyId === 'number' ? connection.providerKeyId : null,
                endpointType: String(connection.endpointType || 'native').trim(),
                skillMode: String(connection.skillMode || 'native_skills').trim(),
                enabledSkills: Array.isArray(connection.enabledSkills)
                    ? connection.enabledSkills.map((skill) => String(skill).trim()).filter(Boolean)
                    : [],
                systemPrompt: String(connection.systemPrompt || ''),
                notes: String(connection.notes || ''),
                enabled: connection.enabled !== false,
                supportsSkills: connection.supportsSkills !== false
            };
        });

        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } },
            update: { value: JSON.stringify(normalized) },
            create: {
                project_id: projectId,
                key: 'llm_skill_connections',
                value: JSON.stringify(normalized)
            }
        });

        return normalized;
    });

    fastify.get('/api/settings/models', async (request: FastifyRequest<{ Querystring: { provider?: string; keyId?: string; key?: string } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const { provider, keyId, key } = request.query;

        let apiKey = key;
        let detectedProvider = provider || 'Unknown';

        if (keyId && projectId) {
            const storedKey = await prisma.providerKey.findFirst({
                where: { id: parseInt(keyId, 10), project_id: projectId }
            });
            if (storedKey) {
                apiKey = safeDecryptProviderKey(storedKey.key);
                detectedProvider = storedKey.provider;
            }
        }

        if (!apiKey) return reply.code(400).send({ error: 'API Key required' });

        if (!detectedProvider || detectedProvider === 'Unknown') {
            if (apiKey.startsWith('sk-ant')) detectedProvider = 'Anthropic';
            else if (apiKey.startsWith('AIza')) detectedProvider = 'Gemini';
            else if (apiKey.startsWith('sk-')) detectedProvider = 'OpenAI';
        }

        const models = await modelService.fetchModels(detectedProvider, apiKey);
        return { models };
    });
}
