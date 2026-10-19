import fs from 'node:fs';
import path from 'node:path';
import type { LaunchOptions } from 'playwright';

/** Shared browser configuration. Location is a resource, never execution permission. */
export function sandboxedChromiumLaunchOptions(input: {
    headless: boolean; executablePath?: string; timeout?: number;
}): LaunchOptions {
    const timeout = input.timeout ?? 30_000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000)
        throw new Error('[BROWSER_LAUNCH_TIMEOUT_INVALID]');
    if (input.executablePath !== undefined) {
        if (!path.isAbsolute(input.executablePath) || path.normalize(input.executablePath) !== input.executablePath)
            throw new Error('[BROWSER_EXECUTABLE_INVALID]');
        const info = fs.lstatSync(input.executablePath);
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || (info.mode & 0o111) === 0)
            throw new Error('[BROWSER_EXECUTABLE_INVALID]');
    }
    return { headless: input.headless, chromiumSandbox: true, timeout,
        ...(input.executablePath ? { executablePath: input.executablePath } : {}) };
}
