export type McpCapabilityProfile = 'owner' | 'planner' | 'writer';

const WRITER_TOOLS = new Set([
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_get_publication_fact',
    'ba_list_publication_plan_assets',
    'ba_read_publication_plan_asset',
    'ba_read_publication_plan_ref',
    'ba_update_publication_content',
    'ba_list_image_assets',
    'ba_list_work_items',
    'ba_claim_work_item',
    'ba_get_work_item_context',
    'ba_complete_work_item',
    'ba_block_work_item',
    'ba_release_work_item'
]);

const PLANNER_TOOLS = new Set([
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_get_publication_fact',
    'ba_list_metric_checkpoints',
    'ba_get_week_execution_summary',
    'ba_list_work_items',
    'ba_get_work_item',
    'ba_get_work_item_context',
    'ba_list_schedule_exceptions',
    'ba_reschedule_work_item',
    'ba_upsert_initiative',
    'ba_link_initiatives',
    'ba_import_operational_plan',
    'ba_materialize_publication_task',
    'ba_get_initiative',
    'ba_list_initiatives',
    'ba_audit_plan_coverage',
    'ba_get_release_readiness',
    'ba_list_release_blockers',
    'ba_get_operational_calendar',
    'ba_upsert_week_theme',
    'ba_generate_week_topic_preview',
    'ba_decide_week_plan',
    'ba_get_week_pipeline'
]);

export function isToolAllowedForProfile(profile: McpCapabilityProfile, toolName: string) {
    if (profile === 'owner') return true;
    return (profile === 'writer' ? WRITER_TOOLS : PLANNER_TOOLS).has(toolName);
}

export function filterMcpServerTools(server: any, profile: McpCapabilityProfile) {
    if (profile === 'owner') return server;

    const registeredTools = server?._registeredTools || {};
    for (const toolName of Object.keys(registeredTools)) {
        if (!isToolAllowedForProfile(profile, toolName)) {
            delete registeredTools[toolName];
        }
    }
    return server;
}
