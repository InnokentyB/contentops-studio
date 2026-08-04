"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const publication_plan_service_1 = __importDefault(require("../services/publication_plan.service"));
(0, node_test_1.default)('preloadPlanUrlContents gathers and fetches remote URLs from assets and actions', async () => {
    // 1. Create a mock publication plan
    const mockPlan = {
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
    const fetchedUrls = [];
    globalThis.fetch = async (url) => {
        fetchedUrls.push(url.toString());
        if (url.toString().includes('readme.md')) {
            return {
                ok: true,
                text: async () => 'Readme Content'
            };
        }
        if (url.toString().includes('post.md')) {
            return {
                ok: true,
                text: async () => 'Post Content'
            };
        }
        return { ok: false, statusText: 'Not Found' };
    };
    try {
        // Run preloader
        await publication_plan_service_1.default.preloadPlanUrlContents(mockPlan);
        // Verify URLs were fetched
        strict_1.default.ok(fetchedUrls.includes('https://raw.githubusercontent.com/test/readme.md'));
        strict_1.default.ok(fetchedUrls.includes('https://raw.githubusercontent.com/test/post.md'));
        // Verify fetched contents map
        strict_1.default.equal(mockPlan._fetched_url_contents['https://raw.githubusercontent.com/test/readme.md'], 'Readme Content');
        strict_1.default.equal(mockPlan._fetched_url_contents['https://raw.githubusercontent.com/test/post.md'], 'Post Content');
        // Verify buildAssetSnapshots resolves the preloaded content
        const snapshots = publication_plan_service_1.default.buildAssetSnapshots(mockPlan);
        strict_1.default.equal(snapshots.asset1?.content, 'Readme Content');
        strict_1.default.equal(snapshots.asset1?.url, 'https://raw.githubusercontent.com/test/readme.md');
        // Verify resolveContentFileDescriptor resolves the preloaded content
        const descriptor = publication_plan_service_1.default.resolveContentFileDescriptor(mockPlan, mockPlan.actions[0].content_files[0]);
        strict_1.default.equal(descriptor.directInlineContent, 'Post Content');
        strict_1.default.equal(descriptor.resolvedUrl, 'https://raw.githubusercontent.com/test/post.md');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
