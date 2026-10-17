import { z } from 'zod';

const scalar = z.string().max(500).nullable();
export const nativeBindingSourceSchema = z.object({ channelActive: z.boolean(), configKind: scalar,
    accountRef: scalar, accountType: scalar, profileUrl: scalar, channelUrl: scalar, rawAccountUrl: scalar,
    identityKind: scalar, platform: scalar, boundType: scalar, boundAccount: scalar, boundProfile: scalar,
    boundProvider: scalar }).strict();
export type NativeBindingSource = z.infer<typeof nativeBindingSourceSchema>;
const identityFields = ['platform', 'boundType', 'boundAccount', 'boundProfile', 'boundProvider'] as const;
const trimSlash = (value: string): string => value.replace(/\/$/, '');
const isProfile = (value: string): boolean => /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(trimSlash(value));

/** Administrative tuple consistency only; never provider ownership, readiness or authority. */
export function projectNativeBinding(source: NativeBindingSource): {
    channelActive: boolean; status: 'consistent' | 'inconsistent' | 'unbound';
} {
    let missing = false;
    let invalid = source.configKind !== 'object'
        || (source.identityKind !== null && source.identityKind !== 'object');
    const account = source.accountRef;
    if (account === null) missing = true;
    else if (!/^@[A-Za-z0-9_]{1,15}$/.test(account)) invalid = true;
    if (source.accountType !== null && !['unknown', 'personal'].includes(source.accountType)) invalid = true;
    const profiles = [source.profileUrl, source.channelUrl, source.rawAccountUrl];
    if (profiles.some(value => value === '__invalid__')) invalid = true;
    const profile = [...profiles, account].find(value => value !== null && value !== '');
    if (!profile) missing = true;
    else if (!isProfile(profile) || (account !== null && trimSlash(profile) !== `https://x.com/${account.slice(1)}`)) invalid = true;
    if (source.identityKind === null) missing = true;
    for (const field of identityFields) {
        if (source[field] === null) missing = true;
        else if (source[field] === '__invalid__') invalid = true;
    }
    if (source.platform !== null && source.platform !== 'x') invalid = true;
    if (source.boundType !== null && source.boundType !== 'personal') invalid = true;
    if (source.boundAccount !== null && (!/^@[A-Za-z0-9_]{1,15}$/.test(source.boundAccount)
        || (account !== null && source.boundAccount !== account))) invalid = true;
    const expectedAccount = account ?? source.boundAccount;
    if (source.boundProfile !== null && (!isProfile(source.boundProfile)
        || (expectedAccount !== null && trimSlash(source.boundProfile) !== `https://x.com/${expectedAccount.slice(1)}`))) invalid = true;
    if (source.boundProvider !== null && (!/^[A-Za-z0-9_]{1,15}$/.test(source.boundProvider)
        || (expectedAccount !== null && source.boundProvider !== expectedAccount.slice(1)))) invalid = true;
    return { channelActive: source.channelActive, status: invalid ? 'inconsistent' : missing ? 'unbound' : 'consistent' };
}
