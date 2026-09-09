import { isToolAllowedForProfile, McpCapabilityProfile } from './capabilities';

const REMOTE_DENIED_TOOLS = new Set([
    'ba_list_users',
    'ba_get_user',
    'ba_create_project',
    'ba_update_project',
    'ba_archive_project'
]);

export type RemotePrincipal = {
    userId: number;
    actorId: string;
    projectId?: number;
    profile?: McpCapabilityProfile;
};

export type RemoteScopeDenialReason = 'tool_not_allowed' | 'project_scope_mismatch';

export function scopeRemoteMcpRequest(body: any, principal: RemotePrincipal | null) {
    if (!principal || !body || body.method !== 'tools/call') {
        return { allowed: true, body };
    }

    const toolName = body.params?.name;
    const profile = principal.profile || 'owner';
    if (typeof toolName === 'string' && !isToolAllowedForProfile(profile, toolName)) {
        return { allowed: false, body, toolName, reason: 'tool_not_allowed' as RemoteScopeDenialReason };
    }
    if (typeof toolName === 'string' && REMOTE_DENIED_TOOLS.has(toolName)) {
        return { allowed: false, body, toolName, reason: 'tool_not_allowed' as RemoteScopeDenialReason };
    }

    const currentArguments = body.params?.arguments;
    if (!currentArguments || typeof currentArguments !== 'object' || Array.isArray(currentArguments)) {
        return { allowed: true, body };
    }

    const scopedArguments = { ...currentArguments };
    if (principal.projectId && 'projectId' in scopedArguments) {
        const requestedProjectId = Number(scopedArguments.projectId);
        if (!Number.isInteger(requestedProjectId) || requestedProjectId !== principal.projectId) {
            return {
                allowed: false,
                body,
                toolName,
                reason: 'project_scope_mismatch' as RemoteScopeDenialReason,
                requestedProjectId: Number.isInteger(requestedProjectId) ? requestedProjectId : null,
                boundProjectId: principal.projectId
            };
        }
    }
    if ('actorId' in scopedArguments) scopedArguments.actorId = principal.actorId;
    if ('userId' in scopedArguments || toolName?.startsWith('ba_get_agent_')) scopedArguments.userId = principal.userId;
    if (principal.projectId && ('projectId' in scopedArguments || toolName?.startsWith('ba_get_agent_'))) scopedArguments.projectId = principal.projectId;

    return {
        allowed: true,
        body: {
            ...body,
            params: { ...body.params, arguments: scopedArguments }
        }
    };
}
