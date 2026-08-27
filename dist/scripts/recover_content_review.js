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
    const workItemId = Number(requiredArg('work-item'));
    const expectedContentRevision = Number(requiredArg('revision'));
    const idempotencyKey = requiredArg('idempotency-key');
    const apply = process.argv.includes('--apply');
    const owner = await db_1.default.projectMember.findFirst({
        where: { project_id: projectId, role: 'owner' },
        select: { user_id: true }
    });
    const content = await db_1.default.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        select: {
            id: true,
            content_revision: true,
            accepted_revision: true,
            text_state: true,
            channel_id: true,
            schedule_at: true,
            cta: true,
            draft_text: true
        }
    });
    const review = await db_1.default.workItem.findFirst({
        where: { id: workItemId, project_id: projectId, content_item_id: taskId, kind: 'content_review' },
        select: { id: true, state: true, result_version: true }
    });
    if (!owner || !content || !review)
        throw new Error('Recovery target or project owner not found');
    if (content.content_revision !== expectedContentRevision) {
        throw new Error(`Revision mismatch: expected ${expectedContentRevision}, current ${content.content_revision}`);
    }
    const preview = {
        apply,
        project_id: projectId,
        task: {
            id: content.id,
            content_revision: content.content_revision,
            accepted_revision: content.accepted_revision,
            text_state: content.text_state,
            channel_id: content.channel_id,
            schedule_at: content.schedule_at,
            cta_present: Boolean(content.cta),
            body_length: content.draft_text?.length || 0
        },
        review
    };
    if (!apply) {
        console.log(JSON.stringify(preview, null, 2));
        return;
    }
    const result = await work_queue_service_1.default.recoverContentReview({
        projectId,
        actorId: `user:${owner.user_id}`,
        taskId,
        workItemId,
        expectedContentRevision,
        idempotencyKey,
        evidence: 'User accepted revision after anti-slop and chief-editor checks reported no blockers.'
    });
    console.log(JSON.stringify(result, null, 2));
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
