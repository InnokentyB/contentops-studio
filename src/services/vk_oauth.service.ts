import crypto from 'crypto';
import { decryptChannelSecret, encryptChannelSecret } from '../utils/channel_secrets';

const VK_ID_BASE_URL = 'https://id.vk.ru';
const VK_API_BASE_URL = 'https://api.vk.com/method';
const VK_API_VERSION = '5.199';
const STATE_LIFETIME_SECONDS = 10 * 60;

type VkOAuthState = {
    projectId: number;
    channelId: number;
    userId: number;
    nonce: string;
    verifier: string;
    issuedAt: number;
};

type VkTokenResponse = {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    user_id?: number;
    state?: string;
    error?: string;
    error_description?: string;
};

function base64UrlSha256(value: string) {
    return crypto.createHash('sha256').update(value).digest('base64url');
}

export class VkOAuthService {
    get clientId() {
        const value = process.env.VK_CLIENT_ID?.trim();
        if (!value || !/^\d+$/.test(value)) throw new Error('VK_CLIENT_ID is not configured');
        return value;
    }

    get redirectUri() {
        const value = process.env.VK_REDIRECT_URI?.trim();
        if (!value || !/^https:\/\//.test(value)) throw new Error('VK_REDIRECT_URI must be an HTTPS URL');
        return value;
    }

    createAuthorization(params: { projectId: number; channelId: number; userId: number }) {
        const verifier = crypto.randomBytes(48).toString('base64url');
        const statePayload: VkOAuthState = {
            ...params,
            verifier,
            nonce: crypto.randomUUID(),
            issuedAt: Math.floor(Date.now() / 1000)
        };
        // VK ID normalizes punctuation in `state`, so transport the sealed value
        // through an URL-safe alphabet rather than exposing the `enc:v1:` format.
        const state = Buffer.from(encryptChannelSecret(JSON.stringify(statePayload)), 'utf8').toString('base64url');
        const query = new URLSearchParams({
            client_id: this.clientId,
            app_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            code_challenge: base64UrlSha256(verifier),
            code_challenge_method: 'S256',
            scope: 'wall photos groups stats stories offline',
            state
        });
        return { authorizationUrl: `${VK_ID_BASE_URL}/authorize?${query.toString()}`, state };
    }

    readState(value: string): VkOAuthState {
        let parsed: VkOAuthState;
        try {
            if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid state alphabet');
            const sealed = Buffer.from(value, 'base64url').toString('utf8');
            parsed = JSON.parse(decryptChannelSecret(sealed));
        } catch {
            throw new Error('VK OAuth state is invalid');
        }
        const now = Math.floor(Date.now() / 1000);
        if (!parsed.projectId || !parsed.channelId || !parsed.userId || !parsed.verifier || !parsed.nonce) {
            throw new Error('VK OAuth state is incomplete');
        }
        if (!parsed.issuedAt || parsed.issuedAt > now + 30 || now - parsed.issuedAt > STATE_LIFETIME_SECONDS) {
            throw new Error('VK OAuth state has expired');
        }
        return parsed;
    }

    async exchangeCode(params: { code: string; deviceId: string; state: string; verifier: string }): Promise<VkTokenResponse> {
        const query = new URLSearchParams({
            grant_type: 'authorization_code',
            redirect_uri: this.redirectUri,
            client_id: this.clientId,
            code_verifier: params.verifier,
            state: params.state,
            device_id: params.deviceId
        });
        const response = await fetch(`${VK_ID_BASE_URL}/oauth2/auth?${query.toString()}`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ code: params.code })
        });
        const payload = await response.json() as VkTokenResponse;
        if (!response.ok || payload.error || !payload.access_token) {
            throw new Error(payload.error_description || payload.error || `VK token exchange failed (${response.status})`);
        }
        if (payload.state && payload.state !== params.state) throw new Error('VK OAuth response state mismatch');
        return payload;
    }

    private async callApi(method: string, accessToken: string, params: Record<string, string> = {}) {
        const query = new URLSearchParams({ ...params, access_token: accessToken, v: VK_API_VERSION });
        const response = await fetch(`${VK_API_BASE_URL}/${method}?${query.toString()}`);
        const payload = await response.json() as any;
        if (!response.ok || payload?.error) {
            const detail = payload?.error?.error_msg || `request failed (${response.status})`;
            throw new Error(`VK API ${method}: ${detail}`);
        }
        return payload.response;
    }

    async verifyCommunityAdmin(accessToken: string, vkId: string, oauthUserId?: number) {
        const communityId = String(Math.abs(Number.parseInt(vkId, 10)));
        if (!/^\d+$/.test(communityId) || communityId === '0') throw new Error('VK community ID is invalid');
        let userId = Number(oauthUserId);
        if (!Number.isInteger(userId) || userId <= 0) {
            const users = await this.callApi('users.get', accessToken);
            userId = Number(users?.[0]?.id);
        }
        if (!userId) throw new Error('VK user identity could not be verified');

        // VK ID tokens can reject groups.get?filter=admin for their profile type.
        // Verify the one configured community instead of enumerating all admin groups.
        const response = await this.callApi('groups.getById', accessToken, { group_ids: communityId });
        const groups = Array.isArray(response) ? response : response?.groups;
        const community = Array.isArray(groups)
            ? groups.find((group: any) => String(group?.id) === communityId)
            : undefined;
        const isAdmin = community?.is_admin === 1
            || community?.is_admin === true
            || Number(community?.admin_level) > 0;
        if (!isAdmin) {
            const managers = await this.callApi('groups.getMembers', accessToken, {
                group_id: communityId,
                filter: 'managers',
                count: '1000'
            });
            const managerItems = Array.isArray(managers?.items) ? managers.items : [];
            const isManager = managerItems.some((manager: any) => Number(manager?.id ?? manager) === userId);
            if (isManager) return { userId, communityId };
            throw new Error('The authorized VK profile is not an administrator of this community');
        }
        return { userId, communityId };
    }
}

export default new VkOAuthService();
