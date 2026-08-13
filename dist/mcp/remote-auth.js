"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scopeRemoteMcpRequest = scopeRemoteMcpRequest;
const capabilities_1 = require("./capabilities");
const REMOTE_DENIED_TOOLS = new Set([
    'ba_list_users',
    'ba_get_user',
    'ba_create_project',
    'ba_update_project',
    'ba_archive_project'
]);
function scopeRemoteMcpRequest(body, principal) {
    if (!principal || !body || body.method !== 'tools/call') {
        return { allowed: true, body };
    }
    const toolName = body.params?.name;
    const profile = principal.profile || 'owner';
    if (typeof toolName === 'string' && !(0, capabilities_1.isToolAllowedForProfile)(profile, toolName)) {
        return { allowed: false, body, toolName };
    }
    if (typeof toolName === 'string' && REMOTE_DENIED_TOOLS.has(toolName)) {
        return { allowed: false, body, toolName };
    }
    const currentArguments = body.params?.arguments;
    if (!currentArguments || typeof currentArguments !== 'object' || Array.isArray(currentArguments)) {
        return { allowed: true, body };
    }
    const scopedArguments = { ...currentArguments };
    if ('actorId' in scopedArguments)
        scopedArguments.actorId = principal.actorId;
    if ('userId' in scopedArguments)
        scopedArguments.userId = principal.userId;
    if (principal.projectId && 'projectId' in scopedArguments)
        scopedArguments.projectId = principal.projectId;
    return {
        allowed: true,
        body: {
            ...body,
            params: { ...body.params, arguments: scopedArguments }
        }
    };
}
