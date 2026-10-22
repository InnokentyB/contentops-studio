type PublicationChannel = { id: number; name: string; type: string };
type ChannelLocale = 'ru' | 'en';
type ChannelGroup<T> = { key: string; label: string; channels: T[] };

const platformLabels: Record<string, Record<ChannelLocale, string>> = {
    telegram: { ru: 'Telegram', en: 'Telegram' },
    vk: { ru: 'ВКонтакте', en: 'VKontakte (VK)' },
    ok: { ru: 'Одноклассники', en: 'Odnoklassniki (OK)' },
    habr: { ru: 'Хабр', en: 'Habr' },
    vc: { ru: 'VC.ru', en: 'VC.ru' },
    dzen: { ru: 'Дзен', en: 'Dzen' },
    threads: { ru: 'Threads', en: 'Threads' },
    medium: { ru: 'Medium', en: 'Medium' },
    linkedin: { ru: 'LinkedIn', en: 'LinkedIn' },
    x: { ru: 'X', en: 'X' },
    instagram: { ru: 'Instagram', en: 'Instagram' },
    youtube: { ru: 'YouTube', en: 'YouTube' },
};

/** Return a deterministic display order without mutating channels or replacing record identity. */
export function groupPublicationChannels<T extends PublicationChannel>(
    channels: readonly T[], locale: ChannelLocale, direction: 'asc' | 'desc',
): ChannelGroup<T>[] {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const groups = new Map<string, ChannelGroup<T>>();
    for (const channel of channels) {
        const key = ['zen', 'dzen', 'zen_article'].includes(channel.type) ? 'dzen' : channel.type;
        let group = groups.get(key);
        if (!group) {
            group = { key, label: Object.hasOwn(platformLabels, key) ? platformLabels[key][locale] : key, channels: [] };
            groups.set(key, group);
        }
        group.channels.push(channel);
    }
    const nameDirection = direction === 'asc' ? 1 : -1;
    for (const group of groups.values()) {
        group.channels.sort((left, right) => nameDirection * collator.compare(left.name, right.name) || left.id - right.id);
    }
    return [...groups.values()].sort((left, right) => collator.compare(left.label, right.label) || collator.compare(left.key, right.key));
}
