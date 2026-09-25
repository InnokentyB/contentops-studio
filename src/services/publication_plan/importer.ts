import * as fs from 'fs';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import { PublicationPlan, PublicationPlanImportMode } from './types';
import {
    slugify,
    computeSchedule,
    resolveImportedWeekTheme,
    normalizeCycleDate,
    derivePublicationOutcome,
    getImportedTaskId,
    isExternalPublicationPlanItem,
    shouldPreserveRuntimeTask,
    shouldFreezeImportedTaskContent,
    mergeImportedItemData,
    mergePlanAsset,
    mergePlanAction
} from './utils';
import { parsePlan } from './templates';
import {
    preloadPlanUrlContents,
    resolveImportPipelineRoot,
    loadAssetSnapshots,
    loadContentFileSnapshots,
    buildAssetSnapshots,
    buildContentFileSnapshots
} from './snapshots';
import publicationAdapterService, { PublicationAction, PublicationAccount } from '../publication_adapter.service';
import { mapActionStatus, resolveActionTitle } from '../publication_runtime.helpers';
import contentDictionaryService from '../content_dictionary.service';
import contentPolicyMatrixService from '../content_policy_matrix.service';

/**
 * Loads a stored publication plan from project settings.
 */
export async function loadStoredPlan(projectId: number): Promise<PublicationPlan | null> {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: {
                in: [
                    'publication_plan_meta',
                    'publication_plan_assets',
                    'publication_plan_accounts',
                    'publication_plan_asset_snapshots',
                    'publication_plan_content_file_snapshots',
                    'publication_plan_ongoing_rules',
                    'publication_plan_measurement'
                ]
            }
        }
    });

    const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
    const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
    const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;

    if (!meta || !assets || !accounts) {
        return null;
    }

    try {
        return {
            meta: JSON.parse(meta),
            assets: JSON.parse(assets),
            accounts: JSON.parse(accounts),
            asset_snapshots: JSON.parse(settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value || '{}'),
            content_file_snapshots: JSON.parse(settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value || '{}'),
            ongoing_rules: JSON.parse(settings.find((setting) => setting.key === 'publication_plan_ongoing_rules')?.value || '[]'),
            measurement: JSON.parse(settings.find((setting) => setting.key === 'publication_plan_measurement')?.value || '{}'),
            actions: []
        };
    } catch {
        return null;
    }
}

/**
 * Merges incoming plan with existing stored plan for delta import.
 */
export function mergePlansForDelta(existingPlan: PublicationPlan, incomingPlan: PublicationPlan): PublicationPlan {
    const mergedAssets: Record<string, Record<string, unknown>> = {
        ...(existingPlan.assets || {})
    };

    for (const [assetRef, incomingAsset] of Object.entries(incomingPlan.assets || {})) {
        mergedAssets[assetRef] = (mergePlanAsset(mergedAssets[assetRef], incomingAsset) as Record<string, unknown>) || incomingAsset;
    }

    const mergedAccounts = {
        ...(existingPlan.accounts || {}),
        ...(incomingPlan.accounts || {})
    };

    const actionMap = new Map<string, Record<string, unknown>>();
    for (const action of existingPlan.actions || []) {
        if (action?.id) actionMap.set(String(action.id), action);
    }
    for (const action of incomingPlan.actions || []) {
        if (!action?.id) continue;
        const key = String(action.id);
        const merged = mergePlanAction(actionMap.get(key), action);
        if (merged) actionMap.set(key, merged);
    }

    return {
        ...existingPlan,
        ...incomingPlan,
        meta: {
            ...(existingPlan.meta || {}),
            ...(incomingPlan.meta || {})
        },
        accounts: mergedAccounts,
        assets: mergedAssets,
        actions: Array.from(actionMap.values()),
        asset_snapshots: {
            ...(existingPlan.asset_snapshots || {}),
            ...(incomingPlan.asset_snapshots || {})
        },
        content_file_snapshots: {
            ...(existingPlan.content_file_snapshots || {}),
            ...(incomingPlan.content_file_snapshots || {})
        },
        ongoing_rules: Array.isArray(incomingPlan.ongoing_rules) && incomingPlan.ongoing_rules.length > 0
            ? incomingPlan.ongoing_rules
            : (existingPlan.ongoing_rules || []),
        measurement: {
            ...(existingPlan.measurement || {}),
            ...(incomingPlan.measurement || {})
        }
    };
}

