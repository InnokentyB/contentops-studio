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
    const workItemId = Number(requiredArg('work-item'));
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
            content_revision: true,
            accepted_revision: true,
            text_state: true,
            channel_id: true,
            schedule_at: true,
            cta: true,
            draft_text: true
        }
    });
    const review = await prisma.workItem.findFirst({
        where: { id: workItemId, project_id: projectId, content_item_id: taskId, kind: 'content_review' },
        select: { id: true, state: true, result_version: true }
    });
    if (!owner || !content || !review) throw new Error('Recovery target or project owner not found');
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

    const result = await workQueueService.recoverContentReview({
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
        await prisma.$disconnect();
        await pool.end();
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
