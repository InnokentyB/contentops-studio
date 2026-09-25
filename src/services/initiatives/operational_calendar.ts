import prisma from '../../db';
import { validateCalendarRange } from './validation';

export function publicationTaskView(workItems: Array<{ content_item: any }>): Record<string, unknown> | null {
    const task = workItems.find((item) => item.content_item)?.content_item;
    if (!task) return null;
    return {
        id: task.id,
        status: task.status,
        mode: task.publication_mode || 'manual_handoff',
        has_draft: Boolean(task.draft_text?.trim()),
        published_link: task.published_link || null,
        channel_id: task.channel_id || null,
        workspace_path: `/publication-tasks?taskId=${task.id}`
    };
}

export async function fetchOperationalCalendar(params: {
    projectId: number;
    actorId: string;
    fromDate: string;
    toDate: string;
}): Promise<{ items: Record<string, unknown>[] }> {
    const { from, to } = validateCalendarRange(params.fromDate, params.toDate);

    const initiatives = await prisma.initiative.findMany({
        where: { project_id: params.projectId },
        include: { work_items: { where: { content_item_id: { not: null } }, include: { content_item: true } } },
        orderBy: { id: 'asc' }
    });

    const items: Record<string, unknown>[] = [];

    for (const item of initiatives) {
        let dateVal: Date | null = null;
        let dateType = 'due_at';

        if (item.due_at) {
            dateVal = item.due_at;
            dateType = 'due_at';
        } else if (item.start_at) {
            dateVal = item.start_at;
            dateType = 'start_at';
        } else if (item.event_at) {
            dateVal = item.event_at;
            dateType = 'event_at';
        } else if (item.decision_at) {
            dateVal = item.decision_at;
            dateType = 'decision_at';
        } else if (item.end_at) {
            dateVal = item.end_at;
            dateType = 'end_at';
        } else if (item.measurement_at) {
            dateVal = item.measurement_at;
            dateType = 'measurement_at';
        }

        if (dateVal && dateVal.getTime() >= from.getTime() && dateVal.getTime() <= to.getTime()) {
            items.push({
                id: item.id,
                external_key: item.external_key,
                kind: item.kind,
                subtype: item.subtype,
                title: item.title,
                status: item.status,
                date_type: dateType,
                date: dateVal.toISOString(),
                publication_task: publicationTaskView(item.work_items)
            });
        }
    }

    return { items };
}
