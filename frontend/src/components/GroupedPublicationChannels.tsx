import {useId, useMemo, useState, type ReactNode, type ReactElement} from 'react';
import {groupPublicationChannels} from './publication-channel-groups';
import './GroupedPublicationChannels.css';

type ChannelIdentity = {id: number; name: string; type: string};
type Props<T extends ChannelIdentity> = {
    channels: readonly T[];
    locale: 'ru' | 'en';
    className: string;
    children: (channel: T) => ReactNode;
};

/** Presentation-only grouping; original channel objects and row action bindings are preserved. */
export function GroupedPublicationChannels<T extends ChannelIdentity>({channels, locale, className, children}: Props<T>): ReactElement {
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
    const prefix = useId();
    const groups = useMemo(() => groupPublicationChannels(channels, locale, direction), [channels, locale, direction]);
    const ru = locale === 'ru';
    return <>
        {channels.length > 0 && <div className="channel-list__toolbar">
            <label className="channel-list__sort">
                <span>{ru ? 'Сортировка по каналу' : 'Sort channels by name'}</span>
                <select value={direction} onChange={event => setDirection(event.target.value === 'desc' ? 'desc' : 'asc')}>
                    <option value="asc">{ru ? 'А–Я' : 'A–Z'}</option>
                    <option value="desc">{ru ? 'Я–А' : 'Z–A'}</option>
                </select>
            </label>
        </div>}
        <table className={className}>
            <caption className="sr-only">{ru ? 'Каналы публикации по площадкам' : 'Publication channels grouped by platform'}</caption>
            <thead><tr>
                <th scope="col">{ru ? 'Канал' : 'Channel'}</th>
                <th scope="col">{ru ? 'Площадка' : 'Platform'}</th>
                <th scope="col">{ru ? 'Режим' : 'Workflow'}</th>
                <th scope="col">{ru ? 'Подключение' : 'Connection'}</th>
                <th scope="col">{ru ? 'Идентификатор' : 'Identifier'}</th>
                <th scope="col" className="channel-table__actions-heading">{ru ? 'Действия' : 'Actions'}</th>
            </tr></thead>
            {groups.map(group => <tbody key={group.key} data-platform-key={group.key} aria-labelledby={`${prefix}-${encodeURIComponent(group.key)}`}>
                <tr className="channel-list__group"><th scope="rowgroup" colSpan={6} id={`${prefix}-${encodeURIComponent(group.key)}`}>
                    <span>{group.label}</span><span className="channel-list__count">{group.channels.length}</span>
                </th></tr>
                {group.channels.map(children)}
            </tbody>)}
        </table>
    </>;
}
