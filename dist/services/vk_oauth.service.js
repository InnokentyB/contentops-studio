"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VkOAuthService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const channel_secrets_1 = require("../utils/channel_secrets");
const VK_ID_BASE_URL = 'https://id.vk.ru';
const VK_API_BASE_URL = 'https://api.vk.com/method';
const VK_API_VERSION = '5.199';
const STATE_LIFETIME_SECONDS = 10 * 60;
function base64UrlSha256(value) {
    return crypto_1.default.createHash('sha256').update(value).digest('base64url');
}
class VkOAuthService {
    get clientId() {
        const value = process.env.VK_CLIENT_ID?.trim();
        if (!value || !/^\d+$/.test(value))
            throw new Error('VK_CLIENT_ID is not configured');
        return value;
    }
    get redirectUri() {
        const value = process.env.VK_REDIRECT_URI?.trim();
        if (!value || !/^https:\/\//.test(value))
            throw new Error('VK_REDIRECT_URI must be an HTTPS URL');
        return value;
    }
    createAuthorization(params) {
        const verifier = crypto_1.default.randomBytes(48).toString('base64url');
        const statePayload = {
            ...params,
            verifier,
            nonce: crypto_1.default.randomUUID(),
            issuedAt: Math.floor(Date.now() / 1000)
        };
        // VK ID normalizes punctuation in `state`, so transport the sealed value
        // through an URL-safe alphabet rather than exposing the `enc:v1:` format.
        const state = Buffer.from((0, channel_secrets_1.encryptChannelSecret)(JSON.stringify(statePayload)), 'utf8').toString('base64url');
        const query = new URLSearchParams({
            client_id: this.clientId,
            app_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            code_challenge: base64UrlSha256(verifier),
            code_challenge_method: 'S256',
            scope: 'wall photos groups stats offline',
            state
        });
        return { authorizationUrl: `${VK_ID_BASE_URL}/authorize?${query.toString()}`, state };
    }
    readState(value) {
        let parsed;
        try {
            if (!/^[A-Za-z0-9_-]+$/.test(value))
                throw new Error('Invalid state alphabet');
            const sealed = Buffer.from(value, 'base64url').toString('utf8');
            parsed = JSON.parse((0, channel_secrets_1.decryptChannelSecret)(sealed));
        }
        catch {
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
    async exchangeCode(params) {
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
        const payload = await response.json();
        if (!response.ok || payload.error || !payload.access_token) {
            throw new Error(payload.error_description || payload.error || `VK token exchange failed (${response.status})`);
        }
        if (payload.state && payload.state !== params.state)
            throw new Error('VK OAuth response state mismatch');
        return payload;
    }
    async callApi(method, accessToken, params = {}) {
        const query = new URLSearchParams({ ...params, access_token: accessToken, v: VK_API_VERSION });
        const response = await fetch(`${VK_API_BASE_URL}/${method}?${query.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.error_msg || `VK API verification failed (${response.status})`);
        }
        return payload.response;
    }
    async verifyCommunityAdmin(accessToken, vkId) {
        const communityId = String(Math.abs(Number.parseInt(vkId, 10)));
        if (!/^\d+$/.test(communityId) || communityId === '0')
            throw new Error('VK community ID is invalid');
        const users = await this.callApi('users.get', accessToken);
        const userId = Number(users?.[0]?.id);
        if (!userId)
            throw new Error('VK user identity could not be verified');
        const groups = await this.callApi('groups.get', accessToken, { filter: 'admin', count: '1000' });
        const adminGroupIds = Array.isArray(groups?.items) ? groups.items.map(String) : [];
        if (!adminGroupIds.includes(communityId)) {
            throw new Error('The authorized VK profile is not an administrator of this community');
        }
        return { userId, communityId };
    }
}
exports.VkOAuthService = VkOAuthService;
exports.default = new VkOAuthService();