/**
 * Imports a publication plan (delta_safe or full_sync) and orchestrates DB records.
 */
export async function importPlan(params: {
    rawPlan?: string;
    planPath?: string;
    userId: number;
    workspaceRoots?: string[];
    importMode?: PublicationPlanImportMode;
}) {
    const importMode = params.importMode || 'delta_safe';
    const rawPlan = params.rawPlan
        ? params.rawPlan
        : fs.readFileSync(params.planPath || '', 'utf8');
    const incomingPlan = parsePlan(rawPlan);
    await preloadPlanUrlContents(incomingPlan);
    let plan = incomingPlan;

    const incomingAssetRefs = Object.keys(incomingPlan.assets || {});
    const incomingActions = Array.isArray(incomingPlan.actions) ? incomingPlan.actions : [];
    const incomingHasContentFiles = incomingActions.some((action) => {
        const contentFiles = (action as { content_files?: unknown[] })?.content_files;
        return Array.isArray(contentFiles) && contentFiles.length > 0;
    });

    const existingPlanMarker = await prisma.projectSettings.findFirst({
        where: {
            key: 'publication_plan_id',
            value: plan.meta.plan_id
        }
    });

    const existingProject = existingPlanMarker
        ? await prisma.project.findUnique({ where: { id: existingPlanMarker.project_id } })
        : null;
    const shouldUpdateAssetPayload = !existingProject || importMode === 'full_sync' || incomingAssetRefs.length > 0;
    const shouldUpdateContentFileSnapshots = !existingProject || importMode === 'full_sync' || incomingHasContentFiles;

    if (existingProject && importMode === 'delta_safe') {
        const storedPlan = await loadStoredPlan(existingProject.id);
        if (storedPlan) {
            const contentItems = await prisma.contentItem.findMany({
                where: { project_id: existingProject.id }
            });
            storedPlan.actions = contentItems
                .filter((item) => isExternalPublicationPlanItem(item as unknown as Record<string, unknown>))
                .map((item) => ((item.assets as Record<string, unknown>) || {}).action as Record<string, unknown>)
                .filter(Boolean);

            plan = mergePlansForDelta(storedPlan, plan);
            plan._fetched_url_contents = incomingPlan._fetched_url_contents;
        }
    }

    const mergedActionMap = new Map<string, Record<string, unknown>>(
        (plan.actions || [])
            .filter((action) => action?.id)
            .map((action) => [String(action.id), action] as const)
    );
    const actionsToImport = importMode === 'delta_safe' && existingProject
        ? incomingActions
            .filter((action) => action?.id)
            .map((action) => mergedActionMap.get(String(action.id)) || action)
        : (plan.actions || []);

    const resolvedPipelineRoot = resolveImportPipelineRoot(plan, params.workspaceRoots || [], params.planPath);
    if (resolvedPipelineRoot) {
        plan.meta.pipeline_root = resolvedPipelineRoot;
    }

    let slug = existingProject?.slug || '';
    if (!existingProject) {
        const baseSlug = slugify(plan.meta.plan_id) || `publication-plan-${Date.now()}`;
        slug = baseSlug;
        let suffix = 1;
        while (await prisma.project.findUnique({ where: { slug } })) {
            slug = `${baseSlug}-${suffix}`;
            suffix += 1;
        }
    }

    const existingSnapshots = existingProject
        ? await loadAssetSnapshots(existingProject.id)
        : {};
    const existingContentFileSnapshots = existingProject
        ? await loadContentFileSnapshots(existingProject.id)
        : {};
    const assetSnapshotRefreshMode = !existingProject || importMode === 'full_sync'
        ? 'full'
        : incomingAssetRefs.length > 0
            ? 'partial'
            : 'skipped';
    const contentFileSnapshotRefreshMode = !existingProject || importMode === 'full_sync'
        ? 'full'
        : incomingHasContentFiles
            ? 'partial'
            : 'skipped';
    const assetSnapshots = !existingProject || importMode === 'full_sync'
        ? buildAssetSnapshots(plan, existingSnapshots)
        : incomingAssetRefs.length > 0
            ? {
                ...existingSnapshots,
                ...buildAssetSnapshots(plan, existingSnapshots, {}, incomingAssetRefs)
            }
            : existingSnapshots;
    const contentFileSnapshots = !existingProject || importMode === 'full_sync'
        ? buildContentFileSnapshots(plan, existingContentFileSnapshots)
        : incomingHasContentFiles
            ? {
                ...existingContentFileSnapshots,
                ...buildContentFileSnapshots(plan, existingContentFileSnapshots, incomingActions)
            }
            : existingContentFileSnapshots;
    const dictionaryYaml = plan.content_dictionary !== undefined
        ? contentDictionaryService.normalizeToYaml(plan.content_dictionary)
        : null;
    const contentPolicyMatrixYaml = plan.content_policy_matrix !== undefined
        ? contentPolicyMatrixService.normalizeToYaml(plan.content_policy_matrix)
        : null;
    const atomaFilesDescription = plan.atoma_files_description === undefined
        ? null
        : (typeof plan.atoma_files_description === 'string'
            ? plan.atoma_files_description.trim()
            : JSON.stringify(plan.atoma_files_description));
    const atomaFilesPayload = plan.atoma_files === undefined
        ? null
        : JSON.stringify(plan.atoma_files);

    const organization = await prisma.organizationMember.findFirst({
        where: { user_id: params.userId, role: 'owner', organization: { is_archived: false } },
        orderBy: { organization_id: 'asc' }, select: { organization_id: true }
    });
    if (!organization) throw new Error('An owner organization is required');

    return prisma.$transaction(async (tx) => {
        const project = existingProject
            ? await tx.project.update({
                where: { id: existingProject.id },
                data: {
                    name: plan.meta.plan_id,
                    description: `Imported publication plan ${plan.meta.plan_id}`
                }
            })
            : await tx.project.create({
                data: {
                    name: plan.meta.plan_id,
                    slug,
                    description: `Imported publication plan ${plan.meta.plan_id}`,
                    organization_id: organization.organization_id,
                    research_profile: { create: { revision: 1 } },
                    members: {
                        create: {
                            user_id: params.userId,
                            role: 'owner'
                        }
                    }
                }
            });

        const existingChannels = await tx.socialChannel.findMany({
            where: { project_id: project.id }
        });

        const existingDbItems = await tx.contentItem.findMany({
            where: { project_id: project.id }
        });
        const existingImportedItems = existingDbItems.filter((item) =>
            isExternalPublicationPlanItem(item as unknown as Record<string, unknown>)
        );

        const existingImportedItemsByTaskId = new Map(
            existingImportedItems
                .map((item) => [getImportedTaskId(item as unknown as Record<string, unknown>) as string, item] as const)
        );

        const settingsPayload = [
            {
                project_id: project.id,
                key: 'publication_plan_id',
                value: plan.meta.plan_id
            },
            {
                project_id: project.id,
                key: 'publication_plan_meta',
                value: JSON.stringify(plan.meta)
            },
            ...(shouldUpdateAssetPayload ? [{
                project_id: project.id,
                key: 'publication_plan_assets',
                value: JSON.stringify(plan.assets)
            }] : []),
            {
                project_id: project.id,
                key: 'publication_plan_accounts',
                value: JSON.stringify(plan.accounts)
            },
            ...((!existingProject || importMode === 'full_sync' || incomingAssetRefs.length > 0) ? [{
                project_id: project.id,
                key: 'publication_plan_asset_snapshots',
                value: JSON.stringify(assetSnapshots)
            }] : []),
            ...(shouldUpdateContentFileSnapshots ? [{
                project_id: project.id,
                key: 'publication_plan_content_file_snapshots',
                value: JSON.stringify(contentFileSnapshots)
            }] : []),
            {
                project_id: project.id,
                key: 'publication_plan_ongoing_rules',
                value: JSON.stringify(plan.ongoing_rules || [])
            },
            {
                project_id: project.id,
                key: 'publication_plan_measurement',
                value: JSON.stringify(plan.measurement || {})
            },
            {
                project_id: project.id,
                key: 'publication_plan_dependencies_matrix',
                value: JSON.stringify(plan.dependencies_matrix_visualized || {})
            },
            ...(dictionaryYaml ? [{
                project_id: project.id,
                key: 'content_dictionary_yaml',
                value: dictionaryYaml
            }] : []),
            ...(contentPolicyMatrixYaml ? [{
                project_id: project.id,
                key: 'content_policy_matrix_yaml',
                value: contentPolicyMatrixYaml
            }] : []),
            ...(atomaFilesDescription ? [{
                project_id: project.id,
                key: 'atoma_files_description',
                value: atomaFilesDescription
            }] : []),
            ...(atomaFilesPayload ? [{
                project_id: project.id,
                key: 'atoma_files_payload',
                value: atomaFilesPayload
            }] : [])
        ];

        for (const setting of settingsPayload) {
            await tx.projectSettings.upsert({
                where: {
                    project_id_key: {
                        project_id: project.id,
                        key: setting.key
                    }
                },
                update: { value: setting.value },
                create: setting
            });
        }

        const accountActions = Object.entries(plan.accounts).reduce<Record<string, PublicationAction[]>>((acc, [accountRef]) => {
            acc[accountRef] = plan.actions.filter((action) => action.account_ref === accountRef) as unknown as PublicationAction[];
            return acc;
        }, {});

        const channels = await Promise.all(
            Object.entries(plan.accounts).map(async ([accountRef, account]) => {
                const channelConfig = publicationAdapterService.buildAdapterConfig(
                    accountRef,
                    account as PublicationAccount,
                    accountActions[accountRef] || []
                );
                const existingChannel = existingChannels.find((channel) => channel.name === accountRef);

                if (existingChannel) {
                    const existingConf = existingChannel.config && typeof existingChannel.config === 'object'
                        ? (existingChannel.config as Record<string, unknown>)
                        : {};
                    const chanConf = (channelConfig as Record<string, unknown>) || {};
                    const mergedConfig = {
                        ...existingConf,
                        ...chanConf,
                        telegram_channel_id: existingConf.telegram_channel_id || chanConf.telegram_channel_id || null,
                        channel_username: existingConf.channel_username || chanConf.channel_username || null,
                        handle: existingConf.handle || chanConf.handle || null,
                        api_key: existingConf.api_key || chanConf.api_key || null,
                        access_token: existingConf.access_token || chanConf.access_token || null,
                        application_key: existingConf.application_key || chanConf.application_key || null,
                        application_secret_key: existingConf.application_secret_key || chanConf.application_secret_key || null,
                        vk_id: existingConf.vk_id || chanConf.vk_id || null,
                        group_id: existingConf.group_id || chanConf.group_id || null,
                        cookies: existingConf.cookies || chanConf.cookies || null,
                        webhook_url: existingConf.webhook_url || chanConf.webhook_url || null
                    };

                    return tx.socialChannel.update({
                        where: { id: existingChannel.id },
                        data: {
                            type: account.platform as string,
                            config: mergedConfig,
                            is_active: true
                        }
                    });
                }

                return tx.socialChannel.create({
                    data: {
                        project_id: project.id,
                        type: account.platform as string,
                        name: accountRef,
                        config: channelConfig as Prisma.InputJsonObject
                    }
                });
            })
        );

        const channelMap = new Map(channels.map((channel) => [channel.name, channel.id]));
        const gscChannel = channels.find((channel) => channel.type === 'google_search_console') || null;

        const now = new Date();
        const cycleStart = normalizeCycleDate(plan.meta.cycle_start, now);
        const cycleEnd = normalizeCycleDate(plan.meta.cycle_end, cycleStart);

        const existingWeekPackage = await tx.weekPackage.findUnique({
            where: {
                project_id_week_start_week_end: {
                    project_id: project.id,
                    week_start: cycleStart,
                    week_end: cycleEnd
                }
            }
        });

        const weekPackageData = {
            project_id: project.id,
            week_start: cycleStart,
            week_end: cycleEnd,
            week_theme: resolveImportedWeekTheme(plan),
            core_thesis: plan.meta.source_article_id || null,
            audience_focus: 'external_strategy',
            intent_tag: 'distribution_execution',
            narrative_arc: JSON.parse(JSON.stringify(plan.meta)),
            channel_mix: Object.fromEntries(
                Object.entries(plan.accounts).map(([key, value]) => [key, (value as { platform?: string }).platform])
            ),
            plan_id: plan.meta.plan_id,
            plan_version: plan.meta.plan_version || null,
            timezone: plan.meta.timezone_default || 'UTC',
            approval_status: 'approved'
        };

        const weekPackage = existingWeekPackage
            ? await tx.weekPackage.update({
                where: { id: existingWeekPackage.id },
                data: {
                    week_theme: weekPackageData.week_theme,
                    core_thesis: weekPackageData.core_thesis,
                    audience_focus: weekPackageData.audience_focus,
                    intent_tag: weekPackageData.intent_tag,
                    narrative_arc: weekPackageData.narrative_arc,
                    channel_mix: weekPackageData.channel_mix,
                    plan_id: weekPackageData.plan_id,
                    plan_version: weekPackageData.plan_version,
                    timezone: weekPackageData.timezone,
                    approval_status: weekPackageData.approval_status
                }
            })
            : await tx.weekPackage.create({
                data: weekPackageData
            });

        const importedTaskIds = new Set<string>();
        let createdTasks = 0;
        let updatedTasks = 0;
        let runtimeLockedTasksSkipped = 0;
        const unchangedTasks = 0;
        const conflicts: Array<Record<string, unknown>> = [];

        for (const action of actionsToImport) {
            const schedule = computeSchedule(
                action as { scheduled_at?: string; scheduled_date?: string; scheduled_time_window?: { start?: string; timezone?: string } },
                plan.meta.timezone_default
            );
            const actionAssetRefs = Array.isArray(action.asset_refs) ? (action.asset_refs as string[]) : [];
            const resolvedAssets = actionAssetRefs.map((ref: string) => ({
                ref,
                asset: plan.assets[ref] || null
            }));
            const actionAccountRef = String(action.account_ref || '');
            const account = plan.accounts[actionAccountRef] || {};
            const executionMode = publicationAdapterService.inferExecutionMode(account, action as unknown as PublicationAction);
            const mappedStatus = mapActionStatus(action.status as string | undefined);
            const publicationOutcome = derivePublicationOutcome(action);
            const taskId = String(action.id);
            importedTaskIds.add(taskId);

            let rawChannel = String(action.channel || 'general');
            let rawActionType = String(action.action_type || 'post');
            const accountConfig = plan.accounts[actionAccountRef] || plan.accounts[rawChannel];

            if (accountConfig?.platform && plan.accounts[rawChannel]) {
                rawChannel = accountConfig.platform as string;
            }
            if (rawActionType.startsWith(`${rawChannel}:`)) {
                rawActionType = rawActionType.slice(rawChannel.length + 1);
            }

            const actionParameters = (action.parameters as { link_url_ref?: string } | undefined) || {};
            const actionVerification = Array.isArray(action.verification) ? action.verification : [];
            const actionPostLive = actionVerification.find((v: unknown) => (v as { type?: string })?.type === 'post_live_check') as { url?: string } | undefined;

            const itemData: Record<string, unknown> = {
                project_id: project.id,
                week_package_id: weekPackage.id,
                channel_id: channelMap.get(actionAccountRef) || null,
                type: `${rawChannel}:${rawActionType}`,
                layer: action.channel,
                title: resolveActionTitle(action),
                brief: (action.notes as string | undefined) || (action.human_review_reason as string | undefined) || null,
                key_points: resolvedAssets,
                cta: actionParameters.link_url_ref || null,
                cross_link_to: action.dependencies || [],
                item_key: (action.item_key as string | undefined) || String(action.id),
                content_due_at: action.content_due_at ? new Date(action.content_due_at as string) : null,
                publish_at: action.scheduled_at ? new Date(action.scheduled_at as string) : null,
                source_refs: action.content_files || null,
                assets: {
                    source: 'external_publication_plan',
                    action,
                    account_ref: action.account_ref,
                    asset_refs: action.asset_refs || [],
                    resolved_assets: resolvedAssets
                },
                status: mappedStatus,
                schedule_at: schedule?.scheduled_at || null,
                quality_report: {
                    execution_mode: executionMode,
                    verification: action.verification || [],
                    post_actions: action.post_actions || [],
                    human_review: action.human_review === true,
                    human_review_reason: action.human_review_reason || null,
                    blocking_conditions: action.blocking_conditions || [],
                    display_name: action.display_name || null,
                    deferred_reason: action.deferred_reason || null,
                    blocked_by: action.blocked_by || [],
                    reactivation_trigger: action.reactivation_trigger || null,
                    target_cycle_after_unblock: action.target_cycle_after_unblock || null,
                    publication_outcome: publicationOutcome,
                    plan_outcome: action.outcome || null,
                    skip_reason: action.skip_reason || null
                },
                metrics: {
                    publication_plan_id: plan.meta.plan_id,
                    task_id: taskId,
                    task_display_name: action.display_name || null,
                    timezone: schedule?.timezone || plan.meta.timezone_default || null,
                    account_ref: action.account_ref,
                    publication_outcome: publicationOutcome,
                    monitoring: publicationAdapterService.deriveMonitoringPlan(action as unknown as PublicationAction)
                },
                published_link: action.status === 'completed'
                    ? actionPostLive?.url || null
                    : null
            };

            const existingItem = existingImportedItemsByTaskId.get(taskId);

            if (existingItem?.week_package_id && existingItem.week_package_id !== weekPackage.id) {
                conflicts.push({
                    code: 'CROSS_CYCLE_TASK_ID',
                    taskId,
                    contentItemId: existingItem.id,
                    existingWeekPackageId: existingItem.week_package_id,
                    targetWeekPackageId: weekPackage.id
                });
                throw new Error(`[CROSS_CYCLE_TASK_ID] Task ${taskId} already belongs to week package ${existingItem.week_package_id}`);
            }

            let createdItem: { id: number };
            if (existingItem && shouldFreezeImportedTaskContent(existingItem as unknown as Record<string, unknown>)) {
                createdItem = existingItem;
                runtimeLockedTasksSkipped += 1;
            } else if (existingItem) {
                createdItem = await tx.contentItem.update({
                    where: { id: existingItem.id },
                    data: mergeImportedItemData(
                        existingItem as unknown as Record<string, unknown>,
                        itemData,
                        shouldPreserveRuntimeTask(existingItem as unknown as Record<string, unknown>)
                    )
                });
                updatedTasks += 1;
            } else {
                createdItem = await tx.contentItem.create({
                    data: itemData as any
                });
                createdTasks += 1;
            }

            const postActionsList = Array.isArray(action.post_actions) ? action.post_actions : [];
            const gscPostActions = postActionsList.filter((item: unknown) => {
                const t = (item as { type?: string })?.type;
                return t === 'submit_to_gsc' || t === 'gsc_url_inspection';
            }) as Array<{ type: string; url_ref?: string }>;

            for (const postAction of gscPostActions) {
                if (!gscChannel) continue;

                const followupTaskId = `${action.id}:${postAction.type}`;
                importedTaskIds.add(followupTaskId);

                const followupData: Record<string, unknown> = {
                    project_id: project.id,
                    week_package_id: weekPackage.id,
                    channel_id: gscChannel.id,
                    type: `google_search_console:${postAction.type}`,
                    layer: 'google_search_console',
                    title: `${resolveActionTitle(action)} · ${postAction.type}`,
                    brief: `Follow-up GSC action for ${action.id}`,
                    cross_link_to: [createdItem.id],
                    status: mappedStatus === 'deferred' ? 'deferred' : mappedStatus === 'skipped' ? 'skipped' : 'planned',
                    schedule_at: schedule?.scheduled_at || null,
                    assets: {
                        source: 'external_publication_plan',
                        parent_action_id: action.id,
                        parent_content_item_id: createdItem.id,
                        gsc_action: postAction,
                        target_url_ref: postAction.url_ref || actionParameters.link_url_ref || null
                    },
                    quality_report: {
                        execution_mode: 'automated',
                        verification: [],
                        post_actions: []
                    },
                    metrics: {
                        publication_plan_id: plan.meta.plan_id,
                        task_id: followupTaskId,
                        task_display_name: action.display_name ? `${action.display_name} · ${postAction.type}` : null,
                        account_ref: gscChannel.name,
                        monitoring: {
                            needs_analytics_collection: true
                        }
                    }
                };

                const existingFollowup = existingImportedItemsByTaskId.get(followupTaskId);

                if (existingFollowup) {
                    await tx.contentItem.update({
                        where: { id: existingFollowup.id },
                        data: mergeImportedItemData(
                            existingFollowup as unknown as Record<string, unknown>,
                            followupData,
                            shouldPreserveRuntimeTask(existingFollowup as unknown as Record<string, unknown>)
                        )
                    });
                    continue;
                }

                await tx.contentItem.create({
                    data: followupData as any
                });
            }
        }

        let staleImportedIds: number[] = [];
        if (importMode === 'full_sync') {
            staleImportedIds = existingImportedItems
                .filter((item) => {
                    const taskId = getImportedTaskId(item as unknown as Record<string, unknown>);
                    if (!taskId || importedTaskIds.has(taskId)) {
                        return false;
                    }
                    return !shouldPreserveRuntimeTask(item as unknown as Record<string, unknown>);
                })
                .map((item) => item.id);

            if (staleImportedIds.length > 0) {
                await tx.contentItem.deleteMany({
                    where: {
                        id: { in: staleImportedIds }
                    }
                });
            }
        }

        return {
            project,
            week_package: weekPackage,
            imported: {
                importMode,
                accounts: channels.length,
                actions: plan.actions.length,
                incomingActions: incomingActions.length,
                processedActions: actionsToImport.length,
                assets: Object.keys(plan.assets).length,
                incomingAssets: incomingAssetRefs.length,
                assetSnapshots: Object.keys(assetSnapshots).length,
                assetSnapshotRefreshMode,
                contentFileSnapshots: Object.keys(contentFileSnapshots).length,
                contentFileSnapshotRefreshMode,
                ongoingRules: (plan.ongoing_rules || []).length,
                deletedStaleTasks: staleImportedIds.length,
                updatedExistingProject: Boolean(existingProject),
                targetWeekPackageId: weekPackage.id,
                createdWeekPackage: !existingWeekPackage,
                createdTasks,
                updatedTasks,
                movedTasks: 0,
                runtimeLockedTasksSkipped,
                conflicts,
                unchangedTasks,
                previousPackagesUpdated: 0
            }
        };
    });
}
