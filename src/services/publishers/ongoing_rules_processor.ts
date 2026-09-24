import prisma from '../../db';
import gscService from '../gsc.service';
import { parseRecurringTrigger } from '../publication_runtime.helpers';
import { logToFile } from './publisher_logger';
import { operationalTaskActions, resolvePlanRef } from './operational_task_actions';
import { OngoingRulePlan } from './types';

export { OngoingRulePlan };



export class OngoingRulesProcessor {
    private ongoingRulePlanCache: {
        expiresAt: number;
        plans: OngoingRulePlan[];
    } | null = null;

    ongoingRuleCacheTtlMs(): number {
        const configured = Number(process.env.PUBLICATION_RULES_CACHE_TTL_MS || 300000);
        return Number.isFinite(configured) && configured >= 1000 ? configured : 300000;
    }

    async loadOngoingRulePlans(): Promise<OngoingRulePlan[]> {
        const now = Date.now();
        if (this.ongoingRulePlanCache && this.ongoingRulePlanCache.expiresAt > now) {
            return this.ongoingRulePlanCache.plans;
        }

        const ruleSettings = await prisma.projectSettings.findMany({
            where: { key: 'publication_plan_ongoing_rules' },
            select: { project_id: true, value: true }
        });
        const projectIds = ruleSettings.map((setting) => setting.project_id);
        if (projectIds.length === 0) {
            this.ongoingRulePlanCache = {
                expiresAt: now + this.ongoingRuleCacheTtlMs(),
                plans: []
            };
            return [];
        }

        const supportingSettings = await prisma.projectSettings.findMany({
            where: {
                project_id: { in: projectIds },
                key: { in: ['publication_plan_meta', 'publication_plan_measurement'] }
            },
            select: { project_id: true, key: true, value: true }
        });
        const settingsByProject = new Map<number, Map<string, string>>();
        for (const setting of supportingSettings) {
            const projectSettings = settingsByProject.get(setting.project_id) || new Map<string, string>();
            projectSettings.set(setting.key, setting.value);
            settingsByProject.set(setting.project_id, projectSettings);
        }

        const plans: OngoingRulePlan[] = ruleSettings.flatMap((ruleSetting) => {
            const projectSettings = settingsByProject.get(ruleSetting.project_id);
            const metaValue = projectSettings?.get('publication_plan_meta');
            if (!metaValue) return [];

            const measurementValue = projectSettings?.get('publication_plan_measurement');
            return [{
                projectId: ruleSetting.project_id,
                meta: JSON.parse(metaValue),
                ongoing_rules: JSON.parse(ruleSetting.value || '[]'),
                measurement: measurementValue ? JSON.parse(measurementValue) : {}
            }];
        });

        this.ongoingRulePlanCache = {
            expiresAt: now + this.ongoingRuleCacheTtlMs(),
            plans
        };
        return plans;
    }

    resolvePlanRef(plan: unknown, ref?: string | null): unknown {
        return resolvePlanRef(plan, ref);
    }


