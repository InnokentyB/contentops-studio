import prisma from '../../db';
import yaml from 'js-yaml';
import multiAgentService from '../../services/multi_agent.service';
import contentDictionaryService from '../../services/content_dictionary.service';
import contentPolicyMatrixService from '../../services/content_policy_matrix.service';
import { normalizeProjectKind, slugifyProjectName } from '../../utils/project.utils';
import { safeEncryptProviderKey } from '../../utils/channel_secrets';

import { AuthUser } from '../../services/auth.service';

export type AuthenticatedUser = AuthUser;


export type ImportedProjectConfig = {
    project?: {
        name?: string;
        slug?: string;
        description?: string;
        kind?: string;
    };
    settings?: Record<string, unknown>;
    content_dictionary?: unknown;
    content_policy_matrix?: unknown;
    provider_keys?: Array<{
        name?: string;
        key?: string;
        provider?: string;
    }>;
    channels?: Array<{
        type?: string;
        name?: string;
        config?: Record<string, unknown>;
    }>;
    agents?: Record<string, {
        prompt?: string;
        apiKey?: string;
        model?: string;
    }>;
    presets?: Array<{
        name?: string;
        role?: string;
        prompt_text?: string;
    }>;
    skill_connections?: Array<{
        id?: string;
        name?: string;
        provider?: string;
        model?: string;
        providerKeyId?: number;
        providerKeyName?: string;
        endpointType?: string;
        skillMode?: string;
        enabledSkills?: string[];
        systemPrompt?: string;
        notes?: string;
        enabled?: boolean;
        supportsSkills?: boolean;
    }>;
};

export const agentSettingKeyMap: Record<string, { prompt: string; key: string; model: string }> = {
    post_creator: {
        prompt: multiAgentService.KEY_POST_CREATOR_PROMPT,
        key: multiAgentService.KEY_POST_CREATOR_KEY,
        model: multiAgentService.KEY_POST_CREATOR_MODEL
    },
    post_critic: {
        prompt: multiAgentService.KEY_POST_CRITIC_PROMPT,
        key: multiAgentService.KEY_POST_CRITIC_KEY,
        model: multiAgentService.KEY_POST_CRITIC_MODEL
    },
    post_fixer: {
        prompt: multiAgentService.KEY_POST_FIXER_PROMPT,
        key: multiAgentService.KEY_POST_FIXER_KEY,
        model: multiAgentService.KEY_POST_FIXER_MODEL
    },
    topic_creator: {
        prompt: multiAgentService.KEY_TOPIC_CREATOR_PROMPT,
        key: multiAgentService.KEY_TOPIC_CREATOR_KEY,
        model: multiAgentService.KEY_TOPIC_CREATOR_MODEL
    },
    topic_critic: {
        prompt: multiAgentService.KEY_TOPIC_CRITIC_PROMPT,
        key: multiAgentService.KEY_TOPIC_CRITIC_KEY,
        model: multiAgentService.KEY_TOPIC_CRITIC_MODEL
    },
    topic_fixer: {
        prompt: multiAgentService.KEY_TOPIC_FIXER_PROMPT,
        key: multiAgentService.KEY_TOPIC_FIXER_KEY,
        model: multiAgentService.KEY_TOPIC_FIXER_MODEL
    },
    visual_architect: {
        prompt: multiAgentService.KEY_VISUAL_ARCHITECT_PROMPT,
        key: multiAgentService.KEY_VISUAL_ARCHITECT_KEY,
        model: multiAgentService.KEY_VISUAL_ARCHITECT_MODEL
    },
    structural_critic: {
        prompt: multiAgentService.KEY_STRUCTURAL_CRITIC_PROMPT,
        key: multiAgentService.KEY_STRUCTURAL_CRITIC_KEY,
        model: multiAgentService.KEY_STRUCTURAL_CRITIC_MODEL
    },
    precision_fixer: {
        prompt: multiAgentService.KEY_PRECISION_FIXER_PROMPT,
        key: multiAgentService.KEY_PRECISION_FIXER_KEY,
        model: multiAgentService.KEY_PRECISION_FIXER_MODEL
    },
    image_critic: {
        prompt: multiAgentService.KEY_IMAGE_CRITIC_PROMPT,
        key: multiAgentService.KEY_IMAGE_CRITIC_KEY,
        model: multiAgentService.KEY_IMAGE_CRITIC_MODEL
    }
};

export function detectProviderFromKey(key: string): string {
    if (key.startsWith('sk-ant')) return 'Anthropic';
    if (key.startsWith('AIza')) return 'Gemini';
    if (key.startsWith('sk-')) return 'OpenAI';
    return 'Other';
}

export function inferManualContentType(channelType: string, fileType?: string | null): string {
    if (channelType === 'linkedin') return 'linkedin:manual_content';
    if (channelType === 'reddit') return 'reddit:manual_content';
    if (channelType === 'tilda') return 'tilda:manual_content';
    if (channelType === 'medium') return 'medium:manual_content';
    if (channelType === 'indiehackers') return 'indiehackers:manual_content';
    if (fileType === 'html') return `${channelType}:manual_html`;
    return `${channelType}:manual_markdown`;
}

