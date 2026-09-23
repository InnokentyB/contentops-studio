"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizationRoleAllows = organizationRoleAllows;
exports.userIdFromActor = userIdFromActor;
exports.requireOrganizationAccess = requireOrganizationAccess;
exports.requireOrganizationActorAccess = requireOrganizationActorAccess;
exports.requireProjectInOrganization = requireProjectInOrganization;
exports.requireOrganizationProjectAccess = requireOrganizationProjectAccess;
const db_1 = __importDefault(require("../db"));
const CAPABILITY_ROLES = {
    read: new Set(['owner', 'researcher', 'viewer']),
    search: new Set(['owner', 'researcher']),
    configure_sources: new Set(['owner']),
    route: new Set(['owner', 'researcher'])
};
function isOrganizationRole(value) {
    return value === 'owner' || value === 'researcher' || value === 'viewer';
}
function organizationRoleAllows(role, capability) {
    return isOrganizationRole(role) && CAPABILITY_ROLES[capability].has(role);
}
function userIdFromActor(actorId) {
    if (!actorId.startsWith('user:'))
        throw new Error('[Security] Organization access denied');
    const userId = Number(actorId.slice(5));
    if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new Error('[Security] Organization access denied');
    return userId;
}
async function requireOrganizationAccess(organizationId, userId, capability = 'read', client = db_1.default) {
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error('[Security] Organization access denied');
    }
    const membership = await client.organizationMember.findUnique({
        where: { organization_id_user_id: { organization_id: organizationId, user_id: userId } },
        select: { id: true, role: true }
    });
    if (!membership || !organizationRoleAllows(membership.role, capability)) {
        throw new Error('[Security] Organization access denied');
    }
    return membership;
}
async function requireOrganizationActorAccess(organizationId, actorId, capability = 'read', client = db_1.default) {
    return requireOrganizationAccess(organizationId, userIdFromActor(actorId), capability, client);
}
async function requireProjectInOrganization(organizationId, projectId, client = db_1.default) {
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
        throw new Error('[Security] Organization access denied');
    }
    const project = await client.project.findFirst({
        where: { id: projectId, organization_id: organizationId },
        select: { id: true, organization_id: true, is_archived: true }
    });
    if (!project)
        throw new Error('[Security] Organization access denied');
    return project;
}
async function requireOrganizationProjectAccess(organizationId, projectId, userId, capability, client = db_1.default) {
    const [membership, project] = await Promise.all([
        requireOrganizationAccess(organizationId, userId, capability, client),
        requireProjectInOrganization(organizationId, projectId, client)
    ]);
    return { membership, project };
}
