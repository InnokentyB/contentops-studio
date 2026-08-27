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
    const revision = Number(requiredArg('revision'));
    const acceptedRevision = Number(requiredArg('accepted-revision'));
    const expectedChannelId = Number(requiredArg('expected-channel'));
    const targetChannelId = Number(requiredArg('target-channel'));
    const expectedPlacement = requiredArg('expected-placement');
    const targetPlacement = requiredArg('target-placement');
    const blockedWorkItemId = Number(requiredArg('blocked-work-item'));
    const idempotencyKey = requiredArg('idempotency-key');
    const apply = process.argv.includes('--apply');
    const owner = await prisma.projectMember.findFirst({ where: { project_id: projectId, role: 'owner' }, select: { user_id: true } });
    const task = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        include: {
            channel: { select: { id: true, name: true, type: true } },
            publication_fact: true,
            work_items: { where: { kind: 'art_direction' }, orderBy: { id: 'asc' } }
        }
    });
    const targetChannel = await prisma.socialChannel.findFirst({ where: { id: targetChannelId, project_id: projectId }, select: { id: true, name: true, type: true } });
    if (!owner || !task || !targetChannel) throw new Error('Repair target, target channel or owner not found');
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
        body_sha256: createHash('sha256').update(body).digest('hex'),
        art_direction_items: task.work_items.map((item) => ({ id: item.id, state: item.state, reason_code: item.reason_code, input_context_version: item.input_context_version, dedupe_key: item.dedupe_key, note: item.note }))
    };
    if (!apply) {
        console.log(JSON.stringify({ apply, project_id: projectId, target_channel: targetChannel, task: snapshot }, null, 2));
        return;
    }
    const result = await workQueueService.repairPublicationPlacement({
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
        await prisma.$disconnect();
        await pool.end();
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
