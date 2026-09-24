import prisma from '../../db';
import multiAgentService from '../../services/multi_agent.service';
import { channelContentLanguage } from '../../services/content_language.service';
import publicationPlanService from '../../services/publication_plan.service';
import contentDictionaryService from '../../services/content_dictionary.service';
import contentPolicyMatrixService from '../../services/content_policy_matrix.service';
import { isPublicationTaskActive } from '../../services/publication_task_activity';
import { derivePublicationContentState } from '../../services/publication_content_state';
import { derivePublicationGenerationStage } from '../../services/publication_generation_stage';
import { safeJsonParse } from './helpers';

export async function loadPublicationPlanContext(projectId: number) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: ['publication_plan_meta', 'publication_plan_assets', 'publication_plan_accounts', 'publication_plan_asset_snapshots', 'publication_plan_content_file_snapshots'] }
        }
    });

    const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
    const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
    const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;
    const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
    const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;

    if (!meta || !assets || !accounts) {
        return null;
    }

    return {
        meta: JSON.parse(meta),
        assets: JSON.parse(assets),
        accounts: JSON.parse(accounts),
        asset_snapshots: assetSnapshots ? JSON.parse(assetSnapshots) : {},
        content_file_snapshots: contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {},
        actions: [] as any[]
    };
}

export async function loadPublicationProjectContext(projectId: number) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: ['content_dictionary_yaml', 'content_policy_matrix_yaml', 'atoma_files_description', 'atoma_files_payload'] }
        }
    });

    return {
        glossaryYaml: settings.find((setting) => setting.key === 'content_dictionary_yaml')?.value || null,
        contentPolicyMatrixYaml: settings.find((setting) => setting.key === 'content_policy_matrix_yaml')?.value || null,
        atomaFilesDescription: settings.find((setting) => setting.key === 'atoma_files_description')?.value || null,
        atomaFilesPayload: safeJsonParse(settings.find((setting) => setting.key === 'atoma_files_payload')?.value || null)
    };
}

export function derivePublicationVoice(item: any) {
    return (
        item?.assets?.action?.voice_profile
        || item?.assets?.action?.parameters?.voice_profile
        || item?.channel?.config?.voice_profile
        || item?.metrics?.voice_profile
        || null
    );
}

export function resolveTaskScheduleAt(item: any) {
    const actionScheduleAt = item?.assets?.action?.scheduled_at;
    if (typeof actionScheduleAt === 'string' && actionScheduleAt.trim()) {
        return actionScheduleAt;
    }
    return item?.schedule_at?.toISOString?.() || item?.schedule_at || null;
}

export function buildPublicationTaskListItem(item: any) {
    const qualityReport = item.quality_report || {};
    const metrics = item.metrics || {};
    const publicationOutcome = item.publication_fact?.outcome
        || qualityReport.publication_outcome
        || metrics.publication_outcome
        || null;

    return {
        id: item.id,
        item_key: item.item_key || null,
        type: item.type,
        layer: item.layer,
        title: item.title,
        brief: item.brief,
        status: item.status,
        is_active: isPublicationTaskActive(item),
        publication_outcome: publicationOutcome,
        schedule_at: item?.schedule_at?.toISOString?.() || item?.schedule_at || null,
        published_link: item.published_link,
        content_state: derivePublicationContentState(item),
        content_revision: item.content_revision || 0,
        generation_stage: derivePublicationGenerationStage({
            status: item.status,
            draftText: item.draft_text,
            textState: item.text_state,
            visualState: item.visual_state,
            handoffState: item.handoff_state,
            publicationMode: item.publication_mode,
            workItems: item.work_items
        }),
        publication_mode: item.publication_mode || null,
        selected_asset: item.selected_asset ? {
            id: item.selected_asset.id,
            file_url: item.selected_asset.file_url || null,
            alt_text: item.selected_asset.alt_text || null,
            status: item.selected_asset.status || null
        } : null,
        week_package_id: item.week_package_id || null,
        publication_fact: item.publication_fact || null,
        metrics: {
            monitoring: metrics.monitoring || null,
            collected_metrics: metrics.collected_metrics || null,
            publication_outcome: metrics.publication_outcome || null,
            account_ref: metrics.account_ref || null,
            metrics_updated_at: metrics.metrics_updated_at || null
        },
        quality_report: {
            execution_mode: qualityReport.execution_mode || null,
            publication_outcome: qualityReport.publication_outcome || null,
            publication_route: qualityReport.publication_route || null,
            browser_handoff: qualityReport.browser_handoff || null
        },
        channel: item.channel ? {
            id: item.channel.id,
            name: item.channel.name,
            type: item.channel.type,
            config: item.channel.config || null
        } : null
    };
}

