import * as fs from 'fs';
import * as path from 'path';

const LOGS_DIR = path.join(__dirname, '../../../logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const PUBLISHER_LOG_FILE = path.join(LOGS_DIR, 'publisher.log');

/**
 * Asynchronously append a formatted log entry to the publisher log file and console.
 *
 * @param level - Log severity level ('INFO', 'WARN', 'ERROR')
 * @param message - Main log description
 * @param data - Optional metadata or payload
 */
export function logToFile(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;
    if (data !== undefined && data !== null) {
        logLine += ` | ${typeof data === 'object' ? JSON.stringify(data) : String(data)}`;
    }
    logLine += '\n';

    fs.promises.appendFile(PUBLISHER_LOG_FILE, logLine).catch((err) => {
        console.error('[logToFile] Failed to write log asynchronously:', err);
    });

    if (level === 'ERROR') {
        console.error(message, data ?? '');
    } else if (level === 'WARN') {
        console.warn(message, data ?? '');
    } else {
        console.log(message, data ?? '');
    }
}
