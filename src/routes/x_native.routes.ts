import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import authService from '../services/auth.service';
import { issueNativePairing, readNativePairing, verifyNativePairing } from '../services/x_native_pairing';
import { registerNativeInstallation, revokeNativeInstallation } from '../services/x_native_registry';
import { issueNativeChallenge, readNativeChallenge, refreshNativeStart, heartbeatNativeExecution } from '../services/x_native_control';
import { advanceNativeChallenge } from '../services/x_native_advance';
import { executeNativeReceipt } from '../services/x_native_execution';
import { NativePairingWaitError } from '../services/x_native_pairing_issue';

type OwnerOperation = 'pair' | 'register' | 'revoke' | 'challenge';
type DelegateOperation = 'pair-read' | 'pair-receipt' | 'read' | 'advance' | 'reconcile' | 'refresh' | 'heartbeat' | 'receipt';
export type NativeHttpServices = {
    enabled(): boolean;
    actorFromToken(token: string): string;
    owner(operation: OwnerOperation, input: unknown): Promise<unknown>;
    delegate(operation: DelegateOperation, input: unknown, origin: string): Promise<unknown>;
};
const services: NativeHttpServices = {
    enabled: () => process.env.X_NATIVE_PILOT_ENABLED === 'true',
    actorFromToken: token => {
        const user = authService.verifyToken(token);
        if (user.is_demo || !Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('[OWNER_REQUIRED]');
        return `user:${user.id}`;
    },
    owner: (operation, input) => {
        switch (operation) {
            case 'pair': return issueNativePairing(input);
            case 'register': return registerNativeInstallation(input);
            case 'revoke': return revokeNativeInstallation(input);
            case 'challenge': return issueNativeChallenge(input);
        }
    },
    delegate: (operation, input, origin) => {
        switch (operation) {
            case 'pair-read': return readNativePairing(input, undefined, origin);
            case 'pair-receipt': return verifyNativePairing(input, undefined, origin);
            case 'read': return readNativeChallenge(input, undefined, origin);
            case 'advance': return advanceNativeChallenge(input, false, undefined, origin);
            case 'reconcile': return advanceNativeChallenge(input, true, undefined, origin);
            case 'refresh': return refreshNativeStart(input, undefined, origin);
            case 'heartbeat': return heartbeatNativeExecution(input, undefined, origin);
            case 'receipt': return executeNativeReceipt(input, undefined, origin);
        }
    }
};
const ownerOperations: OwnerOperation[] = ['pair', 'register', 'revoke', 'challenge'];
const delegateOperations: DelegateOperation[] = ['pair-read', 'pair-receipt', 'read', 'advance', 'reconcile', 'refresh', 'heartbeat', 'receipt'];
const extensionOrigin = (value: unknown): value is string => typeof value === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(value);
const record = z.record(z.string(), z.unknown());
function ownerInput(operation: OwnerOperation, input: unknown, actorId: string): unknown {
    const body = record.parse(input);
    return operation === 'challenge' ? { ...body, context: { ...record.parse(body.context), actorId } } : { ...body, actorId };
}
/** JSON-only extension bridge. Origin is checked again against the enrolled key inside each service transaction. */
export async function registerXNativeRoutes(server: FastifyInstance, dependencies: NativeHttpServices = services) {
    // Global web-app CORS does not decide extension authority. These routes use their bounded transport policy below.
    const options = { bodyLimit: 24000, config: { cors: false, rateLimit: { max: 30, timeWindow: '1 minute' } } };
    for (const operation of [...ownerOperations, ...delegateOperations]) {
        const path = `/api/integrations/x-native/${operation}`;
        const delegate = delegateOperations.includes(operation as DelegateOperation);
        if (delegate) server.options(path, options, async (request, reply) => {
            const requestedHeaders = String(request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(v => v.trim()).filter(Boolean);
            if (!extensionOrigin(request.headers.origin) || request.headers['access-control-request-method'] !== 'POST'
                || requestedHeaders.some(value => value !== 'content-type')) return reply.code(403).send();
            return reply.header('Access-Control-Allow-Origin', request.headers.origin).header('Vary', 'Origin')
                .header('Access-Control-Allow-Methods', 'POST').header('Access-Control-Allow-Headers', 'Content-Type')
                .header('Cache-Control', 'no-store').code(204).send();
        });
        server.post(path, options, async (request, reply) => {
            reply.header('Cache-Control', 'no-store').header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
            if (!dependencies.enabled()) return reply.code(503).send({ code: 'X_NATIVE_PILOT_DISABLED' });
            try {
                if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
                    throw new Error('[X_NATIVE_CONTENT_TYPE_REQUIRED]');
                }
                if (delegate) {
                    if (!extensionOrigin(request.headers.origin)) throw new Error('[X_NATIVE_ORIGIN_DENIED]');
                    reply.header('Access-Control-Allow-Origin', request.headers.origin).header('Vary', 'Origin');
                    return await dependencies.delegate(operation as DelegateOperation, request.body, request.headers.origin);
                }
                const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
                if (!token) throw new Error('[OWNER_REQUIRED]');
                const actorId = dependencies.actorFromToken(token);
                if (!/^user:[1-9]\d*$/.test(actorId)) throw new Error('[OWNER_REQUIRED]');
                return await dependencies.owner(operation as OwnerOperation, ownerInput(operation as OwnerOperation, request.body, actorId));
            } catch (error: unknown) {
                if (error instanceof NativePairingWaitError) return reply.header('Retry-After', String(error.retryAfterSeconds))
                    .code(error.message === '[X_NATIVE_PAIRING_THROTTLED]' ? 429 : 409).send({ code: error.message.slice(1,-1),
                        retry_allowed: false, retry_after_seconds: error.retryAfterSeconds, retry_at: error.retryAt });
                const candidate = error instanceof Error ? /^\[([A-Z0-9_]+)\]/.exec(error.message)?.[1] : undefined;
                const code = candidate && /^(X_NATIVE_[A-Z0-9_]+|BROWSER_[A-Z0-9_]+|OWNER_REQUIRED|STALE_MANIFEST|IDEMPOTENCY_CONFLICT)$/.test(candidate)
                    ? candidate : 'X_NATIVE_REQUEST_REJECTED';
                return reply.code(409).send({ code, retry_allowed: false });
            }
        });
    }
}
export default async function xNativeRoutes(server: FastifyInstance) { await registerXNativeRoutes(server); }