export function buildPublicationTaskDetailItem(item: any, options?: {
    handoffBundle?: any | null;
    projectContext?: {
        glossaryYaml: string | null;
        contentPolicyMatrixYaml: string | null;
        atomaFilesDescription: string | null;
        atomaFilesPayload: any | null;
    };
}) {
    const qualityReport = item.quality_report || {};
    const metrics = item.metrics || {};
    const assets = item.assets || {};
    const handoffBundle = options?.handoffBundle || qualityReport.handoff_bundle || null;
    const firstResourceWithUrl = (handoffBundle?.resource_files || []).find((entry: any) => entry?.url);
    const firstSourceContent = (handoffBundle?.resource_files || []).find((entry: any) => typeof entry?.content === 'string' && entry.content.trim());
    const derivedVoice = derivePublicationVoice(item);

    return {
        id: item.id,
        item_key: item.item_key || null,
        type: item.type,
        layer: item.layer,
        title: item.title,
        brief: item.brief,
        key_points: item.key_points || null,
        status: item.status,
        schedule_at: resolveTaskScheduleAt(item),
        published_link: item.published_link,
        draft_text: item.draft_text || null,
        content_state: derivePublicationContentState({ ...item, quality_report: { ...qualityReport, handoff_bundle: handoffBundle } }),
        content_revision: item.content_revision || 0,
        accepted_revision: item.accepted_revision || null,
        text_state: item.text_state || null,
        generation_stage: derivePublicationGenerationStage({
            status: item.status,
            draftText: item.draft_text,
            textState: item.text_state,
            visualState: item.visual_state,
            handoffState: item.handoff_state,
            publicationMode: item.publication_mode,
            workItems: item.work_items
        }),
        publication_mode: item.publication_mode || null,
        week_package_id: item.week_package_id || null,
        publication_fact: item.publication_fact || null,
        metric_checkpoints: Array.isArray(item.metric_snapshots) ? item.metric_snapshots : [],
        channel: item.channel ? {
            id: item.channel.id,
            name: item.channel.name,
            type: item.channel.type,
            config: item.channel.config || null
        } : null,
        assets: {
            action: assets.action || null,
            resolved_assets: assets.resolved_assets || [],
            generated_visuals: assets.generated_visuals || []
        },
        metrics: {
            monitoring: metrics.monitoring || null,
            collected_metrics: metrics.collected_metrics || null,
            publication_outcome: metrics.publication_outcome || null,
            account_ref: metrics.account_ref || null,
            task_id: metrics.task_id || null,
            metrics_updated_at: metrics.metrics_updated_at || null
        },
        quality_report: {
            execution_mode: qualityReport.execution_mode || null,
            publication_outcome: qualityReport.publication_outcome || null,
            manual_publication_note: qualityReport.manual_publication_note || null,
            critic_review: qualityReport.critic_review || null,
            generated_image: qualityReport.generated_image || null,
            content_edit_history: Array.isArray(qualityReport.content_edit_history) ? qualityReport.content_edit_history : [],
            verification: qualityReport.verification || null,
            post_actions: qualityReport.post_actions || null,
            handoff_bundle: handoffBundle
        },
        project_context: {
            glossary_available: Boolean(options?.projectContext?.glossaryYaml),
            glossary_yaml: options?.projectContext?.glossaryYaml || null,
            content_policy_matrix_yaml: options?.projectContext?.contentPolicyMatrixYaml || null,
            atoma_files_description: options?.projectContext?.atomaFilesDescription || null,
            atoma_files_payload: options?.projectContext?.atomaFilesPayload || null
        },
        workspace_context: {
            plan_item_ref: assets.action?.id || metrics.task_id || null,
            target_resource_url: handoffBundle?.publication?.link_url || firstResourceWithUrl?.url || null,
            target_resource_label: handoffBundle?.publication?.link_url ? 'publication.link_url' : firstResourceWithUrl?.file_name || firstResourceWithUrl?.ref || null,
            source_content: firstSourceContent?.content || handoffBundle?.publication?.body || item.draft_text || '',
            source_file_name: firstSourceContent?.file_name || null,
            voice_profile: derivedVoice,
            platform_type: item.channel?.type || item.layer || null
        }
    };
}

export function countBundleResourceFiles(bundle: any) {
    return Array.isArray(bundle?.resource_files) ? bundle.resource_files.length : 0;
}

export function countResolvedAssets(item: any) {
    return Array.isArray(item?.assets?.resolved_assets) ? item.assets.resolved_assets.length : 0;
}

