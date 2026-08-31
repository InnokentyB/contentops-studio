import { Prisma } from '@prisma/client';
import prisma from '../db';

const SETTING_KEY = 'visual_storage_ingest_state';

export function visualStorageFailureCode(error: unknown) {
    const status = Number((error as any)?.statusCode || (error as any)?.status || 0);
    const message = error instanceof Error ? error.message : String(error || '');
    if (status === 402 || /exceed[_ -]?egress[_ -]?quota|quota|capacity|spend cap/i.test(message)) {
        return 'storage_quota_exceeded';
    }
    return 'storage_ingest_failed';
}

function safeFailureMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Storage ingest failed');
    return message.replace(/(token|secret|password|key)=([^\s&]+)/gi, '$1=[REDACTED]').slice(0, 500);
}

export async function blockVisualStorageIngest(projectId: number, contentItemId: number, error: unknown) {
    const state = {
        blocked: true,
        reason: visualStorageFailureCode(error),
        content_item_id: contentItemId,
        message: safeFailureMessage(error),
        recorded_at: new Date().toISOString()
    };
    await prisma.$transaction(async (tx) => {
        await tx.contentItem.updateMany({
            where: { id: contentItemId, project_id: projectId },
            data: { handoff_state: 'blocked' }
        });
        await tx.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: SETTING_KEY } },
            update: { value: JSON.stringify(state) },
            create: { project_id: projectId, key: SETTING_KEY, value: JSON.stringify(state) }
        });
    });
    return state;
}

export async function clearVisualStorageIngestBlock(projectId: number) {
    const state = { blocked: false, reason: null, recovered_at: new Date().toISOString() };
    await prisma.projectSettings.upsert({
        where: { project_id_key: { project_id: projectId, key: SETTING_KEY } },
        update: { value: JSON.stringify(state) },
        create: { project_id: projectId, key: SETTING_KEY, value: JSON.stringify(state) }
    });
    return state;
}

export async function getVisualStorageIngestState(projectId: number, client: Prisma.TransactionClient | typeof prisma = prisma) {
    const setting = await client.projectSettings.findUnique({
        where: { project_id_key: { project_id: projectId, key: SETTING_KEY } }
    });
    if (!setting?.value) return { blocked: false, reason: null };
    try {
        const parsed = JSON.parse(setting.value);
        return {
            blocked: parsed?.blocked === true,
            reason: typeof parsed?.reason === 'string' ? parsed.reason : null,
            content_item_id: Number.isInteger(parsed?.content_item_id) ? parsed.content_item_id : null,
            recorded_at: parsed?.recorded_at || null
        };
    } catch {
        return { blocked: true, reason: 'storage_ingest_state_invalid' };
    }
}

