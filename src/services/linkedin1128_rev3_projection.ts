import { z } from 'zod';
import { LINKEDIN1128R3 as p } from './linkedin1128_rev3_contract';
function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const Binding = z.object({ content_revision: z.literal(3), accepted_revision: z.literal(3),
    body_sha256: z.literal(p.body), linkedin_company_id: z.literal('97416172'),
    visual_decision_id: z.literal(315), visual_decision_version: z.literal(2),
    canonical_url: z.literal('https://www.linkedin.com/company/seturon/'),
    provider_identity_verified: z.literal(false), audit_command: z.literal(p.command) }).passthrough();
export function linkedIn1128Rev3Handoff<T extends Record<string, unknown>>(bundle: T, quality: unknown) {
    const binding = Binding.parse(object(quality).identity_binding);
    const checklist = ['Publish the exact accepted task1128 English revision3 text, no attachments.',
        'Use only Seturon company97416172; verify the native author and duplicate history before Post.',
        'Never submit the superseded Russian composer. Obtain action-time owner confirmation.',
        'One pre-submit permission means one Post click. Ambiguity requires same-attempt reconciliation, never resend.'];
    return { ...bundle, mode: 'manual' as const, content_language: 'en',
        account: { ref: 'seturon_linkedin_page', details: { platform: 'linkedin', account_type: 'company_page',
            url: binding.canonical_url, linkedin_company_id: '97416172', profile_ref: 'profile_seturon_linkedin_page', identity_ref: 'identity_seturon' } },
        task: { ...object(bundle.task), content_item_id: 1128, channel: 'linkedin', placement: 'feed',
            account_ref: 'seturon_linkedin_page', schedule_at: p.schedule }, manual_checklist: checklist, checklist };
}
