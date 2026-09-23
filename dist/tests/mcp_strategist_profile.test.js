"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const capabilities_1 = require("../mcp/capabilities");
const mcp_access_token_service_1 = require("../services/mcp_access_token.service");
(0, node_test_1.default)('strategist is a managed profile that can be issued as an access token', () => {
    strict_1.default.equal((0, mcp_access_token_service_1.isManagedMcpProfile)('strategist'), true);
});
(0, node_test_1.default)('strategist cannot publish and cannot spend the deployment owner provider key', () => {
    // ba_publish_publication_task reaches a live channel.
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', 'ba_publish_publication_task'), false);
    // ba_generate_week_topic_preview falls back to process.env.OPENAI_API_KEY
    // when the project has no ProviderKey of its own.
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', 'ba_generate_week_topic_preview'), false);
    // Direct publication and cross-tenant administration were never in the planner set.
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', 'ba_publish_direct'), false);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', 'ba_list_users'), false);
});
(0, node_test_1.default)('strategist keeps the read and planning surface it needs', () => {
    for (const tool of [
        'ba_get_agent_workspace_manifest',
        'ba_get_agent_chat_bootstrap',
        'ba_list_project_channels',
        'ba_list_publication_tasks',
        'ba_list_initiatives',
        'ba_upsert_initiative',
        'ba_link_initiatives',
        'ba_upsert_week_theme',
        'ba_start_week_autogeneration',
        'ba_reschedule_work_item',
        'ba_audit_plan_coverage',
        'ba_get_operational_calendar'
    ]) {
        strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', tool), true, `${tool} should stay available`);
    }
});
(0, node_test_1.default)('adding strategist does not widen the existing profiles', () => {
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_publish_publication_task'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_generate_week_topic_preview'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('writer', 'ba_upsert_initiative'), false);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('art_director', 'ba_upsert_week_theme'), false);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('owner', 'ba_publish_direct'), true);
});
