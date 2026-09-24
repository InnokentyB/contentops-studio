import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import { RegisterSchema, LoginSchema } from '../schemas/routes.schema';

export default async function authRoutes(fastify: FastifyInstance) {
    fastify.post('/api/auth/register', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '15 minutes'
            }
        }
    }, async (request, reply) => {
        const parseResult = RegisterSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.code(400).send({
                error: parseResult.error.issues[0]?.message || 'Invalid registration input'
            });
        }

        const { email, password, name } = parseResult.data;
        try {
            const result = await authService.register(email, password, name);
            return result;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Registration failed';
            return reply.code(400).send({ error: message });
        }
    });

    fastify.post('/api/auth/login', {
        config: {
            rateLimit: {
                max: 15,
                timeWindow: '15 minutes'
            }
        }
    }, async (request, reply) => {
        const parseResult = LoginSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.code(400).send({
                error: parseResult.error.issues[0]?.message || 'Invalid login input'
            });
        }

        const { email, password } = parseResult.data;
        try {
            const result = await authService.login(email, password);
            return result;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Login failed';
            return reply.code(401).send({ error: message });
        }
    });

    fastify.get('/api/auth/me', async (request, reply) => {
        try {
            const token = request.headers.authorization?.split(' ')[1];
            if (!token) throw new Error('No token');

            const user = authService.verifyToken(token);
            const projects = await authService.getUserProjects(user.id);

            return { user, projects };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Unauthorized';
            return reply.code(401).send({ error: message });
        }
    });
}

