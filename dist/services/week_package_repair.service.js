"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeekPackageRepairService = void 0;
const db_1 = __importDefault(require("../db"));
function normalizedDate(value) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match)
        throw new Error('INVALID_WEEK_DATE');
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
async function requireOwner(projectId, actorId) {
    if (!actorId.startsWith('user:'))
        throw new Error('[Security] Owner access required');
    const userId = Number(actorId.slice(5));
    const member = await db_1.default.projectMember.findUnique({
        where: { project_id_user_id: { project_id: projectId, user_id: userId } }
    });
    if (member?.role !== 'owner')
        throw new Error('[Security] Owner access required');
}
class WeekPackageRepairService {
    async preview(params) {
        await requireOwner(params.projectId, params.actorId);
        const ids = [...new Set(params.moves.map((move) => move.contentItemId))];
        if (ids.length !== params.moves.length)
            throw new Error('DUPLICATE_REPAIR_ITEM');
        const items = await db_1.default.contentItem.findMany({
            where: { project_id: params.projectId, id: { in: ids } },
            include: { publication_fact: true }
        });
        if (items.length !== ids.length)
            throw new Error('REPAIR_ITEM_NOT_FOUND');
        const byId = new Map(items.map((item) => [item.id, item]));
        return {
            project_id: params.projectId,
            dry_run: true,
            moves: params.moves.map((move) => {
                const item = byId.get(move.contentItemId);
                return {
                    content_item_id: item.id,
                    from_week_package_id: item.week_package_id,
                    target_week_start: normalizedDate(move.weekStart).toISOString().slice(0, 10),
                    target_week_end: normalizedDate(move.weekEnd).toISOString().slice(0, 10),
                    runtime_locked: Boolean(item.publication_fact || item.status === 'published' || item.published_link),
                    runtime_fields_changed: false
                };
            })
        };
    }
    async apply(params) {
        await requireOwner(params.projectId, params.actorId);
        if (!params.reason?.trim())
            throw new Error('REPAIR_REASON_REQUIRED');
        const preview = await this.preview(params);
        return db_1.default.$transaction(async (tx) => {
            const replay = await tx.workflowEvent.findFirst({
                where: {
                    project_id: params.projectId,
                    actor_id: params.actorId,
                    command: 'week_package.repair.applied',
                    idempotency_key: params.idempotencyKey
                }
            });
            if (replay)
                return { ...replay.after_state, replayed: true };
            const applied = [];
            for (const move of params.moves) {
                const weekStart = normalizedDate(move.weekStart);
                const weekEnd = normalizedDate(move.weekEnd);
                let target = await tx.weekPackage.findUnique({
                    where: {
                        project_id_week_start_week_end: {
                            project_id: params.projectId,
                            week_start: weekStart,
                            week_end: weekEnd
                        }
                    }
                });
                if (!target) {
                    target = await tx.weekPackage.create({
                        data: {
                            project_id: params.projectId,
                            week_start: weekStart,
                            week_end: weekEnd,
                            week_theme: `Repair ${move.weekStart}–${move.weekEnd}`,
                            approval_status: 'approved'
                        }
                    });
                }
                const item = await tx.contentItem.findFirstOrThrow({
                    where: { id: move.contentItemId, project_id: params.projectId }
                });
                await tx.contentItem.update({ where: { id: item.id }, data: { week_package_id: target.id } });
                applied.push({ content_item_id: item.id, from_week_package_id: item.week_package_id, to_week_package_id: target.id });
            }
            const result = { project_id: params.projectId, applied, reason: params.reason, replayed: false };
            await tx.workflowEvent.create({
                data: {
                    project_id: params.projectId,
                    actor_id: params.actorId,
                    command: 'week_package.repair.applied',
                    before_state: preview,
                    after_state: result,
                    idempotency_key: params.idempotencyKey
                }
            });
            return result;
        });
    }
    async rollback(params) {
        await requireOwner(params.projectId, params.actorId);
        return db_1.default.$transaction(async (tx) => {
            const event = await tx.workflowEvent.findFirst({
                where: {
                    project_id: params.projectId,
                    command: 'week_package.repair.applied',
                    idempotency_key: params.applyIdempotencyKey
                }
            });
            if (!event)
                throw new Error('REPAIR_EVENT_NOT_FOUND');
            const previous = event.after_state?.applied || [];
            for (const move of previous) {
                await tx.contentItem.updateMany({
                    where: { id: move.content_item_id, project_id: params.projectId, week_package_id: move.to_week_package_id },
                    data: { week_package_id: move.from_week_package_id }
                });
            }
            const result = { project_id: params.projectId, restored: previous.length, apply_idempotency_key: params.applyIdempotencyKey };
            await tx.workflowEvent.create({
                data: {
                    project_id: params.projectId,
                    actor_id: params.actorId,
                    command: 'week_package.repair.rolled_back',
                    before_state: event.after_state || undefined,
                    after_state: result,
                    idempotency_key: params.idempotencyKey
                }
            });
            return result;
        });
    }
}
exports.WeekPackageRepairService = WeekPackageRepairService;
exports.default = new WeekPackageRepairService();
