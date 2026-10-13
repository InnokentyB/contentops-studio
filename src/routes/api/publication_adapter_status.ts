import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export interface AdapterStatusIdentity { projectId: number; taskId: number; actorId: string }
export const PublicationAdapterStatusSchema = z.object({
    supported: z.boolean(), canExecute: z.literal(false), manualRecordAllowed: z.boolean(),
    state: z.string(), blocker: z.string().nullable(), connection: z.enum(['online', 'offline', 'disabled', 'unavailable']),
    heartbeatAt: z.string().nullable(), publicUrl: z.string().nullable(), observedAt: z.string()
}).strict();
export type PublicationAdapterStatus = z.infer<typeof PublicationAdapterStatusSchema>;
export type AdapterStatusReader = (identity: AdapterStatusIdentity) => Promise<PublicationAdapterStatus | null>;

/** Authenticated read bridge only; no dispatch, resume, provider or fact mutation. */
export function registerPublicationAdapterStatus(app: FastifyInstance, read: AdapterStatusReader): void {
    app.get<{ Params: { id: string } }>('/api/publication-tasks/:id/adapter-status', async (request, reply) => {
        const context = request as typeof request & { projectId?: number; user?: { id: number } };
        const userId = context.user?.id, projectId = context.projectId;
        if (!userId || !projectId || !Number.isSafeInteger(userId) || !Number.isSafeInteger(projectId))
            return reply.code(401).send({ error: 'AUTH_REQUIRED' });
        const taskId = Number(request.params.id);
        if (!Number.isSafeInteger(taskId) || taskId <= 0) return reply.code(400).send({ error: 'INVALID_TASK_ID' });
        try {
            const result = await read({ projectId, taskId, actorId: `user:${userId}` });
            if (!result) return reply.code(404).send({ error: 'PUBLICATION_TASK_NOT_FOUND' });
            return PublicationAdapterStatusSchema.parse(result);
        } catch {
            // Fail closed and keep internal authorization/provider diagnostics out of the response.
            return reply.code(503).send({ error: 'ADAPTER_STATUS_UNAVAILABLE' });
        }
    });
}
