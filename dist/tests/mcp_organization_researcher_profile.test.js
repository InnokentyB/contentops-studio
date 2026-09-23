"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const capabilities_1 = require("../mcp/capabilities");
const mcp_access_token_service_1 = require("../services/mcp_access_token.service");
const INTELLIGENCE_TOOLS = [
    'ba_get_organization_intelligence_context',
    'ba_search_organization_intelligence',
    'ba_get_organization_research_run',
    'ba_route_organization_signal',
    'ba_promote_project_signal'
];
(0, node_test_1.default)('organization researcher is managed and discovers the bounded intelligence surface', () => {
    strict_1.default.equal((0, mcp_access_token_service_1.isManagedMcpProfile)('organization_researcher'), true);
    for (const tool of INTELLIGENCE_TOOLS) {
        strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('organization_researcher', tool), true, `${tool} should be available`);
    }
});
(0, node_test_1.default)('organization researcher cannot modify content or use publication transports', () => {
    for (const tool of [
        'ba_update_publication_content',
        'ba_publish_publication_task',
        'ba_publish_telegram_task',
        'ba_dzen_comment',
        'ba_create_project',
        'ba_upsert_initiative'
    ]) {
        strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('organization_researcher', tool), false, `${tool} must be denied`);
    }
});
(0, node_test_1.default)('adding organization researcher does not widen existing profiles', () => {
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('writer', 'ba_search_organization_intelligence'), false);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_route_organization_signal'), false);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', 'ba_get_organization_intelligence_context'), false);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('owner', 'ba_search_organization_intelligence'), true);
});
