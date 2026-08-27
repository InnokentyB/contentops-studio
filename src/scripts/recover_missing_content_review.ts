import { createHash } from 'crypto';
import prisma, { pool } from '../db';
import workQueueService from '../services/work_queue.service';

function requiredArg(name: string) {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (!value) throw new Error(`Missing --${name}`);
    return value;
}

async function main() {
    const projectId = Number(requiredArg('project'));
    const taskId = Number(requiredArg('task'));
    const expectedContentRevision = Number(requiredArg('revision'));
    const idempotencyKey = requiredArg('idempotency-key');
    const apply = process.argv.includes('--apply');
    const owner = await prisma.projectMember.findFirst({
        where: { project_id: projectId, role: 'owner' },
        select: { user_id: true }
    });
    const content = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        select: {
            id: true,
            item_key: true,
            status: true,
            content_revision: true,
            accepted_revision: true,
            text_state: true,
            handoff_state: true,
            visual_state: true,
            channel_id: true,
            schedule_at: true,
            cta: true,
            draft_text: true
        }
    });
    if (!owner || !content) throw new Error('Recovery target or project owner not found');
    if (content.content_revision !== expectedContentRevision) {
        throw new Error(`Revision mismatch: expected ${expectedContentRevision}, current ${content.content_revision}`);
    }
    const reviews = await prisma.workItem.findMany({
        where: { project_id: projectId, content_item_id: taskId, kind: 'content_review' },
        select: { id: true, state: true, result_version: true }
    });
    const body = content.draft_text || '';
    const snapshot = {
        id: content.id,
        item_key: content.item_key,
        status: content.status,
        content_revision: content.content_revision,
        accepted_revision: content.accepted_revision,
        text_state: content.text_state,
        handoff_state: content.handoff_state,
        visual_state: content.visual_state,
        channel_id: content.channel_id,
        schedule_at: content.schedule_at,
        cta: content.cta,
        body_length: body.length,
        body_sha256: createHash('sha256').update(body).digest('hex'),
        reviews
    };
    if (!apply) {
        console.log(JSON.stringify({ apply, project_id: projectId, task: snapshot }, null, 2));
        return;
    }
    const result = await workQueueService.recoverMissingContentReview({
        projectId,
        actorId: `user:${owner.user_id}`,
        taskId,
        expectedContentRevision,
        idempotencyKey,
        evidenceRequirement: 'Primary JSON evidence and owner acceptance are required before publication.'
    });
    console.log(JSON.stringify({ result, before: snapshot }, null, 2));
}

main()
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
