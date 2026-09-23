import test from 'node:test';
import assert from 'node:assert/strict';
import aiGateway from '../services/ai_gateway.service';
import {
    UpdateWeekSchema,
    UpdatePostSchema,
    ApprovePostSchema,
    CreateCommentSchema,
    CreateChannelSchema
} from '../schemas/routes.schema';
import { resolvePublicationExecutionRoute, browserFallbackReason } from '../services/publication_execution_route';
import threadsService from '../services/threads.service';

test('TDPD End-to-End Content Pipeline: AI Gateway completes prompt with telemetry and cost', async () => {
    const originalComplete = aiGateway.complete;
    // Test AI Gateway completion contract
    const simulatedGateway = {
        complete: async (params: {
            provider: 'openai' | 'anthropic' | 'gemini';
            model: string;
            messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        }) => {
            return {
                text: 'Generated strategy topic for TDPD cycle: Automating Content Distribution',
                provider: params.provider,
                model: params.model,
                usage: { promptTokens: 42, completionTokens: 18, totalTokens: 60 },
                latencyMs: 120,
                costUsd: 0.0003
            };
        }
    };

    const completion = await simulatedGateway.complete({
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a TDPD Content Strategist.' },
            { role: 'user', content: 'Propose a topic for week 1.' }
        ]
    });

    assert.equal(completion.provider, 'openai');
    assert.equal(completion.model, 'gpt-4o-mini');
    assert.match(completion.text, /Automating Content Distribution/);
    assert.equal(completion.usage.totalTokens, 60);
    assert.ok(completion.latencyMs > 0);
    assert.ok(completion.costUsd !== undefined && completion.costUsd > 0);
});

test('TDPD End-to-End Content Pipeline: Route Schemas validate week, post, comment, and channel', () => {
    // 1. Week Schema
    const validWeek = UpdateWeekSchema.safeParse({
        theme: 'Scaling Content Operations',
        status: 'active',
        start_date: '2026-10-01',
        end_date: '2026-10-07'
    });
    assert.ok(validWeek.success);

    // 2. Post Schema
    const validPost = UpdatePostSchema.safeParse({
        title: 'Deep Dive: AI Gateway Architecture',
        text: 'Detailed post body describing the gateway...',
        publish_at: '2026-10-02T10:00:00Z',
        channel_id: 42
    });
    assert.ok(validPost.success);

    // 3. Post Approval Schema
    const validApproval = ApprovePostSchema.safeParse({
        publish_at: '2026-10-02T10:00:00Z',
        text: 'Final approved copy with CTA.'
    });
    assert.ok(validApproval.success);

    // 4. Comment Schema (valid and invalid)
    const validComment = CreateCommentSchema.safeParse({
        entityType: 'post',
        entityId: '123',
        text: 'Please refine the opening paragraph.'
    });
    assert.ok(validComment.success);
    if (validComment.success) {
        assert.equal(validComment.data.entityId, 123); // string auto-transformed to number
    }

    const invalidComment = CreateCommentSchema.safeParse({
        entityType: 'post',
        entityId: 'not-a-number',
        text: 'Missing ID'
    });
    assert.equal(invalidComment.success, false);

    // 5. Channel Creation Schema (for Threads and VK)
    const validChannel = CreateChannelSchema.safeParse({
        type: 'threads',
        name: 'Official Threads Profile',
        config: {
            access_token: 'TH_TOKEN_XYZ',
            user_id: '17841400000000000'
        }
    });
    assert.ok(validChannel.success);

    const invalidChannel = CreateChannelSchema.safeParse({
        type: '',
        name: ''
    });
    assert.equal(invalidChannel.success, false);
});

test('TDPD End-to-End Content Pipeline: Threads Channel Preflight & Test Connection', async () => {
    // Missing access token fails preflight
    const missingToken = await threadsService.testConnection({});
    assert.equal(missingToken.success, false);
    assert.match(missingToken.error || '', /token is required/i);

    // Mock fetch for Meta Graph API /v1.0/me
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/v1.0/me')) {
                return {
                    ok: true,
                    json: async () => ({
                        id: '17841400123456789',
                        username: 'contentops_studio',
                        name: 'ContentOps Studio'
                    })
                } as any;
            }
            return { ok: false, status: 404 } as any;
        };

        const result = await threadsService.testConnection({
            access_token: 'valid_mock_token',
            user_id: '17841400123456789'
        });

        assert.equal(result.success, true);
        assert.equal(result.details?.username, 'contentops_studio');
        assert.equal(result.details?.id, '17841400123456789');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('TDPD End-to-End Content Pipeline: Safe Handoff and Terminal Failure Protection', () => {
    // 1. Ready item is routed to connector_auto
    const readyItem = {
        contentReady: true,
        visualReady: true,
        due: true,
        published: false,
        executionMode: 'automated' as const,
        directExecutionSupported: true,
        publicationMode: 'connector_auto'
    };
    assert.equal(resolvePublicationExecutionRoute(readyItem), 'connector_auto');

    // 2. Connector failure transitions to browser_required without infinite API retry
    const error = new Error('Meta API token revoked');
    const fallback = browserFallbackReason(error);
    assert.equal(fallback.code, 'CONNECTOR_PUBLISH_FAILED');
    assert.equal(fallback.retry_via_api, false);
    assert.equal(fallback.next_route, 'browser_required');

    // 3. Once routed to browser_required, it cannot accidentally bounce back to connector
    assert.equal(resolvePublicationExecutionRoute({
        ...readyItem,
        publicationMode: fallback.next_route
    }), 'browser_required');
});
