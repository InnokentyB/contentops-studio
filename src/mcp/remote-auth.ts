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
};

export function scopeRemoteMcpRequest(body: any, principal: RemotePrincipal | null) {
    if (!principal || !body || body.method !== 'tools/call') {
        return { allowed: true, body };
    }

    const toolName = body.params?.name;
    if (typeof toolName === 'string' && REMOTE_DENIED_TOOLS.has(toolName)) {
        return { allowed: false, body, toolName };
    }

    const currentArguments = body.params?.arguments;
    if (!currentArguments || typeof currentArguments !== 'object' || Array.isArray(currentArguments)) {
        return { allowed: true, body };
    }

    const scopedArguments = { ...currentArguments };
    if ('actorId' in scopedArguments) scopedArguments.actorId = principal.actorId;
    if ('userId' in scopedArguments) scopedArguments.userId = principal.userId;

    return {
        allowed: true,
        body: {
            ...body,
            params: { ...body.params, arguments: scopedArguments }
        }
    };
}
