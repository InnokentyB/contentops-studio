import test from 'node:test';
import assert from 'node:assert/strict';
import publicationPlanService from '../services/publication_plan.service';

test('preloadPlanUrlContents gathers and fetches remote URLs from assets and actions', async () => {
    // 1. Create a mock publication plan
    const mockPlan: any = {
        meta: {
            plan_id: 'test-plan-1'
        },
        assets: {
            asset1: {
                url: 'https://raw.githubusercontent.com/test/readme.md'
            }
        },
        actions: [
            {
                id: 'action-1',
                content_files: [
                    {
                        url: 'https://raw.githubusercontent.com/test/post.md'
                    }
                ]
            }
        ]
    };

    // 2. Mock global fetch
    const originalFetch = globalThis.fetch;
    const fetchedUrls: string[] = [];

    globalThis.fetch = async (url: any) => {
        fetchedUrls.push(url.toString());
        if (url.toString().includes('readme.md')) {
            return {
                ok: true,
                text: async () => 'Readme Content'
            } as any;
        }
        if (url.toString().includes('post.md')) {
            return {
                ok: true,
                text: async () => 'Post Content'
            } as any;
        }
        return { ok: false, statusText: 'Not Found' } as any;
    };

    try {
        // Run preloader
        await (publicationPlanService as any).preloadPlanUrlContents(mockPlan);

        // Verify URLs were fetched
        assert.ok(fetchedUrls.includes('https://raw.githubusercontent.com/test/readme.md'));
        assert.ok(fetchedUrls.includes('https://raw.githubusercontent.com/test/post.md'));

        // Verify fetched contents map
        assert.equal(mockPlan._fetched_url_contents['https://raw.githubusercontent.com/test/readme.md'], 'Readme Content');
        assert.equal(mockPlan._fetched_url_contents['https://raw.githubusercontent.com/test/post.md'], 'Post Content');

        // Verify buildAssetSnapshots resolves the preloaded content
        const snapshots = publicationPlanService.buildAssetSnapshots(mockPlan);
        assert.equal(snapshots.asset1?.content, 'Readme Content');
        assert.equal(snapshots.asset1?.url, 'https://raw.githubusercontent.com/test/readme.md');

        // Verify resolveContentFileDescriptor resolves the preloaded content
        const descriptor = (publicationPlanService as any).resolveContentFileDescriptor(mockPlan, mockPlan.actions[0].content_files[0]);
        assert.equal(descriptor.directInlineContent, 'Post Content');
        assert.equal(descriptor.resolvedUrl, 'https://raw.githubusercontent.com/test/post.md');

    } finally {
        globalThis.fetch = originalFetch;
    }
});