export async function runPublicationCriticReview(projectId: number, item: any, overrideText?: string) {
    const plan = await loadPublicationPlanContext(projectId);
    const projectContext = await loadPublicationProjectContext(projectId);
    const action = item.assets?.action;
    const bundle = plan && action
        ? publicationPlanService.buildHandoffBundle({ ...plan, actions: [action] } as any, item)
        : (item.quality_report?.handoff_bundle || null);

    const publicationBody = (overrideText || bundle?.publication?.body || item.draft_text || '').trim();
    const sourceContent = ((bundle?.resource_files || []) as any[]).find((entry) => typeof entry?.content === 'string' && entry.content.trim())?.content || '';
    if (!publicationBody) {
        throw new Error('No publication body is available for critic review.');
    }

    const platform = item.channel?.type || item.layer || item.type;
    const contentLanguage = channelContentLanguage(item.channel);
    const voice = derivePublicationVoice(item);
    const dictionaryReport = contentDictionaryService.validateText(publicationBody, projectContext.glossaryYaml);
    const policyReport = contentPolicyMatrixService.validateText(publicationBody, projectContext.contentPolicyMatrixYaml, {
        platform,
        voice
    });

    let llmCritic: any = null;
    let llmError: string | null = null;

    try {
        llmCritic = await multiAgentService.runPublicationCritic(projectId, {
            task_id: action?.id || item.metrics?.task_id || item.id,
            title: item.title,
            channel: item.channel?.name || item.layer || item.type,
            platform,
            content_language: contentLanguage,
            voice_profile: voice,
            target_resource_url: bundle?.publication?.link_url || null,
            publication_body: publicationBody,
            source_content: sourceContent,
            glossary_yaml: projectContext.glossaryYaml,
            content_policy_matrix_yaml: projectContext.contentPolicyMatrixYaml,
            applied_policy: policyReport.derived_policy,
            deterministic_findings: {
                dictionary: dictionaryReport.findings,
                policy: policyReport.findings,
                dictionary_score: dictionaryReport.score,
                policy_score: policyReport.score,
                policy_dimensions: policyReport.dimensions
            },
            atoma_files_description: projectContext.atomaFilesDescription,
            atoma_files_payload: projectContext.atomaFilesPayload
        });
    } catch (error: any) {
        llmError = error?.message || 'Critic agent failed';
    }

    const llmDimensions = llmCritic?.dimensions && typeof llmCritic.dimensions === 'object'
        ? llmCritic.dimensions
        : {};
    const mergedDimensions = {
        platform_fit: Math.round(((policyReport.dimensions.platform_fit || 0) + (Number(llmDimensions.platform_fit) || policyReport.dimensions.platform_fit || 0)) / 2),
        voice_fit: Math.round(((policyReport.dimensions.voice_fit || 0) + (Number(llmDimensions.voice_fit) || policyReport.dimensions.voice_fit || 0)) / 2),
        length_fit: Math.round(((policyReport.dimensions.length_fit || 0) + (Number(llmDimensions.length_fit) || policyReport.dimensions.length_fit || 0)) / 2),
        rule_fit: Math.round(((policyReport.dimensions.rule_fit || 0) + (Number(llmDimensions.rule_fit) || policyReport.dimensions.rule_fit || 0)) / 2),
        dictionary_fit: dictionaryReport.score,
        llm_quality: llmCritic?.score ?? null
    };

    const overallScore = llmCritic
        ? Math.round((dictionaryReport.score + policyReport.score + llmCritic.score) / 3)
        : Math.round((dictionaryReport.score + policyReport.score) / 2);

    const criticReview = {
        checked_at: new Date().toISOString(),
        overall_score: overallScore,
        dictionary: dictionaryReport,
        policy_matrix: {
            score: policyReport.score,
            findings: policyReport.findings,
            dimensions: policyReport.dimensions,
            derived_policy: policyReport.derived_policy
        },
        scoring_dimensions: mergedDimensions,
        llm_critic: llmCritic,
        llm_error: llmError,
        glossary_available: Boolean(projectContext.glossaryYaml),
        content_policy_matrix_available: Boolean(projectContext.contentPolicyMatrixYaml),
        content_policy_matrix_yaml: projectContext.contentPolicyMatrixYaml,
        atoma_files_description: projectContext.atomaFilesDescription,
        atoma_files_payload: projectContext.atomaFilesPayload,
        workspace_context: {
            platform,
            voice_profile: voice,
            target_resource_url: bundle?.publication?.link_url || null
        }
    };

    return {
        criticReview,
        publicationBody,
        bundle,
        projectContext
    };
}
