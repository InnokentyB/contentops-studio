import { FastifyInstance } from 'fastify';
import linkedinService from '../services/linkedin.service';
import authService from '../services/auth.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default async function linkedinRoutes(fastify: FastifyInstance) {
    
    // GET /api/auth/linkedin/connect?projectId=123
    fastify.get('/api/auth/linkedin/connect', async (request, reply) => {
        const { projectId } = request.query as any;
        const parsedProjectId = Number(projectId);
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) return reply.code(401).send({ error: 'Authentication required' });
        if (!Number.isInteger(parsedProjectId)) {
            return reply.code(400).send({ error: 'projectId is required' });
        }

        try {
            const user = authService.verifyToken(token);
            if (user.is_demo) {
                return reply.code(403).send({ error: 'Demo access is read-only', code: 'DEMO_READ_ONLY' });
            }
            const membership = await prisma.projectMember.findUnique({
                where: { project_id_user_id: { project_id: parsedProjectId, user_id: user.id } }
            });
            if (membership?.role !== 'owner') {
                return reply.code(403).send({ error: 'Project owner access required' });
            }

            const state = authService.createLinkedInOAuthState(user.id, parsedProjectId);
            return { url: linkedinService.getAuthUrl(state) };
        } catch {
            return reply.code(401).send({ error: 'Invalid token' });
        }
    });

    // GET /api/auth/linkedin/callback
    fastify.get('/api/auth/linkedin/callback', async (request, reply) => {
        const { code, state, error, error_description } = request.query as any;

        if (error) {
            console.error(`LinkedIn Auth Error: ${error} - ${error_description}`);
            // Redirect back to frontend with error
            return reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?error=linkedin_auth_failed`);
        }

        if (!code || !state) {
            return reply.code(400).send({ error: 'Code or state missing' });
        }

        try {
            const binding = authService.verifyLinkedInOAuthState(state);
            const projectId = binding.project_id;
            const membership = await prisma.projectMember.findUnique({
                where: { project_id_user_id: { project_id: projectId, user_id: binding.user_id } },
                include: { user: true }
            });
            if (membership?.role !== 'owner' || membership.user.is_demo) {
                throw new Error('LinkedIn OAuth owner binding is no longer valid');
            }

            // 1. Exchange code for access token
            const token = await linkedinService.exchangeCodeToToken(code);

            // 2. Fetch User Profile to get URN and Name
            const { urn, name } = await linkedinService.getUserProfile(token);

            const existingChannel = await prisma.socialChannel.findFirst({
                where: {
                    project_id: projectId,
                    type: 'linkedin',
                    config: {
                        path: ['linkedin_urn'],
                        equals: urn
                    }
                }
            });

            if (existingChannel) {
                await prisma.socialChannel.update({
                    where: { id: existingChannel.id },
                    data: {
                        name: `LinkedIn: ${name}`,
                        config: {
                            ...(existingChannel.config as any),
                            linkedin_urn: urn,
                            access_token: token,
                            analytics_scope_enabled: true,
                            last_reconnected_at: new Date().toISOString()
                        } as any
                    }
                });
            } else {
                await prisma.socialChannel.create({
                    data: {
                        project_id: projectId,
                        type: 'linkedin',
                        name: `LinkedIn: ${name}`,
                        config: {
                            linkedin_urn: urn,
                            access_token: token,
                            analytics_scope_enabled: true,
                            last_reconnected_at: new Date().toISOString()
                        }
                    }
                });
            }

            // Redirect back to frontend settings page on success
            reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings`);
        } catch (err: any) {
            console.error('[LinkedIn OAuth] Error sorting callback:', err);
            reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?error=linkedin_auth_error`);
        }
    });
}
