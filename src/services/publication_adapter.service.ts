type PublicationAction = {
    id: string;
    channel: string;
    action_type: string;
    human_review?: boolean;
    parameters?: Record<string, any>;
    verification?: any[];
    post_actions?: any[];
    scheduled_time_window?: {
        start?: string;
        end?: string;
        timezone?: string;
    } | null;
};

type PublicationAccount = Record<string, any>;

class PublicationAdapterService {
    supportsDirectExecution(account: PublicationAccount) {
        if (account.platform === 'vk') {
            return Boolean(
                account.vk_id
                && (account.publish_access_token || account.api_key)
            );
        }
        if (['zen', 'zen_article', 'dzen'].includes(account.platform)) {
            return Boolean(account.cookies || account.cookies_encrypted);
        }
        return ['telegram', 'vk', 'linkedin', 'reddit', 'tilda', 'ok', 'odnoklassniki', 'habr', 'habr_article', 'vc', 'vc_article', 'threads'].includes(account.platform);
    }

    prefersAutomaticExecution(account: PublicationAccount) {
        const platform = String(account.platform || '').toLowerCase();
        if (!['zen', 'zen_article', 'dzen'].includes(platform) || !this.supportsDirectExecution(account)) {
            return false;
        }
        const workflowMode = String(account.workflow_mode || account.planner_generation_mode || 'standard').toLowerCase();
        if (['prepare_only', 'approval_required', 'manual', 'manual_handoff', 'browser_required'].includes(workflowMode)) {
            return false;
        }
        return true;
    }

    inferExecutionMode(account: PublicationAccount, action: PublicationAction): 'manual' | 'automated' {
        if (action.human_review) {
            return 'manual';
        }

        if (account.platform === 'tilda' && account.cms_api_enabled) {
            return 'automated';
        }

        if (account.platform === 'google_search_console') {
            return 'automated';
        }

        if (['reddit', 'telegram', 'vk', 'linkedin', 'ok', 'odnoklassniki', 'habr', 'habr_article', 'vc', 'vc_article', 'zen', 'zen_article', 'dzen', 'threads'].includes(account.platform)) {
            return action.human_review ? 'manual' : 'automated';
        }

        return 'manual';
    }

    buildAdapterConfig(accountRef: string, account: PublicationAccount, actionSamples: PublicationAction[] = []) {
        const executionModes = Array.from(new Set(actionSamples.map((action) => this.inferExecutionMode(account, action))));

        return {
            adapter_kind: 'publication_source',
            account_ref: accountRef,
            platform: account.platform,
            account_type: account.type || 'unknown',
            role: account.role || null,
            execution_modes: executionModes.length > 0 ? executionModes : ['manual'],
            allowed_content_types: account.allowed_content_types || [],
            forbidden_content_types: account.forbidden_content_types || [],
            usage_rule: account.usage_rule || null,
            capability_flags: {
                api_publish: account.cms_api_enabled === true
                    || this.supportsDirectExecution(account),
                manual_handoff: account.platform === 'linkedin' || account.platform === 'medium' || account.platform === 'indiehackers' || account.platform === 'reddit' || account.platform === 'threads',
                analytics_supported: account.platform === 'linkedin' || account.platform === 'reddit' || account.platform === 'google_search_console' || account.platform === 'threads',
                auto_canvas_generation: account.planner_generation_mode === 'auto_canvas'
            },
            workflow_mode: account.planner_generation_mode || 'standard',
            week_theme_source: account.week_theme_source || null,
            raw_account: account
        };
    }

    buildManualChecklist(action: PublicationAction, resolvedContext: {
        linkUrl?: string | null;
        accountRef?: string | null;
    }) {
        const checklist = [
            `Post from account: ${resolvedContext.accountRef || 'specified account in plan'}`,
            'Use the prepared body exactly as provided unless human review explicitly approves a change.',
            'Attach the prepared image/carousel bundle if the action requires visuals.',
            'After posting, record the public URL back into the task.'
        ];

        if (action.parameters?.link_location === 'first_comment_only' && resolvedContext.linkUrl) {
            checklist.push(`Publish the first comment with this URL: ${resolvedContext.linkUrl}`);
        }

        if (action.channel === 'medium' && resolvedContext.linkUrl) {
            checklist.push(`Set the canonical/original publication URL to: ${resolvedContext.linkUrl}`);
        }

        return checklist;
    }

    deriveMonitoringPlan(action: PublicationAction) {
        const postActions = action.post_actions || [];
        const verification = action.verification || [];

        return {
            needs_comment_monitoring: postActions.some((item: any) => item.type === 'start_comment_monitor'),
            needs_link_comment_verification: verification.some((item: any) => item.type === 'link_comment_present'),
            needs_live_check: verification.some((item: any) => item.type === 'post_live_check'),
            needs_analytics_collection: postActions.some((item: any) => String(item.type || '').includes('gsc') || String(item.type || '').includes('analytics'))
        };
    }
}

export default new PublicationAdapterService();
