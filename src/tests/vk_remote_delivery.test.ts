import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deliverVkViaRemoteAdapter,
    extractNormalizedVkAccountId,
    isVkRemoteDeliveryReady,
    resolveVkRemoteDeliveryConfig,
} from '../services/vk_remote_delivery.client';

const VALID_ENV = {
    VK_DELIVERY_ENDPOINT: 'https://p4.xn--80acbgye4ag1ak4a.xn--p1ai/deliver',
    VK_DELIVERY_BEARER_TOKEN: 'test-secret-token-never-leak-123456',
    VK_DELIVERY_INSTALLATION_ID: 'analystcraft-vk-delivery-01',
    VK_DELIVERY_PROJECT_ID: '10',
    VK_DELIVERY_ACCOUNT_ID: '-240051152',
};

const ANALYSTCRAFT_CHANNEL = {
    id: 117,
    config: { vk_id: '-240051152' },
};

test('resolveVkRemoteDeliveryConfig fails closed on missing or unsafe config', () => {
    assert.equal(resolveVkRemoteDeliveryConfig({}), null);
    assert.equal(resolveVkRemoteDeliveryConfig({ ...VALID_ENV, VK_DELIVERY_ENDPOINT: 'http://insecure.example/deliver' }), null);
    assert.equal(resolveVkRemoteDeliveryConfig({ ...VALID_ENV, VK_DELIVERY_BEARER_TOKEN: '' }), null);
    assert.equal(resolveVkRemoteDeliveryConfig({ ...VALID_ENV, VK_DELIVERY_ACCOUNT_ID: '117' }), null);
    assert.equal(resolveVkRemoteDeliveryConfig({ ...VALID_ENV, VK_DELIVERY_PROJECT_ID: '0' }), null);

    const resolved = resolveVkRemoteDeliveryConfig(VALID_ENV);
    assert.deepEqual(resolved, {
        endpoint: VALID_ENV.VK_DELIVERY_ENDPOINT,
        bearerToken: VALID_ENV.VK_DELIVERY_BEARER_TOKEN,
        installationId: 'analystcraft-vk-delivery-01',
        projectId: 10,
        accountId: '-240051152',
    });
});

test('isVkRemoteDeliveryReady enforces exact projectId and negative community vk_id scope', () => {
    assert.equal(extractNormalizedVkAccountId({ vk_id: '-240051152' }), '-240051152');
    assert.equal(extractNormalizedVkAccountId({ raw_account: { vk_id: -240051152 } }), '-240051152');
    assert.equal(extractNormalizedVkAccountId({ vk_id: '117' }), null);

    assert.equal(isVkRemoteDeliveryReady(10, ANALYSTCRAFT_CHANNEL.config, VALID_ENV), true);
    assert.equal(isVkRemoteDeliveryReady(99, ANALYSTCRAFT_CHANNEL.config, VALID_ENV), false);
    assert.equal(isVkRemoteDeliveryReady(10, { vk_id: '-999999' }, VALID_ENV), false);
    assert.equal(isVkRemoteDeliveryReady(10, { vk_id: '117' }, VALID_ENV), false);
    assert.equal(isVkRemoteDeliveryReady(10, ANALYSTCRAFT_CHANNEL.config, {}), false);
});

test('deliverVkViaRemoteAdapter sends canonical planner-delivery/1 packet and parses receipt', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody: Record<string, unknown> = {};

    const fakeFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedAuth = String((init?.headers as Record<string, string>)?.authorization || '');
        capturedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        const binding = capturedBody.binding as Record<string, unknown>;
        return new Response(JSON.stringify({
            state: 'custody_acknowledged',
            retryAllowed: false,
            receipt: {
                attemptId: binding.attemptId,
                generation: 1,
                packageDigest: binding.packageDigest,
                objectId: '-240051152_42',
                publicUrl: 'https://vk.com/wall-240051152_42',
                publishedAt: '2026-11-26T13:45:00.000Z',
            },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const result = await deliverVkViaRemoteAdapter({
        projectId: 10,
        taskId: 1201,
        channel: ANALYSTCRAFT_CHANNEL,
        text: '  Тестовый пост из Planner  ',
        imageUrl: 'https://cdn.example.com/card.png',
        idempotencyKey: 'task:10:1201:revision:3',
        revision: 3,
    }, { env: VALID_ENV, fetchImpl: fakeFetch, nowMs: () => 1795700000000 });

    assert.equal(capturedUrl, VALID_ENV.VK_DELIVERY_ENDPOINT);
    assert.equal(capturedAuth, `Bearer ${VALID_ENV.VK_DELIVERY_BEARER_TOKEN}`);
    assert.equal(capturedBody?.protocol, 'planner-delivery/1');
    assert.equal(capturedBody?.operation, 'deliver');
    const binding = capturedBody?.binding as Record<string, unknown>;
    assert.equal(binding.projectId, 10);
    assert.equal(binding.provider, 'vk');
    assert.equal(binding.accountId, '-240051152');
    assert.equal(binding.installationId, 'analystcraft-vk-delivery-01');
    assert.equal(binding.taskId, 1201);
    assert.equal(binding.revision, 3);
    assert.match(String(binding.packageDigest), /^[a-f0-9]{64}$/);
    const payload = capturedBody?.payload as Record<string, unknown>;
    assert.equal(payload.text, 'Тестовый пост из Planner');
    assert.equal(payload.imageUrl, 'https://cdn.example.com/card.png');

    assert.deepEqual(result, {
        adapter: 'vk',
        deliveryMethod: 'vk_remote_adapter',
        publishedLink: 'https://vk.com/wall-240051152_42',
        metrics: {
            vk_owner_id: '-240051152',
            vk_post_id: '42',
            vk_object_id: '-240051152_42',
            vk_installation_id: 'analystcraft-vk-delivery-01',
            vk_published_at: '2026-11-26T13:45:00.000Z',
        },
    });
});

test('deliverVkViaRemoteAdapter fails closed on 401/409/bad-receipt without leaking bearer token', async () => {
    const cases: Array<{ status: number; body: unknown; expected: RegExp }> = [
        { status: 401, body: { code: 'RPD_UNAUTHORIZED' }, expected: /VK_REMOTE_DELIVERY_UNAUTHORIZED/ },
        { status: 409, body: { state: 'blocked', code: 'RPD_LOGIN_REQUIRED' }, expected: /VK_REMOTE_DELIVERY_BLOCKED/ },
        { status: 200, body: { state: 'custody_acknowledged', receipt: { objectId: '-999_1', publicUrl: 'https://vk.com/wall-999_1' } }, expected: /VK_REMOTE_DELIVERY_RECEIPT_INVALID/ },
    ];

    for (const c of cases) {
        const fakeFetch: typeof fetch = async () => new Response(JSON.stringify(c.body), {
            status: c.status,
            headers: { 'content-type': 'application/json' },
        });
        await assert.rejects(
            deliverVkViaRemoteAdapter({
                projectId: 10,
                taskId: 1202,
                channel: ANALYSTCRAFT_CHANNEL,
                text: 'hello',
                idempotencyKey: 'k-1202',
            }, { env: VALID_ENV, fetchImpl: fakeFetch }),
            (err: unknown) => {
                assert(err instanceof Error);
                assert.match(err.message, c.expected);
                assert.equal(err.message.includes(VALID_ENV.VK_DELIVERY_BEARER_TOKEN), false);
                return true;
            }
        );
    }
});
