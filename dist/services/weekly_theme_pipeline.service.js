"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../db"));
const work_queue_service_1 = __importDefault(require("./work_queue.service"));
function isoDate(value, field) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`[INVALID_${field.toUpperCase()}] Expected YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()))
        throw new Error(`[INVALID_${field.toUpperCase()}] Invalid date`);
    return parsed;
}
function addUtcDays(date, days) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}
function dateOnly(date) {
    return date.toISOString().slice(0, 10);
}
function zonedLocalToUtc(date, time, timezone) {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
        const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
        guess += Date.UTC(year, month - 1, day, hour, minute, 0) - represented;
    }
    return new Date(guess);
}
function proposalPayload(dayIndex, themeTitle, themeItemId, revision) {
    const functions = ['frame', 'diagnose', 'demonstrate', 'contrast', 'apply', 'reflect', 'synthesize'];
    return {
        day_index: dayIndex,
        thesis: `${themeTitle}: фокус дня ${dayIndex}`,
        function: functions[dayIndex - 1],
        source: { theme_content_item_id: themeItemId, theme_revision: revision },
        difference_from_neighbors: `Самостоятельный ракурс ${dayIndex} из 7`
    };
}
class WeeklyThemePipelineService {
    async cachedResult(tx, projectId, actorId, command, idempotencyKey) {
        const event = await tx.workflowEvent.findUnique({
            where: { project_id_actor_id_command_idempotency_key: {
                    project_id: projectId,
                    actor_id: actorId,
                    command,
                    idempotency_key: idempotencyKey
                } }
        });
        return event?.after_state;
    }
    async upsertWeekTheme(input) {
        return db_1.default.$transaction(async (tx) => {
            await work_queue_service_1.default.assertProjectAccess(tx, input.projectId, input.actorId, 'work_queue:decide');
            const cached = await this.cachedResult(tx, input.projectId, input.actorId, 'ba_upsert_week_theme', input.idempotencyKey);
            if (cached)
                return cached;
            const channel = await tx.socialChannel.findFirst({ where: { id: input.channelId, project_id: input.projectId } });
            if (!channel)
                throw new Error(`[CHANNEL_NOT_FOUND] Channel ${input.channelId} does not belong to project ${input.projectId}`);
            const weekStart = isoDate(input.targetWeekStart, 'week_start');
            const weekEnd = isoDate(input.targetWeekEnd, 'week_end');
            if (weekStart.getUTCDay() !== 1 || weekEnd.getTime() - weekStart.getTime() !== 6 * 24 * 60 * 60 * 1000) {
                throw new Error('[INVALID_WEEK_RANGE] Target week must span Monday through Sunday');
            }
            const weekPackage = await tx.weekPackage.upsert({
                where: { project_id_week_start_week_end: { project_id: input.projectId, week_start: weekStart, week_end: weekEnd } },
                update: {},
                create: {
                    project_id: input.projectId,
                    week_start: weekStart,
                    week_end: weekEnd,
                    timezone: input.timezone,
                    week_theme: input.title,
                    core_thesis: input.body,
                    approval_status: 'draft'
                }
            });
            await tx.$queryRaw(client_1.Prisma.sql `SELECT id FROM planner.week_packages WHERE id = ${weekPackage.id} FOR UPDATE`);
            const themeKey = `week-theme:${weekPackage.id}:${input.channelId}`;
            const existing = await tx.contentItem.findFirst({ where: { project_id: input.projectId, week_package_id: weekPackage.id, item_key: themeKey } });
            const currentRevision = existing?.content_revision || 0;
            if (input.expectedRevision !== currentRevision) {
                throw new Error(`[THEME_REVISION_CONFLICT] Expected revision ${input.expectedRevision}, current revision ${currentRevision}`);
            }
            const nextRevision = currentRevision + 1;
            const acceptedAt = input.acceptedAt ? new Date(input.acceptedAt) : null;
            if (input.state === 'accepted' && (!acceptedAt || Number.isNaN(acceptedAt.getTime()))) {
                throw new Error('[INVALID_ACCEPTED_AT] Accepted theme requires a valid acceptedAt');
            }
            const sourceRefs = [
                ...input.sourceRefs,
                { type: 'week_theme_meta', state: input.state, accepted_at: acceptedAt?.toISOString() || null }
            ];
            const theme = existing
                ? await tx.contentItem.update({
                    where: { id: existing.id },
                    data: { title: input.title, brief: input.body, source_refs: sourceRefs, status: input.state, content_revision: nextRevision, channel_id: input.channelId }
                })
                : await tx.contentItem.create({
                    data: {
                        project_id: input.projectId, week_package_id: weekPackage.id, channel_id: input.channelId,
                        type: 'week_theme', title: input.title, brief: input.body, source_refs: sourceRefs,
                        status: input.state, content_revision: nextRevision, item_key: themeKey
                    }
                });
            await tx.weekPackage.update({
                where: { id: weekPackage.id },
                data: { week_theme: input.title, core_thesis: input.body, timezone: input.timezone, plan_version: null, approval_status: 'draft' }
            });
            const result = {
                week_package_id: weekPackage.id,
                theme_content_item_id: theme.id,
                theme_revision: nextRevision,
                state: input.state,
                accepted_at: acceptedAt?.toISOString() || null
            };
            await tx.workflowEvent.create({ data: {
                    project_id: input.projectId, week_package_id: weekPackage.id, content_item_id: theme.id,
                    actor_id: input.actorId, command: 'ba_upsert_week_theme', after_state: result,
                    idempotency_key: input.idempotencyKey
                } });
            return result;
        });
    }
    async generatePreview(input) {
        return db_1.default.$transaction(async (tx) => {
            await work_queue_service_1.default.assertProjectAccess(tx, input.projectId, input.actorId, 'work_queue:decide');
            const cached = await this.cachedResult(tx, input.projectId, input.actorId, 'ba_generate_week_topic_preview', input.idempotencyKey);
            if (cached)
                return cached;
            const weekPackage = await tx.weekPackage.findFirst({ where: { id: input.weekPackageId, project_id: input.projectId } });
            if (!weekPackage)
                throw new Error('[WEEK_THEME_NOT_FOUND] Weekly theme was not found in the requested project and package');
            await tx.$queryRaw(client_1.Prisma.sql `SELECT id FROM planner.week_packages WHERE id = ${weekPackage.id} FOR UPDATE`);
            const theme = await tx.contentItem.findFirst({ where: {
                    id: input.themeContentItemId, project_id: input.projectId, week_package_id: input.weekPackageId,
                    channel_id: input.channelId, type: 'week_theme'
                } });
            if (!theme)
                throw new Error('[WEEK_THEME_NOT_FOUND] Weekly theme was not found in the requested project and package');
            if (theme.content_revision !== input.themeRevision)
                throw new Error('[STALE_THEME_REVISION] Requested theme revision is no longer current');
            if (theme.status !== 'accepted')
                throw new Error('[WEEK_THEME_NOT_APPROVED] Weekly theme must be accepted before preview generation');
            const refs = Array.isArray(theme.source_refs) ? theme.source_refs : [];
            const meta = refs.find((ref) => ref.type === 'week_theme_meta');
            const acceptedAt = typeof meta?.accepted_at === 'string' ? new Date(meta.accepted_at) : null;
            const cutoffDate = dateOnly(addUtcDays(weekPackage.week_start, -2));
            const cutoff = zonedLocalToUtc(cutoffDate, '18:00', input.timezone);
            if (!acceptedAt || acceptedAt > cutoff)
                throw new Error('[WEEK_THEME_LATE] Weekly theme was accepted after Saturday 18:00 local cutoff');
            if (process.env.WEEK_TOPIC_GENERATOR_MODE !== 'deterministic_test') {
                throw new Error('[TOPIC_GENERATOR_NOT_CONFIGURED] Slice A requires an explicit topic generator mode');
            }
            const normalizedDays = [...input.scheduleTemplate.days].sort((a, b) => a - b);
            if (normalizedDays.length !== 7 || normalizedDays.some((day, index) => day !== index + 1)) {
                throw new Error('[INVALID_SCHEDULE_TEMPLATE] Preview requires seven unique day positions');
            }
            const versionSeed = `${input.weekPackageId}:${input.themeRevision}:${input.channelId}:${input.scheduleTemplate.localTime}`;
            const planVersion = `theme-r${input.themeRevision}-${(0, crypto_1.createHash)('sha256').update(versionSeed).digest('hex').slice(0, 12)}`;
            const proposals = [];
            for (let index = 0; index < 7; index += 1) {
                const dayIndex = index + 1;
                const localDate = dateOnly(addUtcDays(weekPackage.week_start, index));
                const publishAt = zonedLocalToUtc(localDate, input.scheduleTemplate.localTime, input.timezone);
                const proposal = proposalPayload(dayIndex, theme.title || 'Weekly theme', theme.id, theme.content_revision);
                const itemKey = `week-topic:${weekPackage.id}:r${theme.content_revision}:day${dayIndex}`;
                const existingTopic = await tx.contentItem.findFirst({ where: { project_id: input.projectId, item_key: itemKey } });
                const contentItem = existingTopic || await tx.contentItem.create({
                    data: {
                        project_id: input.projectId, week_package_id: weekPackage.id, channel_id: input.channelId,
                        type: 'tg_post', title: proposal.thesis, brief: theme.brief,
                        key_points: proposal,
                        source_refs: [proposal.source],
                        status: 'planned', item_key: itemKey, schedule_at: publishAt, publish_at: publishAt,
                        publication_mode: 'automatic'
                    }
                });
                proposals.push({ id: contentItem.id, local_date: localDate, publish_at: publishAt.toISOString(), ...proposal });
            }
            await tx.weekPackage.update({ where: { id: weekPackage.id }, data: { plan_version: planVersion, approval_status: 'needs_review' } });
            const result = { week_package_id: weekPackage.id, plan_version: planVersion, theme_revision: theme.content_revision, approval_status: 'awaiting_plan_approval', proposals };
            await tx.workflowEvent.create({ data: {
                    project_id: input.projectId, week_package_id: weekPackage.id, content_item_id: theme.id,
                    actor_id: input.actorId, command: 'ba_generate_week_topic_preview', after_state: result,
                    idempotency_key: input.idempotencyKey
                } });
            return result;
        });
    }
    async getPipeline(input) {
        await work_queue_service_1.default.assertProjectAccess(db_1.default, input.projectId, input.actorId, 'work_queue:read');
        const weekPackage = await db_1.default.weekPackage.findFirst({ where: { id: input.weekPackageId, project_id: input.projectId } });
        if (!weekPackage)
            throw new Error(`WeekPackage ${input.weekPackageId} not found in project ${input.projectId}`);
        const theme = await db_1.default.contentItem.findFirst({ where: { week_package_id: weekPackage.id, type: 'week_theme' }, orderBy: { updated_at: 'desc' } });
        const topics = await db_1.default.contentItem.findMany({
            where: { week_package_id: weekPackage.id, type: { not: 'week_theme' }, item_key: { startsWith: `week-topic:${weekPackage.id}:r${theme?.content_revision || 0}:` } },
            orderBy: { publish_at: 'asc' }
        });
        const decisionEvent = await db_1.default.workflowEvent.findFirst({
            where: { project_id: input.projectId, week_package_id: weekPackage.id, command: 'ba_decide_week_plan' }, orderBy: { created_at: 'desc' }
        });
        const decision = decisionEvent?.after_state;
        return {
            week_package_id: weekPackage.id,
            plan_version: weekPackage.plan_version,
            theme_revision: theme?.content_revision || null,
            approval: decision ? { decision: decision.decision, comment: decision.comment || null } : { decision: null, comment: null },
            days: topics.map((item) => ({
                id: item.id,
                local_date: item.publish_at?.toISOString().slice(0, 10),
                publish_at: item.publish_at?.toISOString(),
                ...(item.key_points || {})
            }))
        };
    }
}
exports.default = new WeeklyThemePipelineService();
