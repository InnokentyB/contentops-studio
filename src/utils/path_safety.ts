import path from 'path';

/**
 * Whitelist of permitted image extensions for uploads.
 */
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/**
 * Checks whether a given path or filename has an allowed image extension.
 * @param filename File path or name
 * @returns boolean
 */
export function isAllowedImageExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

export interface SafeResolveUploadPathOptions {
    customUploadsDir?: string;
    requireImageExtension?: boolean;
}

/**
 * Safely resolves an untrusted file path or filename within the project's 'uploads' directory.
 * Strips path traversal sequences, validates extensions, and ensures the resulting absolute
 * path stays strictly inside the designated uploads root.
 *
 * @param untrustedInput The raw path or filename provided by the user or client.
 * @param customUploadsDirOrOptions Optional custom base directory or configuration options.
 * @returns The validated absolute path if safe, or null if a traversal attempt or invalid extension is detected.
 */
export function safeResolveUploadPath(
    untrustedInput: string,
    customUploadsDirOrOptions?: string | SafeResolveUploadPathOptions
): string | null {
    if (!untrustedInput || typeof untrustedInput !== 'string') {
        return null;
    }

    const options: SafeResolveUploadPathOptions = typeof customUploadsDirOrOptions === 'string'
        ? { customUploadsDir: customUploadsDirOrOptions }
        : (customUploadsDirOrOptions || {});

    const baseDir = path.resolve(options.customUploadsDir || path.join(process.cwd(), 'uploads'));

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

    // Validate extension if required
    if (options.requireImageExtension) {
        if (!isAllowedImageExtension(filename)) {
            return null;
        }
    }

    // Resolve absolute path and verify boundary
    const candidatePath = path.resolve(baseDir, filename);

    // Verify candidatePath starts with baseDir + path.sep
    if (!candidatePath.startsWith(baseDir + path.sep)) {
        return null;
    }

    return candidatePath;
}
