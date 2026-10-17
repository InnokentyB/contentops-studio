/** Browser origin is a second boundary alongside signatures, never a replacement for key ownership. */
export function assertNativeExtensionOrigin(origin: string | undefined, extensionId: string): void {
    if (!/^[a-p]{32}$/.test(extensionId) || origin !== `chrome-extension://${extensionId}`) {
        throw new Error('[X_NATIVE_ORIGIN_DENIED]');
    }
}
