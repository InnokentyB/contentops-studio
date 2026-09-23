import path from 'path';

/**
 * Safely resolves an untrusted file path or filename within the project's 'uploads' directory.
 * Strips path traversal sequences and ensures the resulting absolute path stays strictly inside uploads.
 *
 * @param untrustedInput The raw path or filename provided by the user or client.
 * @param customUploadsDir Optional custom base directory; defaults to path.resolve(process.cwd(), 'uploads').
 * @returns The validated absolute path if safe, or null if a traversal attempt or invalid name is detected.
 */
export function safeResolveUploadPath(
    untrustedInput: string,
    customUploadsDir?: string
): string | null {
    if (!untrustedInput || typeof untrustedInput !== 'string') {
        return null;
    }

    const baseDir = path.resolve(customUploadsDir || path.join(process.cwd(), 'uploads'));

    // Strip leading /uploads/ or uploads/ if present
    let cleaned = untrustedInput.trim();
    if (cleaned.startsWith('/uploads/')) {
        cleaned = cleaned.substring('/uploads/'.length);
    } else if (cleaned.startsWith('uploads/')) {
        cleaned = cleaned.substring('uploads/'.length);
    } else if (path.isAbsolute(cleaned) || cleaned.startsWith('/') || cleaned.startsWith('\\')) {
        return null;
    }

    // Check for null bytes or direct traversal indicators
    if (cleaned.includes('\0') || cleaned.includes('..')) {
        return null;
    }

    // Use path.basename to extract solely the filename component
    const filename = path.basename(cleaned);
    if (!filename || filename === '.' || filename === '..') {
        return null;
    }

    // Resolve absolute path and verify boundary
    const candidatePath = path.resolve(baseDir, filename);

    // Verify candidatePath starts with baseDir + path.sep
    if (!candidatePath.startsWith(baseDir + path.sep)) {
        return null;
    }

    return candidatePath;
}
