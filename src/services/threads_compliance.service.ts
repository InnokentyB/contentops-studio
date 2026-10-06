import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

type ThreadsChannel = {
    id: number;
    project_id: number;
    type: string;
    config: unknown;
};

type ThreadsComplianceDb = {
    socialChannel: {
        findMany(args: unknown): Promise<ThreadsChannel[]>;
        findFirst(args: unknown): Promise<ThreadsChannel | null>;
    };
    $transaction<T>(callback: (tx: {
        socialChannel: { update(args: unknown): Promise<unknown> };
        event: { create(args: unknown): Promise<unknown> };
    }) => Promise<T>): Promise<T>;
};

type OAuthState = {
    projectId: number;
    channelId: number;
    userId: number;
    exp: number;
    nonce: string;
};

export type ThreadsComplianceServiceOptions = {
    db: ThreadsComplianceDb;
    appSecret?: string;
    stateSecret?: string;
    publicAppUrl?: string;
    now?: () => Date;
};

function record(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function encodedHmac(secret: string, value: string) {
    return createHmac('sha256', secret).update(value).digest('base64url');
}

function secureEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class ThreadsComplianceService {
    private readonly now: () => Date;

    constructor(private readonly options: ThreadsComplianceServiceOptions) {
        this.now = options.now || (() => new Date());
    }

    createOAuthState(binding: Omit<OAuthState, 'exp' | 'nonce'>) {
        const secret = this.requireStateSecret();
        const payload: OAuthState = {
            ...binding,
            exp: Math.floor(this.now().getTime() / 1000) + 10 * 60,
            nonce: randomBytes(16).toString('hex')
        };
        const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return `${encoded}.${encodedHmac(secret, encoded)}`;
    }

    readOAuthState(value: string): OAuthState {
        const secret = this.requireStateSecret();
        const [encoded, signature, extra] = value.split('.');
        if (!encoded || !signature || extra || !secureEqual(signature, encodedHmac(secret, encoded))) {
            throw new Error('THREADS_OAUTH_STATE_INVALID');
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        } catch {
            throw new Error('THREADS_OAUTH_STATE_INVALID');
        }
        const state = record(parsed);
        if (!Number.isInteger(state.projectId) || !Number.isInteger(state.channelId)
            || !Number.isInteger(state.userId)
            || typeof state.exp !== 'number' || state.exp < Math.floor(this.now().getTime() / 1000)
            || typeof state.nonce !== 'string' || !state.nonce) {
            throw new Error('THREADS_OAUTH_STATE_INVALID');
        }
        return state as OAuthState;
    }

    async findBoundChannel(state: OAuthState) {
        return this.options.db.socialChannel.findFirst({
            where: { id: state.channelId, project_id: state.projectId, type: 'threads' }
        });
    }

    async handleSignedRequest(signedRequest: string, action: 'deauthorize' | 'data_delete') {
        const payload = this.readMetaSignedRequest(signedRequest);
        const userId = payload.user_id;
        if (typeof userId !== 'string' && typeof userId !== 'number') {
            throw new Error('THREADS_SIGNED_REQUEST_INVALID');
        }
        const providerUserId = String(userId);
        const channels = await this.options.db.socialChannel.findMany({ where: { type: 'threads' } });
        const matching = channels.filter(channel => {
            const config = record(channel.config);
            const effective = record(config.raw_account);
            return String(effective.threads_user_id || effective.user_id || config.threads_user_id || config.user_id || '') === providerUserId;
        });
        const eventType = action === 'deauthorize' ? 'threads.deauthorized' : 'threads.data_deleted';

        for (const channel of matching) {
            const config = record(channel.config);
            const rawAccount = config.raw_account && typeof config.raw_account === 'object'
                ? record(config.raw_account)
                : null;
            const scrub = (source: JsonRecord) => {
                const next = { ...source };
                delete next.access_token;
                delete next.access_token_encrypted;
                delete next.oauth_expires_at;
                if (action === 'data_delete') {
                    delete next.threads_user_id;
                    delete next.user_id;
                    delete next.username;
                }
                return next;
            };
            const nextConfig = rawAccount
                ? { ...config, raw_account: scrub(rawAccount) }
                : scrub(config);
            await this.options.db.$transaction(async tx => {
                await tx.socialChannel.update({ where: { id: channel.id }, data: { config: nextConfig } });
                await tx.event.create({ data: {
                    entity_type: 'social_channel',
                    entity_id: channel.id,
                    event_type: eventType,
                    payload: {
                        project_id: channel.project_id,
                        provider_user_ref: createHash('sha256').update(providerUserId).digest('hex'),
                        source: 'meta_signed_request'
                    }
                } });
            });
        }

        const providerRef = createHash('sha256').update(providerUserId).digest('hex').slice(0, 16);
        const completedAt = Math.floor(this.now().getTime() / 1000).toString(16);
        const proof = `${providerRef}.${completedAt}`;
        const confirmationCode = `${proof}.${encodedHmac(this.requireAppSecret(), proof)}`;
        return { affectedChannels: matching.length, confirmationCode };
    }

    verifyConfirmationCode(code: string) {
        const [providerRef, completedAt, signature, extra] = code.split('.');
        const proof = `${providerRef}.${completedAt}`;
        return !extra && /^[a-f0-9]{16}$/.test(providerRef || '') && /^[a-f0-9]+$/.test(completedAt || '')
            && Boolean(signature) && secureEqual(signature!, encodedHmac(this.requireAppSecret(), proof));
    }

    dataDeletionStatusUrl(code: string) {
        const base = (this.options.publicAppUrl || '').replace(/\/+$/, '');
        if (!base.startsWith('https://')) throw new Error('THREADS_PUBLIC_APP_URL_REQUIRED');
        return `${base}/api/integrations/threads/data-deletion/status?code=${encodeURIComponent(code)}`;
    }

    private readMetaSignedRequest(value: string): JsonRecord {
        const [signature, encodedPayload, extra] = value.split('.');
        if (!signature || !encodedPayload || extra
            || !secureEqual(signature, encodedHmac(this.requireAppSecret(), encodedPayload))) {
            throw new Error('THREADS_SIGNED_REQUEST_INVALID');
        }
        try {
            const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
            const parsed = record(payload);
            if (parsed.algorithm !== 'HMAC-SHA256') throw new Error('THREADS_SIGNED_REQUEST_INVALID');
            return parsed;
        } catch {
            throw new Error('THREADS_SIGNED_REQUEST_INVALID');
        }
    }

    private requireAppSecret() {
        if (!this.options.appSecret) throw new Error('THREADS_APP_SECRET_REQUIRED');
        return this.options.appSecret;
    }

    private requireStateSecret() {
        if (!this.options.stateSecret) throw new Error('THREADS_OAUTH_STATE_SECRET_REQUIRED');
        return this.options.stateSecret;
    }
}
