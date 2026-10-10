import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import vkSearchService from '../../services/vk_search.service';
import { vkSearchInput } from '../../services/vk_search/contracts';
import { asToolResult } from './common';

/** Expose authorized read-only VK discovery independently of publishing and engagement mutations. */
export function registerVkSearchTools(server: McpServer): void {
    server.registerTool('ba_vk_search_relevant_posts', {
        description: 'Read-only public VK keyword discovery across product routes, with freshness, exact post IDs/URLs, authors, excerpts, counters and per-query provenance. Requires an active project VK channel with search_access_token (user/service VK API) or legacy user_access_token (VK API token). Always evidence_limited for Radar: feed, notifications and owned replies remain UNKNOWN. No publishing, comments or external writes.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        inputSchema: vkSearchInput
    }, async args => asToolResult(await vkSearchService.searchRelevantPosts(args)));
}
