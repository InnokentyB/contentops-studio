"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const db_1 = __importStar(require("../db"));
const work_queue_service_1 = __importDefault(require("../services/work_queue.service"));
function requiredArg(name) {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (!value)
        throw new Error(`Missing --${name}`);
    return value;
}
async function main() {
    const projectId = Number(requiredArg('project'));
    const taskId = Number(requiredArg('task'));
    const revision = Number(requiredArg('revision'));
    const acceptedRevision = Number(requiredArg('accepted-revision'));
    const expectedChannelId = Number(requiredArg('expected-channel'));
    const targetChannelId = Number(requiredArg('target-channel'));
    const expectedPlacement = requiredArg('expected-placement');
    const targetPlacement = requiredArg('target-placement');
    const blockedWorkItemId = Number(requiredArg('blocked-work-item'));
    const idempotencyKey = requiredArg('idempotency-key');
    const apply = process.argv.includes('--apply');
    const owner = await db_1.default.projectMember.findFirst({ where: { project_id: projectId, role: 'owner' }, select: { user_id: true } });
    const task = await db_1.default.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        include: {
            channel: { select: { id: true, name: true, type: true } },
            publication_fact: true,
            work_items: { where: { kind: 'art_direction' }, orderBy: { id: 'asc' } }
        }
    });
    const targetChannel = await db_1.default.socialChannel.findFirst({ where: { id: targetChannelId, project_id: projectId }, select: { id: true, name: true, type: true } });
    if (!owner || !task || !targetChannel)
        throw new Error('Repair target, target channel or owner not found');
    const body = task.draft_text || '';
    const snapshot = {
        id: task.id,
        item_key: task.item_key,
        status: task.status,
        content_revision: task.content_revision,
        accepted_revision: task.accepted_revision,
        text_state: task.text_state,
        title: task.title,
        channel: task.channel,
        visual_placement: task.visual_placement,
        publication_mode: task.publication_mode,
        handoff_state: task.handoff_state,
        schedule_at: task.schedule_at,
        cta: task.cta,
        publication_fact: task.publication_fact,
        body_length: body.length,
        body_sha256: (0, crypto_1.createHash)('sha256').update(body).digest('hex'),
        art_direction_items: task.work_items.map((item) => ({ id: item.id, state: item.state, reason_code: item.reason_code, input_context_version: item.input_context_version, dedupe_key: item.dedupe_key, note: item.note }))
    };
    if (!apply) {
        console.log(JSON.stringify({ apply, project_id: projectId, target_channel: targetChannel, task: snapshot }, null, 2));
        return;
    }
    const result = await work_queue_service_1.default.repairPublicationPlacement({
        projectId,
        actorId: `user:${owner.user_id}`,
        taskId,
        expectedContentRevision: revision,
        expectedAcceptedRevision: acceptedRevision,
        expectedChannelId,
        expectedPlacement,
        targetChannelId,
        targetPlacement,
        blockedWorkItemId,
        idempotencyKey
    });
    console.log(JSON.stringify({ result, before: snapshot }, null, 2));
}
main()
    .finally(async () => {
    await db_1.default.$disconnect();
    await db_1.pool.end();
})
    .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
