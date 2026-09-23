"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const organization_access_service_1 = require("../services/organization_access.service");
function client(role, organizationId = 7) {
    return {
        organizationMember: {
            findUnique: async () => role ? { id: 1, role } : null
        },
        project: {
            findFirst: async ({ where }) => where.id === 11 && where.organization_id === organizationId
                ? { id: 11, organization_id: organizationId, is_archived: false }
                : null
        }
    };
}
(0, node_test_1.default)('organization roles expose only their declared research capabilities', () => {
    strict_1.default.equal((0, organization_access_service_1.organizationRoleAllows)('owner', 'configure_sources'), true);
    strict_1.default.equal((0, organization_access_service_1.organizationRoleAllows)('researcher', 'search'), true);
    strict_1.default.equal((0, organization_access_service_1.organizationRoleAllows)('researcher', 'configure_sources'), false);
    strict_1.default.equal((0, organization_access_service_1.organizationRoleAllows)('viewer', 'read'), true);
    strict_1.default.equal((0, organization_access_service_1.organizationRoleAllows)('viewer', 'route'), false);
    strict_1.default.equal((0, organization_access_service_1.organizationRoleAllows)('project_owner', 'read'), false);
});
(0, node_test_1.default)('organization access rejects missing membership and capability escalation', async () => {
    await strict_1.default.rejects((0, organization_access_service_1.requireOrganizationAccess)(7, 2, 'read', client(null)), /access denied/i);
    await strict_1.default.rejects((0, organization_access_service_1.requireOrganizationAccess)(7, 2, 'search', client('viewer')), /access denied/i);
    strict_1.default.equal((await (0, organization_access_service_1.requireOrganizationAccess)(7, 2, 'search', client('researcher'))).role, 'researcher');
});
(0, node_test_1.default)('organization project access requires both organization membership and tenant binding', async () => {
    const access = await (0, organization_access_service_1.requireOrganizationProjectAccess)(7, 11, 2, 'route', client('researcher'));
    strict_1.default.equal(access.project.organization_id, 7);
    await strict_1.default.rejects((0, organization_access_service_1.requireOrganizationProjectAccess)(7, 12, 2, 'route', client('researcher')), /access denied/i);
    await strict_1.default.rejects((0, organization_access_service_1.requireOrganizationProjectAccess)(7, 11, 2, 'route', client('viewer')), /access denied/i);
});
(0, node_test_1.default)('organization actor parsing accepts only a positive user principal', () => {
    strict_1.default.equal((0, organization_access_service_1.userIdFromActor)('user:42'), 42);
    strict_1.default.throws(() => (0, organization_access_service_1.userIdFromActor)('agent:researcher'), /access denied/i);
    strict_1.default.throws(() => (0, organization_access_service_1.userIdFromActor)('user:0'), /access denied/i);
    strict_1.default.throws(() => (0, organization_access_service_1.userIdFromActor)('user:2.5'), /access denied/i);
});
