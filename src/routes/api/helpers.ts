import prisma from '../../db';
import authService, { AuthUser } from '../../services/auth.service';
import { Post, Week } from '@prisma/client';

export interface AuthenticatedUser extends AuthUser {
    role?: string;
}

export interface RequestWithProjectContext {
    user?: AuthenticatedUser;
    projectId?: number;
}

export function maskApiKey(key?: string): string {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

export function safeJsonParse<T = unknown>(value?: string | null): T | null {
    if (!value?.trim()) return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

export function formatJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

export function parseMetricsDate(value?: string, field = 'date'): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${field} must be a valid ISO date`);
    }
    return parsed;
}

export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const serialized = value instanceof Date ? value.toISOString() : String(value);
    return `"${serialized.replace(/"/g, '""')}"`;
}

export function extractRequestErrorMessage(error: unknown, fallback: string): string {
    const err = error as { message?: string; response?: { description?: string }; description?: string } | null;
    const directMessage = typeof err?.message === 'string' ? err.message.trim() : '';
    const providerDescription = typeof err?.response?.description === 'string'
        ? err.response.description.trim()
        : (typeof err?.description === 'string' ? err.description.trim() : '');

    if (providerDescription) {
        if (directMessage && directMessage !== 'Bad Request' && directMessage !== providerDescription) {
            return `${directMessage}: ${providerDescription}`;
        }
        return providerDescription;
    }

    if (directMessage) {
        return directMessage;
    }

    return fallback;
}

/**
 * Loads a post by ID and asserts that the requesting user has the required project access.
 * Returns null if the post does not exist or user lacks access, preventing IDOR data leaks.
 */
export async function getAuthorizedPost(
    postId: number,
    userId: number,
    minRole?: 'owner' | 'editor' | 'viewer',
    includeWeek?: false
): Promise<Post | null>;
export async function getAuthorizedPost(
    postId: number,
    userId: number,
    minRole: 'owner' | 'editor' | 'viewer',
    includeWeek: true
): Promise<(Post & { week: Week | null }) | null>;
export async function getAuthorizedPost(
    postId: number,
    userId: number,
    minRole: 'owner' | 'editor' | 'viewer' = 'viewer',
    includeWeek = false
): Promise<(Post & { week?: Week | null }) | null> {
    if (!Number.isInteger(postId) || postId <= 0) return null;
    const post = await prisma.post.findUnique({
        where: { id: postId },
        include: includeWeek ? { week: true } : undefined
    });
    if (!post) return null;
    const hasAccess = await authService.hasProjectAccess(userId, post.project_id, minRole);
    if (!hasAccess) return null;
    return post;
}

/**
 * Loads a week by ID and asserts that the requesting user has the required project access.
 * Returns null if the week does not exist or user lacks access, preventing IDOR data leaks.
 */
export async function getAuthorizedWeek(
    weekId: number,
    userId: number,
    minRole?: 'owner' | 'editor' | 'viewer',
    includePosts?: false
): Promise<Week | null>;
export async function getAuthorizedWeek(
    weekId: number,
    userId: number,
    minRole: 'owner' | 'editor' | 'viewer',
    includePosts: true
): Promise<(Week & { posts: Post[] }) | null>;
export async function getAuthorizedWeek(
    weekId: number,
    userId: number,
    minRole: 'owner' | 'editor' | 'viewer' = 'viewer',
    includePosts = false
): Promise<(Week & { posts?: Post[] }) | null> {
    if (!Number.isInteger(weekId) || weekId <= 0) return null;
    const week = await prisma.week.findUnique({
        where: { id: weekId },
        include: includePosts ? { posts: { orderBy: { publish_at: 'asc' } } } : undefined
    });
    if (!week) return null;
    const hasAccess = await authService.hasProjectAccess(userId, week.project_id, minRole);
    if (!hasAccess) return null;
    return week;
}