    async findDependencyItems(projectId: number, dependencyTaskIds: string[]) {
        if (dependencyTaskIds.length === 0) return [];

        return prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                OR: dependencyTaskIds.map((dep) => ({
                    metrics: {
                        path: ['task_id'],
                        equals: dep
                    }
                }))
            },
            select: {
                id: true,
                status: true,
                title: true,
                metrics: true,
                updated_at: true
            }
        });
    }

    async loadPublicationPlanContext(projectId: number) {
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
        const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
        const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;
        const ongoingRules = settings.find((setting) => setting.key === 'publication_plan_ongoing_rules')?.value;
        const measurement = settings.find((setting) => setting.key === 'publication_plan_measurement')?.value;

        if (!meta || !assets || !accounts) {
            return null;
        }

        return {
            meta: JSON.parse(meta),
            assets: JSON.parse(assets),
            accounts: JSON.parse(accounts),
            asset_snapshots: assetSnapshots ? JSON.parse(assetSnapshots) : {},
            content_file_snapshots: contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {},
            actions: [] as any[],
            ongoing_rules: ongoingRules ? JSON.parse(ongoingRules) : [],
            measurement: measurement ? JSON.parse(measurement) : {}
        };
    }

    async getProjectGscChannel(projectId: number) {
        return prisma.socialChannel.findFirst({
            where: {
                project_id: projectId,
                type: 'google_search_console'
            }
        });
    }

    async evaluateBlockingConditions(task: any, plan: any): Promise<{
        ready: boolean;
        kind?: 'waiting_on_blocking_condition';
        details?: any;
    }> {
        const blockingConditions = ((task.quality_report as any)?.blocking_conditions || (task.assets as any)?.action?.blocking_conditions || []) as any[];
        if (blockingConditions.length === 0) {
            return { ready: true };
        }

        const dependencyTaskIds = ((task.assets as any)?.action?.dependencies || []) as string[];
        const dependencyItems = await this.findDependencyItems(task.project_id, dependencyTaskIds);
        const dependencyEntries: Array<[string, any]> = dependencyItems
            .map((item): [string, any] | null => {
                const taskId = String((item.metrics as any)?.task_id || '');
                return taskId ? [taskId, item] : null;
            })
            .filter((entry): entry is [string, any] => Boolean(entry));
        const dependencyByTaskId = new Map<string, any>(dependencyEntries);

        for (const condition of blockingConditions) {
            if (condition.type === 'gsc_indexed') {
                const targetUrl = this.resolvePlanRef(plan, condition.url_ref) as string | null;
                const gscChannel = await this.getProjectGscChannel(task.project_id);
                if (!targetUrl || !gscChannel) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'gsc_indexed', reason: 'Missing target URL or linked GSC channel.' }
                    };
                }

                const dependencyItem = dependencyTaskIds.map((taskId) => dependencyByTaskId.get(taskId)).find(Boolean);
                if (condition.min_days_indexed && dependencyItem) {
                    const ageMs = Date.now() - new Date(dependencyItem.updated_at).getTime();
                    const requiredMs = Number(condition.min_days_indexed) * 24 * 60 * 60 * 1000;
                    if (ageMs < requiredMs) {
                        return {
                            ready: false,
                            kind: 'waiting_on_blocking_condition',
                            details: { type: 'gsc_indexed', reason: `Minimum indexed age not reached (${condition.min_days_indexed}d).` }
                        };
                    }
                }

                const inspection = await gscService.inspectUrl((gscChannel.config as any).raw_account || gscChannel.config, targetUrl).catch(() => null);
                const coverageState = inspection?.inspectionResult?.indexStatusResult?.coverageState || inspection?.inspectionResult?.indexStatusResult?.verdict || '';
                if (!String(coverageState).toLowerCase().includes('indexed') && String(coverageState).toLowerCase() !== 'pass') {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'gsc_indexed', reason: `GSC has not confirmed indexation yet: ${coverageState || 'unknown'}` }
                    };
                }
            }

            if (condition.type === 'url_live') {
                const targetUrl = this.resolvePlanRef(plan, condition.url_ref) as string | null;
                if (!targetUrl) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'url_live', reason: 'Missing target URL.' }
                    };
                }

                const response = await fetch(targetUrl, { method: 'GET' }).catch(() => null);
                if (!response?.ok) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'url_live', reason: `Target URL is not live yet: ${targetUrl}` }
                    };
                }

                const dependencyItem = dependencyTaskIds.map((taskId) => dependencyByTaskId.get(taskId)).find(Boolean);
                if (condition.min_days_live && dependencyItem) {
                    const ageMs = Date.now() - new Date(dependencyItem.updated_at).getTime();
                    const requiredMs = Number(condition.min_days_live) * 24 * 60 * 60 * 1000;
                    if (ageMs < requiredMs) {
                        return {
                            ready: false,
                            kind: 'waiting_on_blocking_condition',
                            details: { type: 'url_live', reason: `Minimum live age not reached (${condition.min_days_live}d).` }
                        };
                    }
                }
            }

            if (condition.type === 'ih_posting_privileges_granted') {
                const channelConfig: any = task.channel?.config || {};
                const granted = channelConfig.posting_privileges_granted === true
                    || channelConfig.privileges_granted === true
                    || channelConfig.can_post === true;
                if (!granted) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'ih_posting_privileges_granted', reason: 'Indie Hackers posting privileges have not been marked as granted.' }
                    };
                }
            }
        }

        return { ready: true };
    }

    async shouldReactivateDeferredTask(task: any, plan: any) {
        const trigger = (task.quality_report as any)?.reactivation_trigger || (task.assets as any)?.action?.reactivation_trigger || null;
        if (!trigger) {
            return { ready: false, reason: 'No reactivation trigger defined.' };
        }

        if (trigger === 'human_confirms_ih_posting_privileges_granted') {
            const channelConfig: any = task.channel?.config || {};
            const granted = channelConfig.posting_privileges_granted === true
                || channelConfig.privileges_granted === true
                || channelConfig.can_post === true;
            if (!granted) {
                return { ready: false, reason: 'Waiting for human confirmation of IH posting privileges.' };
            }
        }

        const blockingState = await this.evaluateBlockingConditions(task, plan);
        if (!blockingState.ready) {
            return { ready: false, reason: blockingState.details?.reason || 'Blocking conditions are not satisfied yet.' };
        }

        return { ready: true, reason: null };
    }

    async ensureRuleTask(projectId: number, rule: any, instanceKey: string, scheduleAt: Date | null, extra: any = {}) {
        const existing = await prisma.contentItem.findFirst({
            where: {
                project_id: projectId,
                metrics: {
                    path: ['rule_instance_key'],
                    equals: instanceKey
                }
            }
        });

        if (existing) {
            return false;
        }

        await prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: null,
                type: `internal:${rule.action || rule.id}`,
                layer: 'internal',
                title: `Rule · ${rule.id}`,
                brief: `${rule.action || 'rule action'} triggered by ${rule.trigger}`,
                status: 'planned',
                schedule_at: scheduleAt,
                assets: {
                    source: 'ongoing_rule',
                    rule,
                    ...extra
                } as any,
                quality_report: {
                    execution_mode: 'manual',
                    rule_id: rule.id,
                    trigger: rule.trigger
                } as any,
                metrics: {
                    rule_id: rule.id,
                    rule_instance_key: instanceKey
                } as any
            }
        });

        return true;
    }

    async processPublicationOngoingRules(preloadedPlans?: OngoingRulePlan[]) {
        let createdCount = 0;
        const plans = preloadedPlans || await this.loadOngoingRulePlans();

        for (const plan of plans) {
            const projectId = plan.projectId;
            const timezone = typeof plan.meta.timezone_default === 'string' ? plan.meta.timezone_default : 'UTC';
            const rules = Array.isArray(plan.ongoing_rules) ? plan.ongoing_rules : [];

            for (const rule of rules) {
                if (typeof rule?.trigger !== 'string' || !rule.id) continue;

                const recurring = parseRecurringTrigger(rule.trigger, timezone);

                if (recurring?.due) {
                    const instanceKey = `${rule.id}:${new Date().toISOString().slice(0, 10)}`;
                    const created = await this.ensureRuleTask(projectId, rule, instanceKey, recurring.scheduleAt);
                    if (created) createdCount += 1;
                    continue;
                }

                if (rule.trigger.startsWith('after_action:')) {
                    const actionId = rule.trigger.replace('after_action:', '');
                    const sourceTask = await prisma.contentItem.findFirst({
                        where: {
                            project_id: projectId,
                            metrics: {
                                path: ['task_id'],
                                equals: actionId
                            },
                            status: 'published'
                        }
                    });
                    if (sourceTask) {
                        const instanceKey = `${rule.id}:${sourceTask.id}`;
                        const created = await this.ensureRuleTask(projectId, rule, instanceKey, sourceTask.updated_at, { source_task_id: sourceTask.id });
                        if (created) createdCount += 1;
                    }
                    continue;
                }

                if (rule.trigger === 'after_any_linkedin_post' || rule.trigger === 'after_any_innokentiy_linkedin_post' || rule.trigger === 'after_any_publish_to_knowledge_section' || rule.trigger === 'after_any_article_publish_or_edit') {
                    const sourceItems = await prisma.contentItem.findMany({
                        where: {
                            project_id: projectId,
                            status: 'published'
                        },
                        include: { channel: true }
                    });

                    for (const sourceItem of sourceItems) {
                        const accountRef = (sourceItem.metrics as any)?.account_ref || '';
                        const publishedLink = sourceItem.published_link || '';
                        const isLinkedin = sourceItem.channel?.type === 'linkedin';
                        const isKnowledgePublish = publishedLink.includes('/knowledge/') || JSON.stringify((sourceItem.assets as any) || {}).includes('knowledge');
                        const isArticlePublish = ['tilda:publish_article', 'tilda:publish_index_page', 'tilda:update_homepage'].includes(sourceItem.type);

                        const matches =
                            (rule.trigger === 'after_any_linkedin_post' && isLinkedin) ||
                            (rule.trigger === 'after_any_innokentiy_linkedin_post' && isLinkedin && accountRef === 'innokentiy_linkedin') ||
                            (rule.trigger === 'after_any_publish_to_knowledge_section' && isKnowledgePublish) ||
                            (rule.trigger === 'after_any_article_publish_or_edit' && isArticlePublish);

                        if (!matches) continue;

                        const instanceKey = `${rule.id}:${sourceItem.id}`;
                        const created = await this.ensureRuleTask(projectId, rule, instanceKey, sourceItem.updated_at, { source_task_id: sourceItem.id });
                        if (created) createdCount += 1;
                    }
                }
            }

            const measurement = plan.measurement || {};
            const snapshotDays = Array.isArray(measurement.snapshot_days) ? measurement.snapshot_days : [];
            const rawCycleStart = plan.meta.cycle_start;
            const cycleStart = typeof rawCycleStart === 'string' || typeof rawCycleStart === 'number' || rawCycleStart instanceof Date
                ? new Date(rawCycleStart)
                : null;
            if (cycleStart) {

                for (const snapshotDay of snapshotDays) {
                    const scheduleAt = new Date(cycleStart);
                    scheduleAt.setDate(scheduleAt.getDate() + Number(snapshotDay));
                    const instanceKey = `measurement:snapshot:${snapshotDay}`;
                    const created = await this.ensureRuleTask(projectId, {
                        id: `measurement-snapshot-${snapshotDay}`,
                        action: 'measurement_snapshot',
                        trigger: `day_${snapshotDay}`
                    }, instanceKey, scheduleAt, { measurement_snapshot_day: snapshotDay, measurement });
                    if (created) createdCount += 1;
                }
            }
        }

        return createdCount;
    }

    async executeMeasurementSnapshot(task: any, plan: any) {
        return operationalTaskActions.executeMeasurementSnapshot(task, plan);
    }

    async executeGscHealthAudit(task: any, plan: any) {
        return operationalTaskActions.executeGscHealthAudit(task, plan);
    }

    async executeMediumCanonicalVerification(task: any, plan: any) {
        return operationalTaskActions.executeMediumCanonicalVerification(task, plan);
    }

    async executeInternalLinkCrawl(task: any, plan: any) {
        return operationalTaskActions.executeInternalLinkCrawl(task, plan);
    }

    async markInternalTaskAsManual(task: any, reason: string) {
        return operationalTaskActions.markInternalTaskAsManual(task, reason);
    }

    async createGeneratedPublicationTask(params: any) {
        return operationalTaskActions.createGeneratedPublicationTask(params);
    }

    async executeBrandRepostRule(task: any, plan: any) {
        return operationalTaskActions.executeBrandRepostRule(task, plan);
    }

    async executeBrandRotationRule(task: any, plan: any) {
        return operationalTaskActions.executeBrandRotationRule(task, plan);
    }

    async executeKnowledgeHubRule(task: any, plan: any) {
        return operationalTaskActions.executeKnowledgeHubRule(task, plan);
    }


    async processOperationalTasks() {
        let processedCount = 0;
        const tasks = await prisma.contentItem.findMany({
            where: {
                layer: 'internal',
                status: { in: ['planned', 'ready_for_execution'] },
                OR: [
                    { schedule_at: null },
                    { schedule_at: { lte: new Date() } }
                ]
            }
        });

        for (const task of tasks) {
            const plan = await this.loadPublicationPlanContext(task.project_id);
            if (!plan) continue;

            const rule = (task.assets as any)?.rule || {};
            const action = (rule.action || '').toString();
            let result: any = null;

            try {
                if (action === 'measurement_snapshot') {
                    result = await this.executeMeasurementSnapshot(task, plan);
                } else if (action === 'check_gsc_errors_on_published_urls') {
                    result = await this.executeGscHealthAudit(task, plan);
                } else if (action === 'verify_medium_canonical_via_gsc_url_inspection') {
                    result = await this.executeMediumCanonicalVerification(task, plan);
                } else if (action === 'crawl_internal_link_graph') {
                    result = await this.executeInternalLinkCrawl(task, plan);
                } else if (action === 'repost_with_brand_frame') {
                    result = await this.executeBrandRepostRule(task, plan);
                } else if (action === 'prepare_brand_page_post_for_current_rotation_slot') {
                    result = await this.executeBrandRotationRule(task, plan);
                } else if (action === 'append_article_card_to_knowledge_hub') {
                    result = await this.executeKnowledgeHubRule(task, plan);
                } else {
                    await this.markInternalTaskAsManual(task, `No automated executor is implemented for ongoing rule action \`${action}\`.`);
                    continue;
                }

                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'published',
                        quality_report: {
                            ...((task.quality_report as any) || {}),
                            execution_result: result,
                            executed_at: new Date().toISOString()
                        } as any,
                        metrics: {
                            ...((task.metrics as any) || {}),
                            execution_summary: result
                        } as any
                    }
                });
                processedCount += 1;
            } catch (error: any) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'failed',
                        quality_report: {
                            ...((task.quality_report as any) || {}),
                            execution_error: error.message || String(error),
                            executed_at: new Date().toISOString()
                        } as any
                    }
                });
            }
        }

        return processedCount;
    }

    async processDeferredPublicationTasks() {
        let reactivatedCount = 0;
        const deferredTasks = await prisma.contentItem.findMany({
            where: {
                status: 'deferred',
                assets: { not: undefined }
            },
            include: {
                channel: true
            }
        });

        for (const task of deferredTasks) {
            const plan = await this.loadPublicationPlanContext(task.project_id);
            if (!plan) continue;

            const reactivation = await this.shouldReactivateDeferredTask(task, plan);
            if (!reactivation.ready) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        quality_report: {
                            ...((task.quality_report as any) || {}),
                            last_reactivation_check_at: new Date().toISOString(),
                            reactivation_wait_reason: reactivation.reason
                        } as any
                    }
                });
                continue;
            }

            await prisma.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'planned',
                    quality_report: {
                        ...((task.quality_report as any) || {}),
                        reactivated_at: new Date().toISOString(),
                        reactivation_wait_reason: null
                    } as any
                }
            });
            reactivatedCount += 1;
        }

        return reactivatedCount;
    }
}

export const ongoingRulesProcessor = new OngoingRulesProcessor();
