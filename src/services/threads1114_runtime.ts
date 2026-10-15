import { Prisma } from '@prisma/client';
import prisma from '../db';
import threadsService from './threads.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { THREADS1114 as p } from './threads1114_contract';
import { checked1114, hash } from './threads1114_store_guard';
import { replay1114, release1114, claim1114, confirm1114, uncertain1114 } from './threads1114_store';
import { executeThreads1114, releaseThreads1114, type Threads1114Ports, type Threads1114Request } from './threads1114_execution';

/** Credentials live only in the operational invocation, never in audit or MCP output. */
function ports1114(): Threads1114Ports {
    let token: string | null = null;
    async function credentials(): Promise<string> {
        const channel = await prisma.socialChannel.findFirst({ where: { id: 138, project_id: 10, is_active: true, type: 'threads' } });
        const config = resolveEffectiveChannelConfig('threads', channel?.config || {});
        if (config.threads_user_id !== p.userId || typeof config.access_token !== 'string' || !config.access_token.trim()) {
            throw new Error('[THREADS1114_CONNECTOR_NOT_READY]');
        }
        if (token !== null && token !== config.access_token) throw new Error('[THREADS1114_CREDENTIAL_CHANGED]');
        const current: string = config.access_token;
        token = current;
        return current;
    }
    return {
        replay: replay1114,
        inspect: (a, released) => prisma.$transaction(tx => checked1114(tx, a, released),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
        preflight: async () => {
            const current = await credentials();
            const identity = await threadsService.testConnection({ access_token: current, threads_user_id: p.userId });
            if (!identity.success || identity.details?.id !== p.userId || identity.details.username !== p.username) {
                throw new Error('[THREADS1114_PROVIDER_IDENTITY_UNVERIFIED]');
            }
            let after: string | undefined;
            const signal = AbortSignal.timeout(30_000);
            for (let page = 0; page < 5; page += 1) {
                const posts = await threadsService.getOwnPosts(current, p.userId, after, signal);
                if (posts.items.some(post => typeof post.text === 'string' && hash(post.text) === p.bodySha256)) {
                    throw new Error('[THREADS1114_DUPLICATE_FOUND]');
                }
                if (!posts.after) return;
                if (posts.after === after) break;
                after = posts.after;
            }
            throw new Error('[THREADS1114_HISTORY_INCOMPLETE]');
        },
        release: release1114, claim: claim1114,
        assertDispatch: async (a, id) => {
            await credentials();
            await prisma.$transaction(tx => checked1114(tx, a, true, id),
                { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        },
        publish: async body => {
            if (!token) throw new Error('[THREADS1114_CONNECTOR_NOT_READY]');
            return threadsService.publishVerifiedText(p.userId, token, body, p.username);
        },
        confirm: confirm1114, uncertain: uncertain1114, now: () => Date.now()
    };
}
export function releaseExactThreads1114(args: Threads1114Request) { return releaseThreads1114(ports1114(), args); }
export function publishExactThreads1114(args: Threads1114Request) { return executeThreads1114(ports1114(), args); }
