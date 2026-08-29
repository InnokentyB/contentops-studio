import { createHash } from 'crypto';
import prisma from '../db';

export type AgentWorkspaceChat = {
    id: string;
    name: string;
    purpose: string;
    mcp_profile: 'owner' | 'planner' | 'writer' | 'art_director';
    responsibilities: string[];
    permissions: string[];
    startup_instructions: string[];
};

export type AgentWorkspaceManifest = {
    schema_version: '1.0';
    revision: string;
    checksum: string;
    project: { id: number; name: string; slug: string };
    chats: AgentWorkspaceChat[];
    handoffs: Array<{ from: string; to: string; when: string; artifact: string }>;
    channels: Array<{ id: number; name: string; type: string }>;
    model_assignments: Array<{ role: string; model: string }>;
    configuration_fingerprints: Array<{ key: string; checksum: string }>;
};

type ManifestInput = {
    project: { id: number; name: string; slug: string; updatedAt: Date };
    channels: Array<{ id: number; name: string; type: string; updatedAt: Date }>;
    settings: Array<{ key: string; value: string; updatedAt: Date }>;
};

const chats: AgentWorkspaceChat[] = [
    {
        id: 'planning_hq',
        name: 'Planning HQ',
        purpose: 'Own the operating plan, publication slots, themes, dates, dependencies and approvals.',
        mcp_profile: 'planner',
        responsibilities: ['Create and maintain publication slots', 'Set themes, channels and schedule', 'Resolve overdue work and blockers'],
        permissions: ['read_plan', 'change_schedule', 'change_slot_metadata', 'approve_week_plan'],
        startup_instructions: ['Load the latest workspace manifest', 'Read schedule exceptions before changing the plan', 'Never write publication copy']
    },
    {
        id: 'content_writer',
        name: 'Content Writer',
        purpose: 'Turn accepted publication slots into channel-ready copy without changing the plan.',
        mcp_profile: 'writer',
        responsibilities: ['Fill accepted publication slots with content', 'Use project sources and channel constraints', 'Submit the current revision for review'],
        permissions: ['read_plan', 'read_sources', 'write_content', 'submit_content'],
        startup_instructions: ['Load the latest workspace manifest', 'Claim only content-writing work', 'Never change dates, channels or slots']
    },
    {
        id: 'chief_editor',
        name: 'Chief Editor',
        purpose: 'Review revision-bound copy and accept or return it with actionable feedback.',
        mcp_profile: 'owner',
        responsibilities: ['Review content quality and evidence', 'Accept the exact reviewed revision', 'Return blocked copy with a reason'],
        permissions: ['read_plan', 'read_sources', 'review_content', 'decide_content'],
        startup_instructions: ['Load the latest workspace manifest', 'Verify the current content revision', 'Never accept a stale result version']
    },
    {
        id: 'art_director',
        name: 'Art Director',
        purpose: 'Decide whether a visual is required and govern the revision-bound visual brief.',
        mcp_profile: 'art_director',
        responsibilities: ['Assess visual need', 'Create placement-aware art direction', 'Review generated or supplied assets'],
        permissions: ['read_plan', 'read_content', 'decide_visual', 'review_visual'],
        startup_instructions: ['Load the latest workspace manifest', 'Use the current channel and visual placement', 'Never reuse a blocked stale art-direction input']
    },
    {
        id: 'publisher',
        name: 'Publisher / SMM',
        purpose: 'Execute an approved manual handoff or automated delivery and record the publication fact.',
        mcp_profile: 'owner',
        responsibilities: ['Verify release readiness', 'Publish through the configured delivery mode', 'Record the live URL and outcome'],
        permissions: ['read_plan', 'read_content', 'execute_delivery', 'record_publication_fact'],
        startup_instructions: ['Load the latest workspace manifest', 'Require accepted content and visual readiness', 'Never infer publication from an attempted delivery']
    },
    {
        id: 'growth_analyst',
        name: 'Growth Analyst',
        purpose: 'Collect channel and campaign checkpoints after confirmed publication.',
        mcp_profile: 'owner',
        responsibilities: ['Collect scheduled metric checkpoints', 'Roll up campaign performance', 'Surface missing or late measurements'],
        permissions: ['read_publication_facts', 'record_metrics', 'read_campaigns'],
        startup_instructions: ['Load the latest workspace manifest', 'Measure only confirmed publication facts', 'Preserve source and collection mode']
    }
];

