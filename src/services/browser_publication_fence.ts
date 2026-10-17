const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Data-driven routing fence; no task/account allowlist and no provider operation. */
export function hasGovernedBrowserLifecycle(input:unknown):boolean {
    const quality=object(object(input).quality_report);
    return object(quality.browser_release).lifecycle==='shared_browser_v1'
        ||object(quality.browser_identity_binding).verification_basis==='owner_adopted_registry_binding';
}
export function governedBrowserRouteBlock(input:unknown) {
    if(!hasGovernedBrowserLifecycle(input))return null;
    return {success:false,blocked:true,skipped:true,status:String(object(input).status||'blocked'),
        reason:'governed_browser_route_required',required_command:'ba_start_browser_submission',
        provider_execution:'blocked',retry_via_api:false,next_route:'owning_browser_controls'};
}
