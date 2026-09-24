import prisma from '../../db';
import gscService from '../gsc.service';
import linkedinService from '../linkedin.service';
import redditService from '../reddit.service';
import { PublicationPlanContext, TaskWithAssets } from './types';

/**
 * Resolves a dot-notated property reference against a publication plan object.
 *
 * @param plan - The publication plan object or null/undefined
 * @param ref - Dot-notated string path, e.g. "assets.article_blog.target_url"
 * @returns The resolved value, or null if not found
 */
export function resolvePlanRef(plan: unknown, ref?: string | null): unknown {
    if (!ref) return null;
    const parts = ref.split('.');
    let current: unknown = plan;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[part];
    }
    return current ?? null;
}

export interface GeneratedPublicationTaskParams {
    projectId: number;
    channelId: number | null;
    type: string;
    layer: string;
    title: string;
    brief: string;
    scheduleAt?: Date | null;
    draftText?: string | null;
    sourceTaskId?: number | null;
    action: Record<string, unknown>;
    accountRef?: string | null;
    assetRefs?: string[];
    extraMetrics?: Record<string, unknown>;
}

export class OperationalTaskActions {
    resolvePlanRef(plan: unknown, ref?: string | null): unknown {
        return resolvePlanRef(plan, ref);
    }

    async markInternalTaskAsManual(task: { id: number; quality_report?: unknown }, reason: string): Promise<void> {
        const qualityReport = (task.quality_report as Record<string, unknown>) || {};
        await prisma.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'awaiting_manual_publication',
                quality_report: {
                    ...qualityReport,
                    execution_result: {
                        mode: 'manual_required',
                        reason
                    },
                    prepared_at: new Date().toISOString()
                } as any
            }
        });
    }

    async createGeneratedPublicationTask(params: GeneratedPublicationTaskParams) {
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
                    blocking_conditions: (params.action?.blocking_conditions as unknown[]) || [],
                    human_review: params.action?.human_review !== false,
                    human_review_reason: (params.action?.human_review_reason as string) || null,
                    display_name: (params.action?.display_name as string) || params.title
                } as any,
                metrics: {
                    rule_generated: true,
                    task_id: (params.action?.id as string) || null,
                    task_display_name: (params.action?.display_name as string) || params.title,
                    account_ref: params.accountRef || null,
                    ...(params.extraMetrics || {})
                } as any
            }
        });
    }

    async executeMeasurementSnapshot(
        task: TaskWithAssets,
        plan: PublicationPlanContext
    ): Promise<Record<string, unknown>> {
        const taskAssets = task.assets as Record<string, unknown> | undefined;
        const measurement = (taskAssets?.measurement as Record<string, unknown>) || plan.measurement || {};
        const metricDefs = Array.isArray(measurement.metrics)
            ? (measurement.metrics as Array<Record<string, unknown>>)
            : [];
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;

        const results: Record<string, unknown> = {};
        for (const metricDef of metricDefs) {
            const metricId = String(metricDef?.id || '');
            if (!metricId) continue;

            if (metricDef.source === 'gsc' && metricDef.url_ref && gscChannel) {
                const url = resolvePlanRef(plan, String(metricDef.url_ref)) as string | null;
                const gscConfig = (gscChannel.config as Record<string, unknown>) || {};
                results[metricId] = url
                    ? await gscService
                          .queryPageMetrics((gscConfig.raw_account as any) || gscConfig, url)
                          .catch((error: Error) => ({ error: error.message }))
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

                results[metricId] = await Promise.all(
                    linkedinTasks.map(async (item) => {
                        const config = (item.channel?.config as Record<string, unknown>) || {};
                        const urn = config.linkedin_urn as string | undefined;
                        const token = config.access_token as string | undefined;
                        const itemMetrics = item.metrics as Record<string, unknown> | null;
                        if (!urn || !token || !item.published_link) {
                            return {
                                task_id: itemMetrics?.task_id || null,
                                error: 'Missing LinkedIn credentials or link.'
                            };
                        }

                        const metrics = await linkedinService
                            .getMetrics(urn, token, item.published_link)
                            .catch((error: Error) => ({ error: error.message }));
                        return {
                            task_id: itemMetrics?.task_id || null,
                            title: item.title,
                            metrics
                        };
                    })
                );
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

                results[metricId] = await Promise.all(
                    redditTasks.map(async (item) => {
                        const itemMetrics = item.metrics as Record<string, unknown> | null;
                        return {
                            task_id: itemMetrics?.task_id || null,
                            title: item.title,
                            metrics: item.published_link
                                ? await redditService
                                      .getPostMetrics(item.published_link)
                                      .catch((error: Error) => ({ error: error.message }))
                                : { error: 'Missing Reddit permalink.' }
                        };
                    })
                );
                continue;
            }

            results[metricId] = { unsupported: true, source: metricDef.source };
        }

        return results;
    }

    async executeGscHealthAudit(task: TaskWithAssets, plan: PublicationPlanContext) {
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;
        if (!gscChannel) {
            return { error: 'No Google Search Console channel configured.' };
        }

        const candidateUrls = Object.values(plan.assets || {})
            .map((asset) => asset?.target_url)
            .filter((url): url is string => typeof url === 'string' && url.startsWith('https://'));

        const uniqueUrls = Array.from(new Set(candidateUrls));
        const gscConfig = (gscChannel.config as Record<string, unknown>) || {};
        const inspections = await Promise.all(
            uniqueUrls.map(async (url) => ({
                url,
                inspection: await gscService
                    .inspectUrl((gscConfig.raw_account as any) || gscConfig, url)
                    .catch((error: Error) => ({ error: error.message }))
            }))
        );

        return {
            checked_urls: inspections.length,
            inspections
        };
    }

    async executeMediumCanonicalVerification(task: TaskWithAssets, plan: PublicationPlanContext) {
        const taskAssets = task.assets as Record<string, unknown> | undefined;
        const sourceTaskId = taskAssets?.source_task_id as number | undefined;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;

        const mediumTask =
            sourceTask ||
            (await prisma.contentItem.findFirst({
                where: {
                    project_id: task.project_id,
                    type: 'medium:republish_with_canonical',
                    status: 'published'
                },
                orderBy: { updated_at: 'desc' }
            }));

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
        const expectedCanonical = resolvePlanRef(plan, 'assets.article_blog.target_url') as string | null;

        return {
            medium_url: mediumTask.published_link,
            expected_canonical: expectedCanonical,
            actual_canonical: actualCanonical,
            valid: Boolean(actualCanonical && expectedCanonical && actualCanonical === expectedCanonical)
        };
    }

    async executeInternalLinkCrawl(_task: TaskWithAssets, plan: PublicationPlanContext) {
        const candidateUrls = Object.values(plan.assets || {})
            .map((asset) => asset?.target_url)
            .filter((url): url is string => typeof url === 'string' && url.startsWith('https://seturon.com'));

        const uniqueUrls = Array.from(new Set(candidateUrls));
        const results = await Promise.all(
            uniqueUrls.map(async (url) => {
                const response = await fetch(url).catch(() => null);
                if (!response?.ok) {
                    return { url, ok: false, status: response?.status || null };
                }
                const html = await response.text();
                const internalLinks = Array.from(html.matchAll(/href=["'](https:\/\/seturon\.com[^"']+)["']/g)).map(
                    (match) => match[1]
                );
                return {
                    url,
                    ok: true,
                    status: response.status,
                    internal_link_count: internalLinks.length
                };
            })
        );

        return {
            checked_urls: results.length,
            results
        };
    }

    async executeBrandRepostRule(task: TaskWithAssets, _plan: PublicationPlanContext) {
        const taskAssets = task.assets as Record<string, unknown> | undefined;
        const sourceTaskId = taskAssets?.source_task_id as number | undefined;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask?.published_link) {
            return { skipped: true, reason: 'Source LinkedIn post is missing or not published yet.' };
        }

        const sourceAssetsObj = (sourceTask.assets as Record<string, unknown>) || {};
        const sourceAction = (sourceAssetsObj.action as Record<string, unknown>) || {};
        const sourceAssets = (sourceAssetsObj.resolved_assets as Array<Record<string, unknown>>) || [];
        const sourceAngle =
            (sourceAssets.find((assetEntry) => (assetEntry?.asset as Record<string, unknown>)?.angle)
                ?.asset as Record<string, unknown>)?.angle || null;

        const ruleObj = (taskAssets?.rule as Record<string, unknown>) || {};
        const exclusions = Array.isArray(ruleObj.exclusions)
            ? (ruleObj.exclusions as Array<Record<string, unknown>>)
            : [];
        if (exclusions.some((exclusion) => exclusion.angle === sourceAngle)) {
            return { skipped: true, reason: `Source angle \`${sourceAngle}\` is excluded from brand reposts.` };
        }

        const brandChannel =
            (await prisma.socialChannel.findFirst({
                where: {
                    project_id: task.project_id,
                    type: 'linkedin',
                    config: {
                        path: ['raw_account', 'type'],
                        equals: 'company_page'
                    }
                }
            })) ||
            (await prisma.socialChannel.findFirst({
                where: {
                    project_id: task.project_id,
                    type: 'linkedin'
                }
            }));

        if (!brandChannel) {
            return { skipped: true, reason: 'No LinkedIn brand page channel is configured.' };
        }

        const frameTemplate =
            (ruleObj.repost_frame_template as string) ||
            'From our founder: {one_or_two_sentence_relevance_for_creators}';
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
                human_review_reason:
                    (ruleObj.human_review_reason as string) || 'Approve brand frame before reposting.',
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

    async executeBrandRotationRule(task: TaskWithAssets, plan: PublicationPlanContext) {
        const taskAssets = task.assets as Record<string, unknown> | undefined;
        const rule = (taskAssets?.rule as Record<string, unknown>) || {};
        const slots =
            Array.isArray(rule.rotation_slots_in_order) && rule.rotation_slots_in_order.length > 0
                ? (rule.rotation_slots_in_order as string[])
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

        const assetEntry = Object.entries(plan.assets || {}).find(
            ([, asset]) => asset?.rotation_slot === currentSlot
        );
        if (!assetEntry) {
            return { skipped: true, reason: `No asset found for brand rotation slot ${currentSlot}.` };
        }

        const [assetRef, asset] = assetEntry;
        const brandChannel =
            (await prisma.socialChannel.findFirst({
                where: {
                    project_id: task.project_id,
                    type: 'linkedin',
                    config: {
                        path: ['raw_account', 'type'],
                        equals: 'company_page'
                    }
                }
            })) ||
            (await prisma.socialChannel.findFirst({
                where: {
                    project_id: task.project_id,
                    type: 'linkedin'
                }
            }));
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
                human_review_reason:
                    (rule.human_review_reason as string) || 'Approve brand-page post draft before publishing.',
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

    async executeKnowledgeHubRule(task: TaskWithAssets, plan: PublicationPlanContext) {
        const taskAssets = task.assets as Record<string, unknown> | undefined;
        const sourceTaskId = taskAssets?.source_task_id as number | undefined;
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

        const sourceAssetsObj = (sourceTask.assets as Record<string, unknown>) || {};
        const sourceAction = (sourceAssetsObj.action as Record<string, unknown>) || {};
        const assetRefs = (sourceAction.asset_refs as string[]) || [];
        const publishedUrl =
            sourceTask.published_link ||
            (resolvePlanRef(plan, assetRefs[0] ? `assets.${assetRefs[0]}.target_url` : null) as string | null);

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
                human_review_reason:
                    ((taskAssets?.rule as Record<string, unknown>)?.human_review_reason as string) ||
                    'Confirm category placement before updating the hub page.',
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
}

export const operationalTaskActions = new OperationalTaskActions();
