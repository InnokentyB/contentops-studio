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
    const expectedChannelId = Number(requiredArg('expected-channel'));
    const blockedWorkItemId = Number(requiredArg('blocked-work-item'));
    const idempotencyKey = requiredArg('idempotency-key');
    const requireStaticStory = process.argv.includes('--static-story');
    const apply = process.argv.includes('--apply');
    const owner = await prisma.projectMember.findFirst({
        where: { project_id: projectId, role: 'owner' },
        select: { user_id: true }
    });
    const task = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        include: {
            channel: { select: { id: true, name: true, type: true } },
            publication_fact: true,
            work_items: { where: { id: blockedWorkItemId } }
        }
    });
    if (!owner || !task) throw new Error('Repair target or project owner not found');
    const snapshot = {
        id: task.id,
        channel: task.channel,
        visual_placement: task.visual_placement,
        content_revision: task.content_revision,
        accepted_revision: task.accepted_revision,
        draft_text_present: task.draft_text !== null,
        cta: task.cta,
        status: task.status,
        published_link: task.published_link,
        publication_fact_id: task.publication_fact?.id || null,
        work_item: task.work_items[0] || null
    };
    if (!apply) {
        console.log(JSON.stringify({ apply, static_story: requireStaticStory, task: snapshot }, null, 2));
        return;
    }
    const result = await workQueueService.repairRevisionZeroStoryBinding({
        projectId,
        actorId: `user:${owner.user_id}`,
        taskId,
        expectedChannelId,
        blockedWorkItemId,
        requireStaticStory,
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
