"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeResolveUploadPath = safeResolveUploadPath;
const path_1 = __importDefault(require("path"));
/**
 * Safely resolves an untrusted file path or filename within the project's 'uploads' directory.
 * Strips path traversal sequences and ensures the resulting absolute path stays strictly inside uploads.
 *
 * @param untrustedInput The raw path or filename provided by the user or client.
 * @param customUploadsDir Optional custom base directory; defaults to path.resolve(process.cwd(), 'uploads').
 * @returns The validated absolute path if safe, or null if a traversal attempt or invalid name is detected.
 */
function safeResolveUploadPath(untrustedInput, customUploadsDir) {
    if (!untrustedInput || typeof untrustedInput !== 'string') {
        return null;
    }
    const baseDir = path_1.default.resolve(customUploadsDir || path_1.default.join(process.cwd(), 'uploads'));
    // Strip leading /uploads/ or uploads/ if present
    let cleaned = untrustedInput.trim();
    if (cleaned.startsWith('/uploads/')) {
        cleaned = cleaned.substring('/uploads/'.length);
    }
    else if (cleaned.startsWith('uploads/')) {
        cleaned = cleaned.substring('uploads/'.length);
    }
    else if (path_1.default.isAbsolute(cleaned) || cleaned.startsWith('/') || cleaned.startsWith('\\')) {
        return null;
    }
    // Check for null bytes or direct traversal indicators
    if (cleaned.includes('\0') || cleaned.includes('..')) {
        return null;
    }
    // Use path.basename to extract solely the filename component
    const filename = path_1.default.basename(cleaned);
    if (!filename || filename === '.' || filename === '..') {
        return null;
    }
    // Resolve absolute path and verify boundary
    const candidatePath = path_1.default.resolve(baseDir, filename);
    // Verify candidatePath starts with baseDir + path.sep
    if (!candidatePath.startsWith(baseDir + path_1.default.sep)) {
        return null;
    }
    return candidatePath;
}
