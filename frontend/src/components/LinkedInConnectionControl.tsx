import { useEffect, useState } from 'react';
const callbackMessages: Record<string, string> = {
    LINKEDIN_OAUTH_EXPECTED_IDENTITY_REQUIRED: 'The channel has no expected identity. Enter its exact public LinkedIn person/organization URN or configure the personal profile URL, then reconnect.',
    LINKEDIN_OAUTH_STATE_INVALID: 'Connection expired or state is invalid. Start a fresh connection from Settings.',
    LINKEDIN_OAUTH_BROWSER_MISMATCH: 'This browser does not match the request. Reconnect in the same browser and allow the secure cookie.',
    LINKEDIN_OAUTH_ALREADY_USED: 'This request was already consumed. Check channel status; if incomplete, start a fresh connection without replaying the callback.',
    LINKEDIN_OAUTH_AUTH_REQUIRED: 'Project Owner access changed. Sign in as the current non-demo Owner and reconnect.',
    LINKEDIN_OAUTH_CHANNEL_CHANGED: 'Channel configuration changed. Check its exact identity and start a fresh connection.',
    LINKEDIN_OAUTH_IDENTITY_MISMATCH: 'LinkedIn returned a different member. Sign in to the intended account and reconnect this channel.',
    LINKEDIN_OAUTH_ORGANIZATION_UNVERIFIED: 'Authority for this exact organization was not verified. Check the organization role and supported authorization permissions, then reconnect.',
    LINKEDIN_OAUTH_CONNECTION_UNREADABLE: 'Saved credentials could not be authenticated. Ask the administrator to check the channel encryption key, then reconnect this channel.',
    LINKEDIN_OAUTH_GRANTS_UNKNOWN: 'Issued grants or expiry could not be verified. Enable the supported profile and token introspection permissions, then reconnect.',
    LINKEDIN_OAUTH_PROVIDER_DENIED: 'LinkedIn consent was declined. Start a fresh connection and grant the approved permissions.',
    LINKEDIN_OAUTH_PROVIDER_UNAVAILABLE: 'LinkedIn returned an unsupported response. Check provider availability and application permissions, then start a fresh connection.',
    LINKEDIN_OAUTH_CONFIG_REQUIRED: 'Secure application configuration is incomplete. Ask the administrator to check the approved client, matching HTTPS API/frontend origin, callback and encryption key.',
    LINKEDIN_OAUTH_SAVE_FAILED: 'Connection could not be saved atomically. Check channel status, then reconnect if incomplete; do not reuse this callback.'
};
type Channel = {
    id: number;
    name: string;
    type: string;
};
export function LinkedInConnectionControl({ projectId, token, channels, disabled, error }: {
    projectId: number;
    token: string;
    channels: Channel[];
    disabled: boolean;
    error: string | null;
}) {
    const [selected, setSelected] = useState(''), [pending, setPending] = useState(false), [failure, setFailure] = useState(''), [expectedUrn, setExpectedUrn] = useState('');
    const [status, setStatus] = useState('');
    useEffect(() => { if (!selected || disabled) {
        setStatus('');
        return;
    } let active = true; const base = import.meta.env.VITE_API_URL || 'http://localhost:3003'; fetch(`${base}/api/auth/linkedin/status?projectId=${projectId}&channelId=${selected}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const body = await response.json() as {
        reason?: string;
        error?: string;
        action?: string;
        expiresAt?: string;
    }; if (active)
        setStatus([body.reason || body.error, body.action, body.expiresAt ? `Token expires: ${body.expiresAt}` : ''].filter(Boolean).join(' ')); }).catch(() => { if (active)
        setStatus('Connection status could not be read. Check your project access and reload.'); }); return () => { active = false; }; }, [selected, projectId, token, disabled]);
    const candidates = channels.filter(channel => channel.type === 'linkedin');
    async function connect() { setPending(true); setFailure(''); try {
        const base = import.meta.env.VITE_API_URL || 'http://localhost:3003';
        const response = await fetch(`${base}/api/auth/linkedin/connect?projectId=${projectId}&channelId=${selected}${expectedUrn ? `&expectedAuthorUrn=${encodeURIComponent(expectedUrn)}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
        const body = await response.json() as {
            url?: string;
            error?: string;
            action?: string;
        };
        if (!response.ok || !body.url)
            throw new Error([body.error, body.action].filter(Boolean).join(' '));
        window.location.assign(body.url);
    }
    catch (reason) {
        setFailure(reason instanceof Error ? reason.message : 'Connection could not start. Select the channel and reconnect.');
        setPending(false);
    } }
    const callbackError = error ? callbackMessages[error] || null : null;
    return <div><label htmlFor="linkedin-existing-channel">Reconnect an existing LinkedIn channel</label><select id="linkedin-existing-channel" value={selected} onChange={event => { setSelected(event.target.value); setExpectedUrn(''); }} disabled={disabled || pending}><option value="">Select the exact personal or organization channel</option>{candidates.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><label htmlFor="linkedin-expected-author">Expected public LinkedIn URN (required if this channel has no bound identity)</label><input id="linkedin-expected-author" value={expectedUrn} onChange={event => setExpectedUrn(event.target.value)} placeholder="urn:li:person:… or urn:li:organization:…" disabled={disabled || pending}/><p>Personal and organization identities stay separate. Connecting does not activate publishing. Token grants and API readiness must be verified separately.</p>{status && <p role="status">{status}</p>}{!candidates.length && <p>Create the intended channel first; this connection never creates a replacement.</p>}{(failure || callbackError) && <p role="alert">{failure || callbackError} {callbackError && error}</p>}<button type="button" className="btn-secondary" disabled={disabled || pending || !selected} onClick={connect}>{pending ? 'Connecting…' : 'Connect / Reconnect LinkedIn'}</button></div>;
}