const handoffs = [
    { from: 'planning_hq', to: 'content_writer', when: 'slot_ready', artifact: 'publication_slot' },
    { from: 'content_writer', to: 'chief_editor', when: 'content_submitted', artifact: 'content_revision' },
    { from: 'chief_editor', to: 'art_director', when: 'content_accepted', artifact: 'accepted_revision' },
    { from: 'art_director', to: 'publisher', when: 'visual_ready_or_waived', artifact: 'release_bundle' },
    { from: 'publisher', to: 'growth_analyst', when: 'publication_confirmed', artifact: 'publication_fact' }
];

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function buildAgentWorkspaceManifest(input: ManifestInput): AgentWorkspaceManifest {
    const timestamps = [input.project.updatedAt, ...input.channels.map((channel) => channel.updatedAt), ...input.settings.map((setting) => setting.updatedAt)];
    const revision = new Date(Math.max(...timestamps.map((value) => value.getTime()))).toISOString();
    const unsigned = {
        schema_version: '1.0' as const,
        revision,
        project: { id: input.project.id, name: input.project.name, slug: input.project.slug },
        chats,
        handoffs,
        channels: input.channels
            .map(({ id, name, type }) => ({ id, name, type }))
            .sort((a, b) => a.id - b.id),
        model_assignments: input.settings
            .filter((setting) => setting.key.endsWith('_model') && setting.value.trim())
            .map((setting) => ({ role: setting.key.replace(/^multi_agent_/, '').replace(/_model$/, ''), model: setting.value }))
            .sort((a, b) => a.role.localeCompare(b.role)),
        configuration_fingerprints: input.settings
            .filter((setting) => setting.key.endsWith('_prompt') || setting.key.endsWith('_model') || [
                'content_dictionary', 'content_policy_matrix', 'atoma_files_description', 'art_direction_pipeline_enabled'
            ].includes(setting.key))
            .map((setting) => ({
                key: setting.key,
                checksum: `sha256:${createHash('sha256').update(setting.value).digest('hex')}`
            }))
            .sort((a, b) => a.key.localeCompare(b.key))
    };
    const checksum = `sha256:${createHash('sha256').update(stableJson(unsigned)).digest('hex')}`;
    return { ...unsigned, checksum };
}

export function getAgentWorkspaceUpdate(manifest: AgentWorkspaceManifest, knownChecksum?: string) {
    if (knownChecksum && knownChecksum === manifest.checksum) {
        return { changed: false as const, checksum: manifest.checksum, revision: manifest.revision };
    }
    return { changed: true as const, checksum: manifest.checksum, revision: manifest.revision, manifest };
}

export async function loadAgentWorkspaceManifest(projectId: number, userId: number) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            channels: { where: { is_active: true }, orderBy: { id: 'asc' } },
            settings: {
                where: {
                    OR: [
                        { key: { endsWith: '_model' } },
                        { key: { endsWith: '_prompt' } },
                        { key: { in: ['content_dictionary', 'content_policy_matrix', 'atoma_files_description', 'art_direction_pipeline_enabled'] } }
                    ]
                },
                orderBy: { key: 'asc' }
            }
        }
    });
    if (!project) throw new Error(`Project ${projectId} not found`);
    const membership = await prisma.projectMember.findUnique({
        where: { project_id_user_id: { project_id: projectId, user_id: userId } },
        select: { id: true }
    });
    if (!membership) throw new Error('[SECURITY] Project access denied');
    return buildAgentWorkspaceManifest({
        project: { id: project.id, name: project.name, slug: project.slug, updatedAt: project.updated_at },
        channels: project.channels.map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, updatedAt: channel.updated_at })),
        settings: project.settings.map((setting) => ({ key: setting.key, value: setting.value, updatedAt: setting.updated_at }))
    });
}

export async function getAgentChatBootstrap(projectId: number, userId: number, chatId: string) {
    const manifest = await loadAgentWorkspaceManifest(projectId, userId);
    const chat = manifest.chats.find((entry) => entry.id === chatId);
    if (!chat) throw new Error(`[CHAT_NOT_FOUND] Unknown agent chat '${chatId}'`);
    return {
        project: manifest.project,
        schema_version: manifest.schema_version,
        revision: manifest.revision,
        checksum: manifest.checksum,
        chat,
        upstream: manifest.handoffs.filter((edge) => edge.to === chatId),
        downstream: manifest.handoffs.filter((edge) => edge.from === chatId),
        sync_instruction: 'Call ba_get_agent_workspace_updates with this checksum at the start of every session and after a planner configuration change.'
    };
}
