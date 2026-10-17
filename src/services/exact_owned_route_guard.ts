import { z } from 'zod';
import { governedBrowserRouteBlock } from './browser_publication_fence';
const Task = z.object({ id: z.number().int(), project_id: z.number().int(), status: z.string().optional(), content_revision: z.number().int().optional() });
/** Central dispatch must never rewrite a fenced exact task or create fallback work. */
export function exactOwnedRouteBlock(input: unknown) {
    const governed = governedBrowserRouteBlock(input); if (governed) return governed;
    const parsed = Task.safeParse(input);
    if (!parsed.success) return null;
    const task = parsed.data;
    const command = task.project_id === 7 && task.id === 1086 ? 'ba_start_linkedin_task1086_browser_submission'
        : task.project_id === 10 && task.id === 1114 ? 'ba_publish_threads_task1114'
        : task.project_id === 7 && task.id === 1128 ? (task.content_revision === 3
            ? 'ba_start_linkedin_task1128_rev3_browser_submission' : 'ba_start_linkedin_task1128_browser_submission') : null;
    if (!command) return null;
    return { success: false, blocked: true, skipped: true, status: task.status || 'blocked',
        reason: 'exact_owned_task_route_required', required_command: command,
        provider_execution: 'blocked', retry_via_api: false, next_route: 'owning_exact_controls' };
}
