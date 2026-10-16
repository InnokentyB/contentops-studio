import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

/** DZEN1002-MANIFEST-001 owner-reviewed binding, not automatically refreshed. */
export const DZEN1002_MANIFEST = 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7';
export type Dzen1002ManifestLoader = (projectId: number, userId: number) => Promise<{
    checksum: string; project: { slug: string };
}>;

export async function assertDzen1002CurrentManifest(userId: number,
    load: Dzen1002ManifestLoader = loadAgentWorkspaceManifest): Promise<void> {
    const manifest = await load(10, userId);
    if (manifest.checksum !== DZEN1002_MANIFEST || manifest.project.slug !== 'analystcraft-2') {
        throw new Error('[STALE_MANIFEST]');
    }
}
