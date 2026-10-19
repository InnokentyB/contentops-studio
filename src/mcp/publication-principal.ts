import { AsyncLocalStorage } from 'node:async_hooks';
import type { RemotePrincipal } from './remote-auth';

const identities = new AsyncLocalStorage<Readonly<RemotePrincipal> | null>();
export function withPublicationPrincipal<T>(principal: RemotePrincipal | null, run: () => T): T {
    if (principal && (!Number.isSafeInteger(principal.userId) || principal.userId < 1
        || principal.actorId !== `user:${principal.userId}`
        || (principal.projectId !== undefined && (!Number.isSafeInteger(principal.projectId) || principal.projectId < 1)))) {
        throw new Error('[PUBLICATION_PRINCIPAL_INVALID]');
    }
    return identities.run(principal ? Object.freeze({ ...principal }) : null, run);
}
export function currentPublicationPrincipal(): Readonly<RemotePrincipal> | null {
    return identities.getStore() || null;
}
export function requirePublicationPrincipal(projectId: number): Readonly<RemotePrincipal> {
    const principal = currentPublicationPrincipal();
    if (!principal) throw new Error('[PUBLICATION_PRINCIPAL_REQUIRED]');
    if (principal.projectId !== undefined && principal.projectId !== projectId) throw new Error('[PUBLICATION_PRINCIPAL_SCOPE_MISMATCH]');
    return principal;
}
export function configuredPublicationPrincipal(environment: NodeJS.ProcessEnv): RemotePrincipal | null {
    const userId = Number(environment.MCP_PRINCIPAL_USER_ID);
    return Number.isSafeInteger(userId) && userId > 0 ? { userId, actorId: `user:${userId}`, profile: 'owner' } : null;
}
