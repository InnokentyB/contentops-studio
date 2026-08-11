"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const vk_service_1 = __importStar(require("../services/vk.service"));
(0, node_test_1.default)('VK owner ID is normalized to a negative community ID', () => {
    strict_1.default.equal((0, vk_service_1.normalizeVkOwnerId)('123456'), '-123456');
    strict_1.default.equal((0, vk_service_1.normalizeVkOwnerId)('-123456'), '-123456');
    strict_1.default.throws(() => (0, vk_service_1.normalizeVkOwnerId)('not-an-id'), /Invalid VK community ID/);
});
(0, node_test_1.default)('VK permalink is parsed into stable owner and post IDs', () => {
    strict_1.default.deepEqual((0, vk_service_1.parseVkPostIdentity)('https://vk.com/wall-123456_789'), {
        ownerId: '-123456',
        postId: '789'
    });
    strict_1.default.equal((0, vk_service_1.parseVkPostIdentity)('https://vk.com/feed'), null);
});
(0, node_test_1.default)('VK post IDs are split into API batches of at most 30', () => {
    const ids = Array.from({ length: 65 }, (_, index) => String(index + 1));
    strict_1.default.deepEqual((0, vk_service_1.chunkVkPostIds)(ids).map((batch) => batch.length), [30, 30, 5]);
});
(0, node_test_1.default)('VK batch collection sends post reach requests in groups of 30', async (t) => {
    const reachBatchSizes = [];
    t.mock.method(globalThis, 'fetch', async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/wall.getById')) {
            const postId = url.searchParams.get('posts')?.split('_').pop() || '0';
            return new Response(JSON.stringify({
                response: [{ id: Number(postId), owner_id: -10, views: { count: Number(postId) } }]
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const postIds = (url.searchParams.get('post_ids') || '').split(',').filter(Boolean);
        reachBatchSizes.push(postIds.length);
        return new Response(JSON.stringify({
            response: postIds.map((postId) => ({ post_id: Number(postId), reach_total: Number(postId) * 10 }))
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const ids = Array.from({ length: 65 }, (_, index) => String(index + 1));
    const results = await vk_service_1.default.collectPostsMetrics('-10', 'publish-token', ids, 'stats-token');
    strict_1.default.deepEqual(reachBatchSizes, [30, 30, 5]);
    strict_1.default.equal(results.length, 65);
    strict_1.default.equal(results[64].metrics.reachTotal, 650);
});
(0, node_test_1.default)('VK full metric collection merges public and post reach metrics', async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.pathname.endsWith('/wall.getById')) {
            return new Response(JSON.stringify({
                response: [{
                        id: 789,
                        owner_id: -123456,
                        date: 1786406400,
                        text: 'VK post',
                        views: { count: 1200 },
                        likes: { count: 80 },
                        comments: { count: 12 },
                        reposts: { count: 9 }
                    }]
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
            response: [{
                    post_id: 789,
                    reach_total: 900,
                    reach_subscribers: 600,
                    reach_viral: 250,
                    reach_ads: 50,
                    links: 40,
                    to_group: 15,
                    join_group: 4,
                    hide: 2,
                    report: 1,
                    unsubscribe: 3
                }]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await vk_service_1.default.collectPostMetrics('-123456', 'publish-token', '789', 'stats-token');
    strict_1.default.equal(requests.length, 2);
    strict_1.default.equal(requests[0].searchParams.get('access_token'), 'publish-token');
    strict_1.default.equal(requests[1].searchParams.get('access_token'), 'stats-token');
    strict_1.default.equal(result.wallStatus, 'collected');
    strict_1.default.equal(result.reachStatus, 'collected');
    strict_1.default.equal(result.metrics.views, 1200);
    strict_1.default.equal(result.metrics.reachTotal, 900);
    strict_1.default.equal(result.metrics.linkClicks, 40);
    strict_1.default.equal(result.metrics.unsubscribes, 3);
});
(0, node_test_1.default)('VK reach failure preserves public metrics and unknown values stay null', async (t) => {
    t.mock.method(globalThis, 'fetch', async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/wall.getById')) {
            return new Response(JSON.stringify({
                response: [{
                        id: 5,
                        owner_id: -10,
                        views: { count: 100 },
                        likes: { count: 8 },
                        comments: { count: 2 },
                        reposts: { count: 1 }
                    }]
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
            error: { error_code: 15, error_msg: 'Access denied' }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await vk_service_1.default.collectPostMetrics('-10', 'publish-token', '5', 'forbidden-token');
    strict_1.default.equal(result.wallStatus, 'collected');
    strict_1.default.equal(result.reachStatus, 'forbidden');
    strict_1.default.equal(result.metrics.views, 100);
    strict_1.default.equal(result.metrics.reachTotal, null);
    strict_1.default.equal(result.providerErrorCode, '15');
});
(0, node_test_1.default)('VK weekly delta returns null for missing boundaries and preserves negative adjustments', () => {
    strict_1.default.equal((0, vk_service_1.calculateVkMetricDelta)(null, 20), null);
    strict_1.default.equal((0, vk_service_1.calculateVkMetricDelta)(10, null), null);
    strict_1.default.equal((0, vk_service_1.calculateVkMetricDelta)(100, 80), -20);
    strict_1.default.equal((0, vk_service_1.calculateVkMetricDelta)(100, 145), 45);
});
