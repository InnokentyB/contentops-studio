import fs from 'node:fs';
import type { VkConnectorConfig } from './vk_connector_consumer_runtime';
export type ResourceState = 'PASS' | 'UNCONFIGURED' | 'INVALID' | 'UNAVAILABLE';
export interface PreflightResources { profile: ResourceState; evidence: ResourceState; dependency: ResourceState }
/** Metadata only: never list a profile, open a cookie file, create a directory or alter config. */
function directory(value?: string): ResourceState {
    if (!value) return 'UNCONFIGURED';
    try {
        const stat = fs.lstatSync(value);
        return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700
            && (!process.getuid || stat.uid === process.getuid()) ? 'PASS' : 'INVALID';
    } catch { return 'UNAVAILABLE'; } // A missing/unreadable resource remains an explicit blocker.
}
export function inspectVk1048PreflightResources(config: VkConnectorConfig): PreflightResources {
    let dependency: ResourceState;
    try { require.resolve('playwright'); dependency = 'PASS'; }
    catch { dependency = 'UNAVAILABLE'; } // Resolving the library never launches its browser.
    return { profile: directory(config.profileDirectory), evidence: directory(config.evidenceDir), dependency };
}
