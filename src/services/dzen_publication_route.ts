export function dzenPublicationTypeForAction(
    actionType: string,
    channelType: string,
    defaultPublicationType?: string | null
): 'article' | 'post' {
    const action = actionType.toLowerCase();
    if (action.includes('article') || channelType === 'zen_article') return 'article';
    if (action.includes('feed') || action.includes('post')) return 'post';
    return defaultPublicationType === 'post' ? 'post' : 'article';
}
