/**
 * Sanitize channel configuration before returning it to the client by masking secrets.
 */
export function sanitizeChannelConfig(type: string, config: any): any {
    if (!config || typeof config !== 'object') return config;
    const sanitized = { ...config };
    
    // Mask sensitive fields
    if (sanitized.api_key) sanitized.api_key = '******';
    if (sanitized.access_token) sanitized.access_token = '******';
    if (sanitized.cookies) sanitized.cookies = '******';
    if (sanitized.application_secret_key) sanitized.application_secret_key = '******';
    
    return sanitized;
}

/**
 * Merge incoming configuration with existing channel configuration to preserve masked secrets.
 */
export function mergeChannelConfig(incomingConfig: any, existingConfig: any): any {
    if (!existingConfig || typeof existingConfig !== 'object') return incomingConfig;
    const merged = { ...incomingConfig };
    
    const secretKeys = ['api_key', 'access_token', 'cookies', 'application_secret_key'];
    for (const key of secretKeys) {
        if (merged[key] === '******' && existingConfig[key]) {
            merged[key] = existingConfig[key];
        }
    }
    
    return merged;
}
