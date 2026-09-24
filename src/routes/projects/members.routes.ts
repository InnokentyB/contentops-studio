import { FastifyInstance } from 'fastify';
import prisma from '../../db';
import authService from '../../services/auth.service';
import crypto from 'crypto';
import { AuthenticatedUser } from './helpers';

export default async function projectMembersRoutes(fastify: FastifyInstance) {
    // Members management - Add member or create invitation
    fastify.post('/api/projects/:id/members', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id } = request.params as { id: string };
        const { email, role } = (request.body as { email?: string; role?: string }) || {};
        const projectId = parseInt(id, 10);

        if (!email) {
            return reply.code(400).send({ error: 'email is required' });
        }

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can add members' });
            return;
        }

        // Find user by email
        const targetUser = await prisma.user.findUnique({ where: { email } });

        // If user not found, create invitation
        if (!targetUser) {
            // Check existing invitation
            const existingInvite = await prisma.projectInvitation.findFirst({
                where: { project_id: projectId, email }
            });

            if (existingInvite) {
                return {
                    status: 'invited',
                    message: 'Invitation already exists',
                    invite_link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${existingInvite.token}`
                };
            }

            // Create new invitation
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

            await prisma.projectInvitation.create({
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
        const existing = await prisma.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: targetUser.id } }
        });

        if (existing) {
            return reply.code(400).send({ error: 'User already in project' });
        }

        const member = await prisma.projectMember.create({
            data: {
                project_id: projectId,
                user_id: targetUser.id,
                role: role || 'viewer'
            },
            include: { user: { select: { id: true, name: true, email: true } } }
        });

        return member;
    });

    // Get invitation details
    fastify.get('/api/invitations/:token', async (request, reply) => {
        const { token } = request.params as { token: string };

        const invitation = await prisma.projectInvitation.findUnique({
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

        let user: AuthenticatedUser;
        try {
            user = authService.verifyToken(tokenHeader);
        } catch {

            return reply.code(401).send({ error: 'Invalid token' });
        }

        const { token } = request.params as { token: string };

        const invitation = await prisma.projectInvitation.findUnique({
            where: { token }
        });

        if (!invitation) {
            return reply.code(404).send({ error: 'Invitation not found' });
        }

        if (new Date() > invitation.expires_at) {
            return reply.code(410).send({ error: 'Invitation expired' });
        }

        try {
            await prisma.projectMember.create({
                data: {
                    project_id: invitation.project_id,
                    user_id: user.id,
                    role: invitation.role
                }
            });
        } catch {
            // Ignore if already member
        }

        await prisma.projectInvitation.delete({ where: { token } });

        return { success: true, projectId: invitation.project_id };
    });

    // Remove member
    fastify.delete('/api/projects/:id/members/:userId', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, userId } = request.params as { id: string; userId: string };
        const projectId = parseInt(id, 10);
        const targetUserId = parseInt(userId, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can remove members' });
            return;
        }

        if (user.id === targetUserId) {
            return reply.code(400).send({ error: 'Cannot remove yourself' });
        }

        await prisma.projectMember.delete({
            where: { project_id_user_id: { project_id: projectId, user_id: targetUserId } }
        });

        return { success: true };
    });
}
