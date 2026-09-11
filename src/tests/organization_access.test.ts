import test from 'node:test';
import assert from 'node:assert/strict';
import {
    organizationRoleAllows,
    requireOrganizationAccess,
    requireOrganizationProjectAccess,
    userIdFromActor
} from '../services/organization_access.service';

function client(role: string | null, organizationId = 7) {
    return {
        organizationMember: {
            findUnique: async () => role ? { id: 1, role } : null
        },
        project: {
            findFirst: async ({ where }: any) => where.id === 11 && where.organization_id === organizationId
                ? { id: 11, organization_id: organizationId, is_archived: false }
                : null
        }
    } as any;
}

test('organization roles expose only their declared research capabilities', () => {
    assert.equal(organizationRoleAllows('owner', 'configure_sources'), true);
    assert.equal(organizationRoleAllows('researcher', 'search'), true);
    assert.equal(organizationRoleAllows('researcher', 'configure_sources'), false);
    assert.equal(organizationRoleAllows('viewer', 'read'), true);
    assert.equal(organizationRoleAllows('viewer', 'route'), false);
    assert.equal(organizationRoleAllows('project_owner', 'read'), false);
});

test('organization access rejects missing membership and capability escalation', async () => {
    await assert.rejects(requireOrganizationAccess(7, 2, 'read', client(null)), /access denied/i);
    await assert.rejects(requireOrganizationAccess(7, 2, 'search', client('viewer')), /access denied/i);
    assert.equal((await requireOrganizationAccess(7, 2, 'search', client('researcher'))).role, 'researcher');
});

test('organization project access requires both organization membership and tenant binding', async () => {
    const access = await requireOrganizationProjectAccess(7, 11, 2, 'route', client('researcher'));
    assert.equal(access.project.organization_id, 7);
    await assert.rejects(requireOrganizationProjectAccess(7, 12, 2, 'route', client('researcher')), /access denied/i);
    await assert.rejects(requireOrganizationProjectAccess(7, 11, 2, 'route', client('viewer')), /access denied/i);
});

test('organization actor parsing accepts only a positive user principal', () => {
    assert.equal(userIdFromActor('user:42'), 42);
    assert.throws(() => userIdFromActor('agent:researcher'), /access denied/i);
    assert.throws(() => userIdFromActor('user:0'), /access denied/i);
    assert.throws(() => userIdFromActor('user:2.5'), /access denied/i);
});
