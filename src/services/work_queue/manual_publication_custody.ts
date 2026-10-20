import type { Prisma } from '@prisma/client';
import { lockManualTransportMutation } from '../manual_publication_transport_projection';

const transportKinds = new Set(['browser_publish', 'provider_publish', 'vk_native_video_transport']);

/** A retained transport lease is history, not authority to complete a manually accounted publication. */
export async function assertWorkItemTransportMutable(tx: Prisma.TransactionClient,
    scope: { projectId: number; workItemId: number }): Promise<void> {
    const item = await tx.workItem.findFirst({
        where: { id: scope.workItemId, project_id: scope.projectId },
        select: { content_item_id: true, kind: true }
    });
    if (!item?.content_item_id || !transportKinds.has(item.kind)) return;
    await lockManualTransportMutation(tx, { projectId: scope.projectId, taskId: item.content_item_id });
}
