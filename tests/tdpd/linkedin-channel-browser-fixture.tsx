import { createRoot } from 'react-dom/client';
import { LinkedInChannelEditor } from '../../frontend/src/components/LinkedInChannelEditor';

const target = document.getElementById('root');
if (!target) throw new Error('Synthetic fixture root is missing');
const root = createRoot(target);
type FixtureOptions = { channelId: number; disabled?: boolean; bound?: boolean; personal?: boolean; locale?: 'ru' | 'en' };
declare global { interface Window { renderFixture(options: FixtureOptions): void } }
window.renderFixture = ({ channelId, disabled = false, bound = true, personal = false, locale = 'ru' }) => {
    const channel = { id: channelId, name: personal ? 'Synthetic personal LinkedIn' : 'seturon_linkedin_page', type: 'linkedin',
        config: personal ? { account_type: 'personal', channel_url: 'https://www.linkedin.com/in/synthetic-person/' } : bound ? { linkedin_urn: 'urn:li:organization:12345' } : {} };
    root.render(<main className="mx-auto max-w-5xl p-4 sm:p-8">
        <LinkedInChannelEditor key={`${channelId}:${disabled}:${bound}:${personal}:${locale}`} projectId={11} token="synthetic-only"
            channel={channel} disabled={disabled} locale={locale} name={channel.name} config={{}} saving={false}
            onName={() => {}} onConfig={() => {}} onSave={() => {}} onClose={() => {}} />
    </main>);
};
window.renderFixture({ channelId: 23 });
