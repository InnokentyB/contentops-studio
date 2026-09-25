/**
 * Helpers for MCP publication service.
 */

export function resolveTaskScheduleAt(item: Record<string, unknown> | null | undefined): string | null {
    const assets = item?.assets as { action?: { scheduled_at?: string } } | undefined;
    const actionScheduleAt = assets?.action?.scheduled_at;
    if (typeof actionScheduleAt === 'string' && actionScheduleAt.trim()) {
        return actionScheduleAt;
    }
    const scheduleAt = item?.schedule_at as { toISOString?: () => string } | string | null | undefined;
    if (scheduleAt && typeof scheduleAt === 'object' && scheduleAt.toISOString) {
        return scheduleAt.toISOString();
    }
    return typeof scheduleAt === 'string' ? scheduleAt : null;
}

export function resolveSection(content: string, marker: string): string {
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => line.trim() === marker.trim());
    if (startIndex === -1) {
        return '';
    }

    const result: string[] = [];
    for (let i = startIndex + 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '---') {
            break;
        }
        result.push(lines[i]);
    }

    return result
        .join('\n')
        .replace(/\*\*Content Note\*\*[\s\S]*?(?=\n#|\n---|$)/g, '')
        .trim();
}

export function redactConfig(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => redactConfig(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
        if (/(token|secret|password|session|api[_-]?key|client[_-]?secret|hash|cookie)/i.test(key)) {
            redacted[key] = '[REDACTED]';
            continue;
        }

        redacted[key] = redactConfig(fieldValue);
    }

    return redacted;
}

export function normalizeTextPreview(text: string, maxLength = 280): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) {
        return compact;
    }

    return `${compact.slice(0, maxLength - 1)}…`;
}

export function assertPublicationTaskMutableForMcp(item: Record<string, unknown> | null | undefined, operation: string): void {
    const isPublished = String(item?.status || '') === 'published' || Boolean(item?.published_link);
    if (isPublished) {
        const taskLabel = item?.id ? `Publication task ${item.id}` : 'Publication task';
        throw new Error(`${taskLabel} is already published and is read-only via MCP. ${operation} is not allowed.`);
    }
}

export function summarizeUser(user: {
    id: number;
    email: string;
    name?: string | null;
    created_at?: Date | string | null;
    memberships?: Array<{
        project: {
            id: number;
            name: string;
            slug: string;
            is_archived: boolean;
        };
        role: string;
    }>;
}) {
    const createdAt = user.created_at as { toISOString?: () => string } | string | null | undefined;
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: (createdAt && typeof createdAt === 'object' && createdAt.toISOString) ? createdAt.toISOString() : (createdAt || null),
        projects: Array.isArray(user.memberships)
            ? user.memberships.map((membership) => ({
                id: membership.project.id,
                name: membership.project.name,
                slug: membership.project.slug,
                is_archived: membership.project.is_archived,
                role: membership.role
            }))
            : undefined
    };
}

export function summarizeProject(
    project: {
        id: number;
        name: string;
        slug: string;
        description?: string | null;
        kind: string;
        is_archived: boolean;
        archived_at?: Date | null;
        updated_at: Date;
        _count?: {
            channels?: number;
            content_items?: number;
        };
        channels?: Array<{
            id: number;
            name: string;
            type: string;
            is_active: boolean;
        }>;
    },
    role?: string | null
) {
    return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        kind: project.kind,
        is_archived: project.is_archived,
        archived_at: project.archived_at?.toISOString() || null,
        updated_at: project.updated_at.toISOString(),
        channels_count: project._count?.channels ?? 0,
        content_items_count: project._count?.content_items ?? 0,
        channels: Array.isArray(project.channels)
            ? project.channels.map((channel) => ({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                is_active: channel.is_active
            }))
            : undefined,
        role: role || undefined
    };
}
