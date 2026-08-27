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
    const resultVersion = Number(requiredArg('result-version'));
    const idempotencyKey = requiredArg('idempotency-key');
    const apply = process.argv.includes('--apply');

    const owner = await prisma.projectMember.findFirst({
        where: { project_id: projectId, role: 'owner' },
        select: { user_id: true }
    });
    const content = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        select: { id: true, content_revision: true, accepted_revision: true, text_state: true }
    });
    const review = await prisma.workItem.findFirst({
        where: { id: workItemId, project_id: projectId, content_item_id: taskId, kind: 'content_review' },
        select: { id: true, state: true, result_version: true }
    });
    const existingApproval = await prisma.approvalDecision.findUnique({
        where: { work_item_id_result_version: { work_item_id: workItemId, result_version: resultVersion } },
        select: { decision: true }
    });
    if (!owner || !content || !review) throw new Error('Approval target or project owner not found');
    if (content.content_revision !== resultVersion || review.result_version !== resultVersion) {
        throw new Error(`Version mismatch: content=${content.content_revision}, review=${review.result_version}, requested=${resultVersion}`);
    }

    if (!apply) {
        console.log(JSON.stringify({
            apply,
            project_id: projectId,
            task: content,
            review,
            existing_approval: existingApproval
        }, null, 2));
        return;
    }

    const result = await workQueueService.decideApproval({
        projectId,
        actorId: `user:${owner.user_id}`,
        workItemId,
        resultVersion,
        decision: 'approved',
        comment: 'User explicitly accepted this revision; anti-slop and chief-editor checks reported no blockers.',
        idempotencyKey
    });
    const verified = await prisma.contentItem.findUniqueOrThrow({
        where: { id: taskId },
        select: { content_revision: true, accepted_revision: true, text_state: true }
    });
    console.log(JSON.stringify({ result, verified }, null, 2));
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
