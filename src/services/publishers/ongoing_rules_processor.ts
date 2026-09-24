import prisma from '../../db';
import gscService from '../gsc.service';
import linkedinService from '../linkedin.service';
import redditService from '../reddit.service';
import { parseRecurringTrigger } from '../publication_runtime.helpers';
import { logToFile } from './publisher_logger';

export interface OngoingRulePlan {
    projectId: number;
    meta: Record<string, any>;
    ongoing_rules: Array<Record<string, any>>;
    measurement: Record<string, any>;
}

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
        if (!ref) return null;
        const parts = ref.split('.');
        let current: any = plan;
        for (const part of parts) {
            if (current == null) return null;
            current = current[part];
        }
        return current ?? null;
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
            const timezone = plan.meta.timezone_default || 'UTC';
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
            const cycleStart = plan.meta.cycle_start ? new Date(plan.meta.cycle_start) : null;
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
        const measurement = (task.assets as any)?.measurement || plan.measurement || {};
        const metricDefs = Array.isArray(measurement.metrics) ? measurement.metrics : [];
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;

        const results: Record<string, any> = {};
        for (const metricDef of metricDefs) {
            if (!metricDef?.id) continue;

            if (metricDef.source === 'gsc' && metricDef.url_ref && gscChannel) {
                const url = this.resolvePlanRef(plan, metricDef.url_ref) as string | null;
                results[metricDef.id] = url
                    ? await gscService.queryPageMetrics((gscChannel.config as any).raw_account || gscChannel.config, url).catch((error: any) => ({ error: error.message }))
                    : { error: 'Missing URL reference' };
                continue;
            }

            if (metricDef.source === 'linkedin_analytics') {
                const linkedinTasks = await prisma.contentItem.findMany({
                    where: {
                        project_id: task.project_id,
                        status: 'published',
                        channel: { type: 'linkedin' }
                    },
                    include: { channel: true }
                });

                results[metricDef.id] = await Promise.all(linkedinTasks.map(async (item) => {
                    const config: any = item.channel?.config || {};
                    if (!config.linkedin_urn || !config.access_token || !item.published_link) {
                        return { task_id: (item.metrics as any)?.task_id || null, error: 'Missing LinkedIn credentials or link.' };
                    }

                    const metrics = await linkedinService.getMetrics(config.linkedin_urn, config.access_token, item.published_link).catch((error: any) => ({ error: error.message }));
                    return {
                        task_id: (item.metrics as any)?.task_id || null,
                        title: item.title,
                        metrics
                    };
                }));
                continue;
            }

            if (metricDef.source === 'reddit') {
                const redditTasks = await prisma.contentItem.findMany({
                    where: {
                        project_id: task.project_id,
                        status: 'published',
                        channel: { type: 'reddit' }
                    }
                });

                results[metricDef.id] = await Promise.all(redditTasks.map(async (item) => ({
                    task_id: (item.metrics as any)?.task_id || null,
                    title: item.title,
                    metrics: item.published_link
                        ? await redditService.getPostMetrics(item.published_link).catch((error: any) => ({ error: error.message }))
                        : { error: 'Missing Reddit permalink.' }
                })));
                continue;
            }

            results[metricDef.id] = { unsupported: true, source: metricDef.source };
        }

        return results;
    }

    async executeGscHealthAudit(task: any, plan: any) {
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;
        if (!gscChannel) {
            return { error: 'No Google Search Console channel configured.' };
        }

        const candidateUrls = Object.values(plan.assets || {})
            .map((asset: any) => asset?.target_url)
            .filter((url): url is string => typeof url === 'string' && url.startsWith('https://'));

        const uniqueUrls = Array.from(new Set(candidateUrls));
        const inspections = await Promise.all(uniqueUrls.map(async (url) => ({
            url,
            inspection: await gscService.inspectUrl((gscChannel.config as any).raw_account || gscChannel.config, url).catch((error: any) => ({ error: error.message }))
        })));

        return {
            checked_urls: inspections.length,
            inspections
        };
    }

    async executeMediumCanonicalVerification(task: any, plan: any) {
        const sourceTaskId = (task.assets as any)?.source_task_id;
        const sourceTask = sourceTaskId
            ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } })
            : null;

        const mediumTask = sourceTask || await prisma.contentItem.findFirst({
            where: {
                project_id: task.project_id,
                type: 'medium:republish_with_canonical',
                status: 'published'
            },
            orderBy: { updated_at: 'desc' }
        });

        if (!mediumTask?.published_link) {
            return { error: 'No published Medium task found for canonical verification.' };
        }

        const response = await fetch(mediumTask.published_link).catch(() => null);
        if (!response?.ok) {
            return { error: `Unable to fetch Medium page: ${mediumTask.published_link}` };
        }

        const html = await response.text();
        const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
        const actualCanonical = canonicalMatch?.[1] || null;
        const expectedCanonical = this.resolvePlanRef(plan, 'assets.article_blog.target_url') as string | null;

        return {
            medium_url: mediumTask.published_link,
            expected_canonical: expectedCanonical,
            actual_canonical: actualCanonical,
            valid: Boolean(actualCanonical && expectedCanonical && actualCanonical === expectedCanonical)
        };
    }

    async executeInternalLinkCrawl(_task: any, plan: any) {
        const candidateUrls = Object.values(plan.assets || {})
            .map((asset: any) => asset?.target_url)
            .filter((url): url is string => typeof url === 'string' && url.startsWith('https://seturon.com'));

        const uniqueUrls = Array.from(new Set(candidateUrls));
        const results = await Promise.all(uniqueUrls.map(async (url) => {
            const response = await fetch(url).catch(() => null);
            if (!response?.ok) {
                return { url, ok: false, status: response?.status || null };
            }
            const html = await response.text();
            const internalLinks = Array.from(html.matchAll(/href=["'](https:\/\/seturon\.com[^"']+)["']/g)).map((match) => match[1]);
            return {
                url,
                ok: true,
                status: response.status,
                internal_link_count: internalLinks.length
            };
        }));

        return {
            checked_urls: results.length,
            results
        };
    }

    async markInternalTaskAsManual(task: any, reason: string) {
        await prisma.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'awaiting_manual_publication',
                quality_report: {
                    ...((task.quality_report as any) || {}),
                    execution_result: {
                        mode: 'manual_required',
                        reason
                    },
                    prepared_at: new Date().toISOString()
                } as any
            }
        });
    }

    async createGeneratedPublicationTask(params: {
        projectId: number;
        channelId: number | null;
        type: string;
        layer: string;
        title: string;
        brief: string;
        scheduleAt?: Date | null;
        draftText?: string | null;
        sourceTaskId?: number | null;
        action: any;
        accountRef?: string | null;
        assetRefs?: string[];
        extraMetrics?: Record<string, any>;
    }) {
        return prisma.contentItem.create({
            data: {
                project_id: params.projectId,
                channel_id: params.channelId,
                type: params.type,
                layer: params.layer,
                title: params.title,
                brief: params.brief,
                draft_text: params.draftText || null,
                status: 'planned',
                schedule_at: params.scheduleAt || null,
                cross_link_to: params.sourceTaskId ? [params.sourceTaskId] : [],
                assets: {
                    source: 'ongoing_rule_generated',
                    action: params.action,
                    account_ref: params.accountRef || null,
                    asset_refs: params.assetRefs || [],
                    source_task_id: params.sourceTaskId || null
                } as any,
                quality_report: {
                    execution_mode: 'manual',
                    generated_by_rule: true,
                    blocking_conditions: params.action?.blocking_conditions || [],
                    human_review: params.action?.human_review !== false,
                    human_review_reason: params.action?.human_review_reason || null,
                    display_name: params.action?.display_name || params.title
                } as any,
                metrics: {
                    rule_generated: true,
                    task_id: params.action?.id || null,
                    task_display_name: params.action?.display_name || params.title,
                    account_ref: params.accountRef || null,
                    ...(params.extraMetrics || {})
                } as any
            }
        });
    }

    async executeBrandRepostRule(task: any, _plan: any) {
        const sourceTaskId = (task.assets as any)?.source_task_id;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask?.published_link) {
            return { skipped: true, reason: 'Source LinkedIn post is missing or not published yet.' };
        }

        const sourceAction = (sourceTask.assets as any)?.action || {};
        const sourceAssets = (sourceTask.assets as any)?.resolved_assets || [];
        const sourceAngle = sourceAssets.find((assetEntry: any) => assetEntry?.asset?.angle)?.asset?.angle || null;
        const exclusions = Array.isArray((task.assets as any)?.rule?.exclusions) ? (task.assets as any).rule.exclusions : [];
        if (exclusions.some((exclusion: any) => exclusion.angle === sourceAngle)) {
            return { skipped: true, reason: `Source angle \`${sourceAngle}\` is excluded from brand reposts.` };
        }

        const brandChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin',
                config: {
                    path: ['raw_account', 'type'],
                    equals: 'company_page'
                }
            }
        }) || await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin'
            }
        });

        if (!brandChannel) {
            return { skipped: true, reason: 'No LinkedIn brand page channel is configured.' };
        }

        const frameTemplate = (task.assets as any)?.rule?.repost_frame_template || 'From our founder: {one_or_two_sentence_relevance_for_creators}';
        const draftText = `${frameTemplate}\n\nSource post: ${sourceTask.published_link}`;
        const scheduledAt = new Date(sourceTask.updated_at.getTime() + 2 * 60 * 60 * 1000);
        const generatedActionId = `rule-repost-${sourceTask.id}`;

        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: brandChannel.id,
            type: 'linkedin:repost_with_frame',
            layer: 'linkedin',
            title: `LinkedIn Seturon page — Repost founder post: ${sourceTask.title || sourceAction.id || sourceTask.id}`,
            brief: 'Brand repost generated from founder post per ongoing rule.',
            scheduleAt: scheduledAt,
            draftText,
            sourceTaskId: sourceTask.id,
            accountRef: brandChannel.name,
            action: {
                id: generatedActionId,
                display_name: `LinkedIn Seturon page — Repost founder post`,
                channel: 'linkedin',
                action_type: 'repost_with_frame',
                account_ref: brandChannel.name,
                scheduled_date: scheduledAt.toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: (task.assets as any)?.rule?.human_review_reason || 'Approve brand frame before reposting.',
                parameters: {
                    repost_source_url: sourceTask.published_link,
                    frame_template: frameTemplate
                },
                asset_refs: []
            },
            extraMetrics: {
                rule_generated_from_source_task: sourceTask.id
            }
        });

        return {
            created_task_id: createdTask.id,
            source_task_id: sourceTask.id
        };
    }

    async executeBrandRotationRule(task: any, plan: any) {
        const rule = (task.assets as any)?.rule || {};
        const slots = Array.isArray(rule.rotation_slots_in_order) && rule.rotation_slots_in_order.length > 0
            ? rule.rotation_slots_in_order
            : ['A', 'B', 'C', 'D'];
        const stateKey = 'brand_rotation_current_slot';
        const storedState = await prisma.projectSettings.findUnique({
            where: {
                project_id_key: {
                    project_id: task.project_id,
                    key: stateKey
                }
            }
        });
        const currentSlot = storedState?.value || slots[0];

        const assetEntry = Object.entries(plan.assets || {}).find(([, asset]: any) => asset?.rotation_slot === currentSlot);
        if (!assetEntry) {
            return { skipped: true, reason: `No asset found for brand rotation slot ${currentSlot}.` };
        }

        const [assetRef, asset] = assetEntry as [string, any];
        const brandChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin',
                config: {
                    path: ['raw_account', 'type'],
                    equals: 'company_page'
                }
            }
        }) || await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin'
            }
        });
        if (!brandChannel) {
            return { skipped: true, reason: 'No LinkedIn brand page channel is configured.' };
        }

        const existingGenerated = await prisma.contentItem.findFirst({
            where: {
                project_id: task.project_id,
                metrics: {
                    path: ['rule_generated_rotation_slot'],
                    equals: currentSlot
                },
                status: { in: ['planned', 'ready_for_execution', 'awaiting_manual_publication', 'published'] }
            }
        });
        if (existingGenerated) {
            return { skipped: true, reason: `A task for rotation slot ${currentSlot} already exists.` };
        }

        const nextIndex = (slots.indexOf(currentSlot) + 1) % slots.length;
        const nextSlot = slots[nextIndex] || slots[0];
        const scheduleAt = task.schedule_at || new Date();

        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: brandChannel.id,
            type: 'linkedin:post_with_comment_link',
            layer: 'linkedin',
            title: `LinkedIn Seturon page — Rotation slot ${currentSlot}`,
            brief: `Brand page post draft prepared for rotation slot ${currentSlot}.`,
            scheduleAt,
            sourceTaskId: null,
            accountRef: brandChannel.name,
            assetRefs: [assetRef],
            action: {
                id: `rule-brand-slot-${currentSlot}-${scheduleAt.toISOString().slice(0, 10)}`,
                display_name: `LinkedIn Seturon page — Rotation slot ${currentSlot}`,
                channel: 'linkedin',
                action_type: 'post_with_comment_link',
                account_ref: brandChannel.name,
                scheduled_date: scheduleAt.toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: rule.human_review_reason || 'Approve brand-page post draft before publishing.',
                parameters: {
                    post_body_source: asset.section_marker || asset.path,
                    link_location: 'first_comment_only',
                    link_url_ref: asset.links_to ? `assets.${asset.links_to}.target_url` : null,
                    rotation_slot_used: currentSlot,
                    rotation_slot_next: nextSlot
                },
                asset_refs: [assetRef]
            },
            extraMetrics: {
                rule_generated_rotation_slot: currentSlot
            }
        });

        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: task.project_id,
                    key: stateKey
                }
            },
            update: { value: nextSlot },
            create: {
                project_id: task.project_id,
                key: stateKey,
                value: nextSlot
            }
        });

        return {
            created_task_id: createdTask.id,
            used_slot: currentSlot,
            next_slot: nextSlot
        };
    }

    async executeKnowledgeHubRule(task: any, plan: any) {
        const sourceTaskId = (task.assets as any)?.source_task_id;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask) {
            return { skipped: true, reason: 'Source knowledge task not found.' };
        }

        const hubAsset = (plan.assets || {}).knowledge_hub_page;
        if (!hubAsset) {
            return { skipped: true, reason: 'knowledge_hub_page asset is missing from the plan.' };
        }

        const tildaChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'tilda'
            }
        });
        if (!tildaChannel) {
            return { skipped: true, reason: 'No Tilda channel is configured.' };
        }

        const sourceAction = (sourceTask.assets as any)?.action || {};
        const publishedUrl = sourceTask.published_link || this.resolvePlanRef(plan, sourceAction.asset_refs?.[0] ? `assets.${sourceAction.asset_refs[0]}.target_url` : null);

        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: tildaChannel.id,
            type: 'tilda:append_article_card_to_knowledge_hub',
            layer: 'tilda',
            title: `Tilda — Update knowledge hub after ${sourceTask.title || sourceTask.id}`,
            brief: 'Append the newly published knowledge article to the /knowledge/ hub page.',
            scheduleAt: new Date(),
            sourceTaskId: sourceTask.id,
            accountRef: tildaChannel.name,
            assetRefs: ['knowledge_hub_page'],
            action: {
                id: `rule-knowledge-hub-${sourceTask.id}`,
                display_name: `Tilda — Append article card to /knowledge/ hub`,
                channel: 'tilda',
                action_type: 'append_article_card_to_knowledge_hub',
                account_ref: tildaChannel.name,
                scheduled_date: new Date().toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: (task.assets as any)?.rule?.human_review_reason || 'Confirm category placement before updating the hub page.',
                parameters: {
                    target_asset_ref: 'knowledge_hub_page',
                    article_url: publishedUrl,
                    article_title: sourceTask.title
                },
                asset_refs: ['knowledge_hub_page']
            },
            extraMetrics: {
                rule_generated_from_source_task: sourceTask.id,
                target_url: hubAsset.target_url
            }
        });

        return {
            created_task_id: createdTask.id,
            source_task_id: sourceTask.id
        };
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
