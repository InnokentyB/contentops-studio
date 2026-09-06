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
    const pairs = JSON.parse(requiredArg('pairs')) as Array<{
        taskId: number;
        replacementTaskId: number;
        expectedRevision: number;
        expectedCurrentStatus: string;
    }>;
    const idempotencyKey = requiredArg('idempotency-key');
    const apply = process.argv.includes('--apply');
    const owner = await prisma.projectMember.findFirst({ where: { project_id: projectId, role: 'owner' }, select: { user_id: true } });
    if (!owner) throw new Error('Project owner not found');
    const ids = pairs.flatMap((pair) => [pair.taskId, pair.replacementTaskId]);
    const tasks = await prisma.contentItem.findMany({
        where: { project_id: projectId, id: { in: ids } },
        include: { publication_fact: true },
        orderBy: { id: 'asc' }
    });
    const snapshot = tasks.map((task) => {
        const action = ((task.assets || {}) as any).action || {};
        return {
            id: task.id,
            status: task.status,
            content_revision: task.content_revision,
            accepted_revision: task.accepted_revision,
            handoff_state: task.handoff_state,
            draft_text_present: task.draft_text !== null,
            cta: task.cta,
            published_link: task.published_link,
            publication_fact_id: task.publication_fact?.id || null,
            action_status: action.status || null,
            action_skip_reason: action.skip_reason || null
        };
    });
    if (!apply) {
        console.log(JSON.stringify({ apply, pairs, tasks: snapshot }, null, 2));
        return;
    }
    const result = await workQueueService.repairSupersededPublicationTasks({
        projectId,
        actorId: `user:${owner.user_id}`,
        replacements: pairs,
        idempotencyKey
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
