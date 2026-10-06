import crypto from 'crypto';
import prisma from '../db';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import threadsService from './threads.service';
import { requireProjectActorAccess } from './project_access.service';

type ThreadsChannelConfig = { access_token?: string; threads_user_id?: string; user_id?: string };

export class ThreadsEngagementService {
    private async getChannel(projectId: number, channelId: number, actorId: string): Promise<Required<Pick<ThreadsChannelConfig, 'access_token' | 'threads_user_id'>>> {
        await requireProjectActorAccess(projectId, actorId);
        const channel = await prisma.socialChannel.findFirst({
            where: { id: channelId, project_id: projectId, is_active: true, type: 'threads' },
            select: { config: true }
        });
        if (!channel) throw new Error('ACTIVE_THREADS_CHANNEL_NOT_FOUND');
        const config = resolveEffectiveChannelConfig('threads', channel.config) as ThreadsChannelConfig;
        const accessToken = config.access_token?.trim();
        const threadsUserId = (config.threads_user_id || config.user_id)?.trim();
        if (!accessToken || !threadsUserId) throw new Error('THREADS_CREDENTIALS_NOT_READY');
        return { access_token: accessToken, threads_user_id: threadsUserId };
    }

    async searchPosts(args: {
        projectId: number; actorId: string; channelId: number; query: string;
        searchType?: 'TOP' | 'RECENT'; limit?: number; after?: string;
    }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const result = await threadsService.searchPosts(config.access_token, args);
        return { query: args.query.trim(), search_type: args.searchType ?? 'TOP', ...result, source: 'threads_keyword_search' };
    }

    async getReplies(args: {
        projectId: number; actorId: string; channelId: number; threadId: string;
        mode?: 'replies' | 'conversation'; reverse?: boolean; limit?: number; after?: string;
    }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        return threadsService.getReplies(config.access_token, args.threadId, args);
    }

    async comment(args: {
        projectId: number; actorId: string; channelId: number; threadId: string;
        text: string; idempotencyKey: string; confirm?: boolean;
    }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const text = args.text.trim();
        const fingerprint = crypto.createHash('sha256').update(`${args.threadId}:${text}`).digest('hex');
        const target = await threadsService.getPost(config.access_token, args.threadId);
        if (!args.confirm) return {
            status: 'preview', will_publish: false, executable: true,
            target: { id: target.id, permalink: target.permalink || null, username: target.username || null },
            text, text_fingerprint: fingerprint
        };

        const keyHash = crypto.createHash('sha256')
            .update(`${args.channelId}:${args.threadId}:${args.idempotencyKey}`).digest('hex');
        const settingKey = `threads_comment:${keyHash}`;
        const existing = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: args.projectId, key: settingKey } }
        });
        if (existing) {
            const previous = JSON.parse(existing.value) as Record<string, unknown>;
            if (previous.text_fingerprint !== fingerprint) throw new Error('THREADS_COMMENT_IDEMPOTENCY_CONFLICT');
            if (previous.status !== 'published') throw new Error('THREADS_COMMENT_OUTCOME_UNCERTAIN');
            return { ...previous, idempotent_replay: true };
        }

        const pending = { status: 'dispatching', text_fingerprint: fingerprint, target_id: args.threadId };
        await prisma.projectSettings.create({
            data: { project_id: args.projectId, key: settingKey, value: JSON.stringify(pending) }
        });
        try {
            const result = await threadsService.publishReply(
                config.threads_user_id, config.access_token, args.threadId, text);
            const record = {
                status: 'published', provider_id: result.id, permalink: result.url,
                target_id: args.threadId, text_fingerprint: fingerprint, published_at: new Date().toISOString()
            };
            await prisma.projectSettings.update({
                where: { project_id_key: { project_id: args.projectId, key: settingKey } },
                data: { value: JSON.stringify(record) }
            });
            return record;
        } catch (error) {
            await prisma.projectSettings.update({
                where: { project_id_key: { project_id: args.projectId, key: settingKey } },
                data: { value: JSON.stringify({ ...pending, status: 'uncertain' }) }
            });
            throw error;
        }
    }
}

export default new ThreadsEngagementService();
