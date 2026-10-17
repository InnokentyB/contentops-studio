/** Owner/Publisher control plane only. Signed execution receipts are never MCP tools. */
export const X_NATIVE_CONTROL_TOOLS = new Set([
    'ba_issue_x_native_pairing',
    'ba_register_x_native_installation',
    'ba_revoke_x_native_installation',
    'ba_issue_x_native_challenge'
]);
