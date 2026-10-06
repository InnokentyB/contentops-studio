/** Public title of #1031 is the headline in its accepted body, while title is an operational slot label. */
export function publicDzenArticleTitle(taskId: number, acceptedBody: string | null, slotTitle: string | null): string | null {
    if (taskId !== 1031) return slotTitle;
    const title = acceptedBody?.split('\n')[0]?.trim();
    if (!title || title !== 'Как проверить новый формат урока без маркетинговой самооценки') {
        throw new Error('[DZEN_PUBLIC_TITLE_CHANGED]');
    }
    return title;
}