export function inferManualResourceKind(fileName: string, mimeType?: string | null): string {
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

export function readMultipartField(field: unknown): string {
    if (field == null) return '';
    if (typeof field === 'string') return field;
    if (typeof (field as { value?: unknown })?.value === 'string') {
        return (field as { value: string }).value;
    }
    return '';
}

export function isAutoCanvasChannel(channel: { config?: unknown; name?: string } | null | undefined): boolean {
    const config = channel?.config as Record<string, unknown> | undefined;

    const rawAccount = config?.raw_account as Record<string, unknown> | undefined;
    const workflowMode = (config?.workflow_mode || rawAccount?.planner_generation_mode || null) as string | null;
    if (workflowMode === 'auto_canvas') return true;

    const normalizedName = String(channel?.name || '').toLowerCase();
    return normalizedName.includes('analysts_thinking')
        || normalizedName.includes('analyst_thinking')
        || normalizedName.includes('аналитик который думал');
}

export function createConnectionId(name: string): string {
    const base = slugifyProjectName(name) || 'skill-connection';
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseProjectId(raw: string): number {
    const value = parseInt(raw, 10);
    if (Number.isNaN(value)) {
        throw new Error('Invalid project id');
    }
    return value;
}

export async function makeUniqueProjectSlug(baseSlug?: string, fallbackName?: string, excludeProjectId?: number): Promise<string> {
    const source = baseSlug?.trim() || fallbackName || 'project';
    const normalized = slugifyProjectName(source) || `project-${Date.now()}`;
    let candidate = normalized;
    let suffix = 1;

    while (await prisma.project.findFirst({
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

export async function resolveOwnedOrganizationId(userId: number, requestedOrganizationId?: number): Promise<number> {
    const membership = await prisma.organizationMember.findFirst({
        where: {
            user_id: userId,
            role: 'owner',
            organization: { is_archived: false },
            ...(requestedOrganizationId ? { organization_id: requestedOrganizationId } : {})
        },
        orderBy: { organization_id: 'asc' },
        select: { organization_id: true }
    });
    if (!membership) throw new Error('An owner organization is required');
    return membership.organization_id;
}

export function parseImportedProjectConfig(rawConfig: string): ImportedProjectConfig {
    const trimmed = rawConfig.trim();
    if (!trimmed) {
        throw new Error('Configuration is empty');
    }

    const parsed = yaml.load(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Configuration must be a YAML or JSON object');
    }

    return parsed as ImportedProjectConfig;
}

export async function buildImportedProjectData(rawConfig: string, userId: number) {
    const parsed = parseImportedProjectConfig(rawConfig);
    const projectBlock = parsed.project || {};
    const name = projectBlock.name?.trim();

    if (!name) {
        throw new Error('`project.name` is required');
    }

    const slug = await makeUniqueProjectSlug(projectBlock.slug, name);
    const description = projectBlock.description?.trim() || null;
    const kind = normalizeProjectKind(projectBlock.kind);
    const settings = Object.entries(parsed.settings || {})
        .filter(([key, value]) => typeof key === 'string' && key.trim() && value !== undefined && value !== null)
        .map(([key, value]) => ({
            key: key.trim(),
            value: typeof value === 'string' ? value : JSON.stringify(value)
        }));

    const dictionaryYaml = parsed.content_dictionary !== undefined
        ? contentDictionaryService.normalizeToYaml(parsed.content_dictionary)
        : null;
    const contentPolicyMatrixYaml = parsed.content_policy_matrix !== undefined
        ? contentPolicyMatrixService.normalizeToYaml(parsed.content_policy_matrix)
        : null;

    const channels = (parsed.channels || []).map((channel, index) => {
        if (!channel?.type || !channel?.name) {
            throw new Error(`channels[${index}] must include both type and name`);
        }

        return {
            type: channel.type.trim(),
            name: channel.name.trim(),
            config: (channel.config || {}) as any
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

        const entries: Array<{ key: string; value: string }> = [];
        if (config?.prompt !== undefined) entries.push({ key: keys.prompt, value: String(config.prompt) });
        if (config?.apiKey !== undefined) {
            const rawKey = String(config.apiKey).trim();
            const encryptedKey = rawKey && !rawKey.includes('••••') ? safeEncryptProviderKey(rawKey) : rawKey;
            entries.push({ key: keys.key, value: encryptedKey });
        }
        if (config?.model !== undefined) entries.push({ key: keys.model, value: String(config.model) });
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

    const uniqueSettings = Array.from(
        new Map(
            [
                ...settings,
                ...agentSettings,
                ...(dictionaryYaml ? [{ key: 'content_dictionary_yaml', value: dictionaryYaml }] : []),
                ...(contentPolicyMatrixYaml ? [{ key: 'content_policy_matrix_yaml', value: contentPolicyMatrixYaml }] : [])
            ].map((setting) => [setting.key, setting])
        ).values()
    );

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
