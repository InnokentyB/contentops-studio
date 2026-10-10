export type McpCapabilityProfile = 'owner' | 'strategist' | 'planner' | 'writer' | 'editor' | 'art_director' | 'publisher' | 'growth_analyst' | 'organization_researcher';

const ORGANIZATION_RESEARCHER_TOOLS = new Set([
    'ba_get_organization_intelligence_context',
    'ba_search_organization_intelligence',
    'ba_get_organization_research_run',
    'ba_route_organization_signal',
    'ba_promote_project_signal'
]);

const WRITER_TOOLS = new Set([
    'ba_get_agent_workspace_manifest',
    'ba_get_agent_workspace_updates',
    'ba_get_agent_chat_bootstrap',
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_get_publication_fact',
    'ba_list_publication_plan_assets',
    'ba_read_publication_plan_asset',
    'ba_read_publication_plan_ref',
    'ba_update_publication_content',
    'ba_configure_vk_story_poll',
    'ba_list_image_assets',
    'ba_list_work_items',
    'ba_claim_work_item',
    'ba_get_work_item_context',
    'ba_complete_work_item',
    'ba_block_work_item',
    'ba_release_work_item',
    'ba_get_week_pipeline',
    'ba_get_week_autogeneration'
]);

const PLANNER_TOOLS = new Set([
    'ba_get_agent_workspace_manifest',
    'ba_get_agent_workspace_updates',
    'ba_get_agent_chat_bootstrap',
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_get_publication_fact',
    'ba_dzen_collect_post_metrics',
    'ba_dzen_search_relevant_posts',
    'ba_vk_search_relevant_posts',
    'ba_dzen_get_radar_coverage',
    'ba_dzen_read_inbound',
    'ba_dzen_read_thread',
    'ba_dzen_read_post',
    'ba_dzen_find_replies',
    'ba_dzen_comment',
    'ba_threads_search_posts',
    'ba_threads_get_replies',
    'ba_threads_comment',
    'ba_list_metric_checkpoints',
    'ba_get_week_execution_summary',
    'ba_list_work_items',
    'ba_get_work_item',
    'ba_get_work_item_context',
    'ba_list_schedule_exceptions',
    'ba_reschedule_work_item',
    'ba_repair_publication_placement',
    'ba_repair_telegram_task1099_story_placement',
    'ba_require_c20_publication_visuals',
    'ba_require_task971_publication_visual',
    'ba_require_task972_publication_visual',
    'ba_require_task973_publication_visual',
    'ba_repair_task972_publication_metadata',
    'ba_bind_task960_linkedin_identity',
    'ba_create_task970_t72_checkpoint',
    'ba_upsert_initiative',
    'ba_link_initiatives',
    'ba_confirm_initiative_dependencies',
    'ba_import_operational_plan',
    'ba_materialize_publication_task',
    'ba_publish_publication_task',
    'ba_get_initiative',
    'ba_list_initiatives',
    'ba_audit_plan_coverage',
    'ba_get_release_readiness',
    'ba_list_release_blockers',
    'ba_get_operational_calendar',
    'ba_upsert_week_theme',
    'ba_start_week_autogeneration',
    'ba_generate_week_topic_preview',
    'ba_decide_week_plan',
    'ba_get_week_pipeline',
    'ba_get_week_autogeneration'
]);

const ART_DIRECTOR_TOOLS = new Set([
    'ba_get_agent_workspace_manifest',
    'ba_get_agent_workspace_updates',
    'ba_get_agent_chat_bootstrap',
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_list_work_items',
    'ba_claim_work_item',
    'ba_block_work_item',
    'ba_release_work_item',
    'ba_get_art_direction_context',
    'ba_submit_art_direction_decision',
    'ba_get_visual_readiness',
    'ba_attach_visual_source',
    'ba_generate_image_asset',
    'ba_review_image_asset',
    'ba_list_image_assets',
    'ba_get_week_pipeline',
    'ba_get_week_autogeneration'
]);

const EDITOR_TOOLS = new Set([
    'ba_recover_oct08_content_review',
    'ba_get_agent_workspace_manifest',
    'ba_get_agent_workspace_updates',
    'ba_get_agent_chat_bootstrap',
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_get_publication_fact',
    'ba_list_publication_plan_assets',
    'ba_read_publication_plan_asset',
    'ba_read_publication_plan_ref',
    'ba_list_work_items',
    'ba_get_work_item_context',
    'ba_claim_content_review',
    'ba_submit_content_review',
    'ba_decide_approval',
    'ba_get_week_pipeline',
    'ba_get_week_autogeneration'
]);

