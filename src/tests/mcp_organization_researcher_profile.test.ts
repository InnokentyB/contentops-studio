import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { isManagedMcpProfile } from '../services/mcp_access_token.service';

const INTELLIGENCE_TOOLS = [
    'ba_get_organization_intelligence_context',
    'ba_search_organization_intelligence',
    'ba_get_organization_research_run',
    'ba_route_organization_signal',
    'ba_promote_project_signal'
];

test('organization researcher is managed and discovers the bounded intelligence surface', () => {
    assert.equal(isManagedMcpProfile('organization_researcher'), true);
    for (const tool of INTELLIGENCE_TOOLS) {
        assert.equal(isToolAllowedForProfile('organization_researcher', tool), true, `${tool} should be available`);
    }
});

test('organization researcher cannot modify content or use publication transports', () => {
    for (const tool of [
        'ba_update_publication_content',
        'ba_publish_publication_task',
        'ba_publish_telegram_task',
        'ba_dzen_comment',
        'ba_create_project',
        'ba_upsert_initiative'
    ]) {
        assert.equal(isToolAllowedForProfile('organization_researcher', tool), false, `${tool} must be denied`);
    }
});

test('adding organization researcher does not widen existing profiles', () => {
    assert.equal(isToolAllowedForProfile('writer', 'ba_search_organization_intelligence'), false);
    assert.equal(isToolAllowedForProfile('planner', 'ba_route_organization_signal'), false);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_get_organization_intelligence_context'), false);
    assert.equal(isToolAllowedForProfile('owner', 'ba_search_organization_intelligence'), true);
});
