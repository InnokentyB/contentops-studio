import type { AuthUser } from '../services/auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isDemoMutationBlocked(user: AuthUser, method: string, url: string): boolean {
    if (!user.is_demo || !url.startsWith('/api/')) return false;
    return !SAFE_METHODS.has(method.toUpperCase());
}