const PUBLISHER_TOOLS = new Set([
    'ba_get_agent_workspace_manifest',
    'ba_get_agent_workspace_updates',
    'ba_get_agent_chat_bootstrap',
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_get_publication_fact',
    'ba_list_publication_plan_assets',
    'ba_read_publication_plan_asset',
    'ba_read_publication_plan_ref',
    'ba_list_image_assets',
    'ba_get_visual_readiness',
    'ba_get_release_readiness',
    'ba_list_release_blockers',
    'ba_prepare_publication_task',
    'ba_release_approved_vk_browser_task',
    'ba_claim_linkedin_browser_publication',
    'ba_release_linkedin_task1076_browser',
    'ba_release_linkedin_task1077_browser',
    'ba_release_linkedin_task1090_browser',
    'ba_release_dzen_task1036',
    'ba_verify_dzen_task1036_connector',
    'ba_release_approved_threads_task1035',
    'ba_release_approved_threads_task1040',
    'ba_release_x_task1033_browser',
    'ba_release_x_task1042_browser',
    'ba_prepare_x_task1042_text_only_package',
    'ba_claim_x_task1042_browser_publication',
    'ba_release_linkedin_task1072_personal_browser',
    'ba_claim_linkedin_task1072_browser_publication',
    'ba_release_threads_task1043_api',
    'ba_publish_threads_task1043',
    'ba_release_threads_task1046_api',
    'ba_publish_threads_task1046',
    'ba_repair_telegram_task1099_story_placement',
    'ba_release_telegram_task1099_personal_story',
    'ba_publish_telegram_task1099_personal_story',
    'ba_release_setka_task1047_browser',
    'ba_claim_setka_task1047_browser_publication',
    'ba_start_setka_task1047_browser_submission',
    'ba_confirm_setka_task1047_browser_submission',
    'ba_mark_setka_task1047_browser_submission_uncertain',
    'ba_release_dzen_task1045',
    'ba_verify_dzen_task1045_connector',
    'ba_reconcile_dzen_task1045_uncertain_attempt',
    'ba_preview_vk_task1048_api_promotion',
    'ba_apply_vk_task1048_api_promotion',
    'ba_hold_vk_task1084',
    'ba_restore_vk_task1084_from_erroneous_retirement',
    'ba_claim_x_browser_publication',
    'ba_claim_vk_browser_publication',
    'ba_start_vk_browser_submission',
    'ba_confirm_vk_browser_submission',
    'ba_mark_vk_browser_submission_uncertain',
    'ba_preview_vk_browser_pre_provider_recovery',
    'ba_apply_vk_browser_pre_provider_recovery',
    'ba_preview_vk_browser_pre_submit_recovery',
    'ba_apply_vk_browser_pre_submit_recovery',
    'ba_publish_publication_task',
    'ba_publish_threads_task',
    'ba_threads_search_posts',
    'ba_threads_get_replies',
    'ba_threads_comment',
    'ba_release_approved_telegram_task',
    'ba_release_approved_dzen_task958',
    'ba_release_approved_dzen_task962',
    'ba_release_approved_threads_task953',
    'ba_release_approved_threads_task959',
    'ba_release_approved_threads_task966',
    'ba_release_approved_threads_task1029',
    'ba_reschedule_owner_released_task969',
    'ba_correct_owner_released_task_schedule',
    'ba_verify_dzen_task958_connector',
    'ba_verify_dzen_task962_connector',
    'ba_verify_dzen_task992_connector',
    'ba_verify_dzen_task1031_connector',
    'ba_verify_dzen_task999_connector',
    'ba_resume_dzen_task999_existing_draft',
    'ba_confirm_dzen_task992_absent_and_authorize_retry',
    'ba_register_linkedin_task995_unconfirmed_attempt',
    'ba_reconcile_linkedin_task995_attempt',
    'ba_repair_linkedin_task995_browser_routing',
    'ba_execute_delivery',
    'ba_confirm_publication',
    'ba_record_publication_fact',
    'ba_list_browser_publication_tasks',
    'ba_get_week_execution_summary'
]);

const GROWTH_ANALYST_TOOLS = new Set([
    'ba_get_agent_workspace_manifest',
    'ba_get_agent_workspace_updates',
    'ba_get_agent_chat_bootstrap',
    'ba_list_project_channels',
    'ba_list_publication_tasks',
    'ba_get_publication_task',
    'ba_get_publication_task_resources',
    'ba_get_publication_fact',
    'ba_list_metric_checkpoints',
    'ba_create_task970_t72_checkpoint',
    'ba_get_content_metrics',
    'ba_record_metric_snapshot',
    'ba_rollup_campaign_metrics',
    'ba_get_week_execution_summary',
    'ba_get_initiative',
    'ba_list_initiatives'
]);

// Pilot/self-serve profile. Same read and planning surface as `planner`, minus the two
// tools that either reach a live channel or spend the deployment owner's provider key:
//   - ba_publish_publication_task      publishes to a connected channel
//   - ba_generate_week_topic_preview   falls back to process.env.OPENAI_API_KEY when the
//                                      project has no ProviderKey of its own
// Everything a strategist agent needs to read state, plan initiatives and lay out a week
// stays available. The agent does the generating on its own side.
const STRATEGIST_EXCLUDED = new Set([
    'ba_publish_publication_task',
    'ba_generate_week_topic_preview',
    'ba_dzen_comment',
    'ba_threads_comment',
    'ba_confirm_initiative_dependencies',
    'ba_require_c20_publication_visuals',
    'ba_require_task971_publication_visual',
    'ba_require_task972_publication_visual',
    'ba_require_task973_publication_visual',
    'ba_repair_task972_publication_metadata',
    'ba_repair_telegram_task1099_story_placement',
    'ba_bind_task960_linkedin_identity',
    'ba_create_task970_t72_checkpoint'
]);

const STRATEGIST_TOOLS = new Set(
    [...PLANNER_TOOLS].filter(toolName => !STRATEGIST_EXCLUDED.has(toolName))
);

export function isToolAllowedForProfile(profile: McpCapabilityProfile, toolName: string) {
    if (profile === 'owner') return true;
    if (profile === 'writer') return WRITER_TOOLS.has(toolName);
    if (profile === 'editor') return EDITOR_TOOLS.has(toolName);
    if (profile === 'art_director') return ART_DIRECTOR_TOOLS.has(toolName);
    if (profile === 'publisher') return PUBLISHER_TOOLS.has(toolName);
    if (profile === 'growth_analyst') return GROWTH_ANALYST_TOOLS.has(toolName);
    if (profile === 'strategist') return STRATEGIST_TOOLS.has(toolName);
    if (profile === 'organization_researcher') return ORGANIZATION_RESEARCHER_TOOLS.has(toolName);
    return PLANNER_TOOLS.has(toolName);
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
