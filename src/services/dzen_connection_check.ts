export type DzenConnectionCheck = {
    config: Record<string, unknown>;
    persisted: false;
    credential_source: 'draft' | 'saved';
    input_format: 'browser_json_export' | 'cookie_header';
};

export function prepareDraftDzenConnectionCheck(
    savedConfig: Record<string, unknown>,
    draftConfig: Record<string, unknown> = {}
): DzenConnectionCheck {
    const draftCookies = typeof draftConfig.cookies === 'string' ? draftConfig.cookies.trim() : '';
    const usesDraft = draftCookies !== '' && draftCookies !== '******';
    const cookies = usesDraft ? draftCookies : savedConfig.cookies;
    const cookieText = typeof cookies === 'string' ? cookies.trim() : '';
    return {
        config: { ...savedConfig, ...draftConfig, cookies },
        persisted: false,
        credential_source: usesDraft ? 'draft' : 'saved',
        input_format: cookieText.startsWith('[') ? 'browser_json_export' : 'cookie_header'
    };
}
