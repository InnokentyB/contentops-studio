import Markdown from 'markdown-to-jsx';

type ContentMarkupRendererProps = {
    content?: string | null;
    contentType?: 'markdown' | 'html' | 'auto';
    title?: string;
    emptyMessage?: string;
    className?: string;
    platform?: string;
    postTitle?: string;
    postTags?: string[];
    imageUrl?: string;
    authorName?: string;
};

function inferContentType(content: string, explicitType?: 'markdown' | 'html' | 'auto') {
    if (explicitType && explicitType !== 'auto') {
        return explicitType;
    }

    if (/<[a-z][\s\S]*>/i.test(content)) {
        return 'html';
    }

    return 'markdown';
}

function buildHtmlDocument(content: string) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
        --text: #172033;
        --muted: #576079;
        --border: rgba(61, 71, 109, 0.14);
        --accent: #333697;
        --surface: #ffffff;
        --soft: #f5f7fb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 24px;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--surface);
        line-height: 1.7;
      }

      h1, h2, h3, h4, h5, h6 {
        color: var(--text);
        line-height: 1.15;
        margin: 0 0 0.9em;
      }

      h1 {
        font-size: 2rem;
      }

      h2 {
        font-size: 1.55rem;
        margin-top: 1.8em;
      }

      h3 {
        font-size: 1.25rem;
        margin-top: 1.5em;
      }

      p, ul, ol, blockquote, pre, table {
        margin: 0 0 1.1em;
      }

      a {
        color: var(--accent);
      }

      ul, ol {
        padding-left: 1.4rem;
      }

      blockquote {
        border-left: 3px solid var(--accent);
        padding-left: 1rem;
        color: var(--muted);
      }

      code {
        background: var(--soft);
        border-radius: 0.5rem;
        padding: 0.15rem 0.4rem;
        font-size: 0.92em;
      }

      pre {
        background: #101522;
        color: #eef2ff;
        border-radius: 1rem;
        padding: 1rem 1.1rem;
        overflow: auto;
      }

      pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }

      img {
        max-width: 100%;
        height: auto;
        display: block;
        border-radius: 1rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        border: 1px solid var(--border);
        padding: 0.7rem 0.8rem;
        text-align: left;
      }
    </style>
  </head>
  <body>${content}</body>
</html>`;
}

export default function ContentMarkupRenderer({
    content,
    contentType = 'auto',
    title = 'content-preview',
    emptyMessage = 'No content loaded yet.',
    className = '',
    platform,
    postTitle,
    postTags,
    imageUrl,
    authorName
}: ContentMarkupRendererProps) {
    const safeContent = content?.trim() || '';

    if (!safeContent) {
        return (
            <div className={`rounded-[1.5rem] bg-white/70 px-5 py-6 text-sm italic text-on-surface-variant ${className}`}>
                {emptyMessage}
            </div>
        );
    }

    const resolvedType = inferContentType(safeContent, contentType);

    const wordCount = safeContent.split(/\s+/).filter(Boolean).length;
    const readTime = Math.max(1, Math.round(wordCount / 180));

    let renderedContent: React.ReactNode;
    if (resolvedType === 'html') {
        renderedContent = (
            <div className="rounded-[1.25rem] overflow-hidden border border-outline-variant/10 bg-white">
                <iframe
                    title={title}
                    sandbox=""
                    srcDoc={buildHtmlDocument(safeContent)}
                    className="w-full min-h-[420px] bg-white"
                />
            </div>
        );
    } else {
        renderedContent = (
            <div className="prose prose-slate max-w-none prose-headings:font-headline prose-headings:font-black prose-headings:tracking-tight prose-p:leading-7 prose-p:text-on-surface prose-strong:text-on-surface prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-primary prose-blockquote:text-on-surface-variant prose-li:marker:text-primary prose-code:rounded prose-code:bg-surface-container-low prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.92em] prose-pre:rounded-[1.25rem] prose-pre:bg-[#101522] prose-pre:text-[#eef2ff]">
                <Markdown>{safeContent}</Markdown>
            </div>
        );
    }

    const lowerPlatform = platform?.toLowerCase() || '';
    const isHabr = lowerPlatform.includes('habr');
    const isVC = lowerPlatform.includes('vc');
    const isZen = lowerPlatform.includes('zen') || lowerPlatform.includes('dzen');

    if (isHabr) {
        return (
            <div className={`bg-[#f5f5f5] p-3 sm:p-5 rounded-[1.5rem] border border-outline-variant/10 ${className}`}>
                <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm space-y-4 font-sans text-[#333] text-left">
                    <div className="flex items-center gap-3 text-xs text-[#909090]">
                        <div className="w-6 h-6 rounded bg-[#497096] text-white flex items-center justify-center font-bold text-[10px]">H</div>
                        <div>
                            <span className="font-bold text-[#4e729a] hover:underline cursor-pointer">{authorName || 'habr_author'}</span>
                            <span className="mx-2">•</span>
                            <span>сегодня в 12:34</span>
                        </div>
                        <span className="ml-auto bg-[#f0f0f0] px-2 py-0.5 rounded text-[10px] whitespace-nowrap">{readTime} мин на чтение</span>
                    </div>
                    
                    {postTitle && <h1 className="text-xl sm:text-2xl font-bold leading-tight text-[#111]">{postTitle}</h1>}
                    
                    <div className="flex flex-wrap gap-1.5">
                        {(postTags && postTags.length > 0 ? postTags : ['Системный анализ', 'Управление разработкой', 'IT-карьера']).map((tag, idx) => (
                            <span key={idx} className="text-[10px] sm:text-xs bg-[#f4f7fa] text-[#4c6680] px-2 py-0.5 rounded-full font-medium hover:bg-[#e4ebf2] cursor-pointer">
                                {tag}
                            </span>
                        ))}
                    </div>

                    {imageUrl && (
                        <div className="my-4 rounded-xl overflow-hidden max-h-72 border border-[#eee]">
                            <img src={imageUrl} alt="Cover" className="w-full h-full object-cover" />
                        </div>
                    )}

                    <div className="border-t border-[#f0f0f0] pt-4 mt-4 text-sm sm:text-base leading-relaxed">
                        {renderedContent}
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6 pt-4 border-t border-[#f0f0f0] text-xs text-[#909090] font-semibold">
                        <div className="flex items-center gap-1 hover:text-[#555] cursor-pointer">
                            <span>🔥</span>
                            <span>+42</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span>👁️</span>
                            <span>2.4k</span>
                        </div>
                        <div className="flex items-center gap-1 hover:text-[#555] cursor-pointer">
                            <span>🔖</span>
                            <span>18</span>
                        </div>
                        <div className="flex items-center gap-1 hover:text-[#555] cursor-pointer">
                            <span>💬</span>
                            <span>12</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isVC) {
        return (
            <div className={`bg-[#f2f2f2] p-3 sm:p-5 rounded-[1.5rem] border border-outline-variant/10 ${className}`}>
                <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm space-y-4 font-sans text-[#000] text-left">
                    <div className="flex items-center gap-3 text-xs text-[#595959]">
                        <div className="w-8 h-8 rounded-full bg-[#e30613] text-white flex items-center justify-center font-bold text-xs shrink-0">vc</div>
                        <div>
                            <div className="flex items-center gap-1">
                                <span className="font-bold text-[#000] hover:underline cursor-pointer">{authorName || 'Блог компании'}</span>
                                <span className="bg-[#f0f0f0] text-[9px] px-1 py-0.5 rounded text-[#888] font-bold">БЛОГ</span>
                            </div>
                            <div className="text-[10px] text-[#888] mt-0.5">сегодня • {readTime} мин</div>
                        </div>
                    </div>
                    
                    {postTitle && <h1 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight leading-tight text-[#000]">{postTitle}</h1>}

                    {imageUrl && (
                        <div className="my-4 rounded-xl overflow-hidden max-h-80">
                            <img src={imageUrl} alt="VC Cover" className="w-full h-full object-cover" />
                        </div>
                    )}

                    <div className="mt-4 text-sm sm:text-base leading-relaxed">
                        {renderedContent}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-[#f5f5f5] text-xs text-[#595959]">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1 bg-[#f9f9f9] px-2.5 py-1 rounded-full font-bold hover:bg-[#eaeaea] cursor-pointer">
                                <span>💬</span>
                                <span>24</span>
                            </div>
                            <div className="flex items-center gap-1 hover:text-black cursor-pointer">
                                <span>🔖</span>
                            </div>
                            <div className="flex items-center gap-1 hover:text-black cursor-pointer">
                                <span>🔗</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-green-600 font-bold hover:bg-green-50 px-2 py-1 rounded cursor-pointer">+18</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isZen) {
        return (
            <div className={`bg-[#fafafa] p-3 sm:p-5 rounded-[1.5rem] border border-outline-variant/10 ${className}`}>
                <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm space-y-4 font-sans text-[#222] text-left max-w-xl mx-auto">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#111] text-white flex items-center justify-center font-serif text-lg font-black shrink-0">Д</div>
                        <div>
                            <div className="font-bold text-[#111] hover:underline cursor-pointer">{authorName || 'Дзен Блог'}</div>
                            <div className="text-[11px] text-[#8e8e8e]">1.2k подписчиков • сегодня</div>
                        </div>
                    </div>

                    {postTitle && <h1 className="text-lg sm:text-xl font-extrabold leading-tight text-[#111]">{postTitle}</h1>}

                    {imageUrl && (
                        <div className="my-4 rounded-xl overflow-hidden max-h-72">
                            <img src={imageUrl} alt="Zen Cover" className="w-full h-full object-cover" />
                        </div>
                    )}

                    <div className="text-[#333] leading-relaxed text-sm sm:text-base pt-2">
                        {renderedContent}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-[#f0f0f0] text-xs text-[#8e8e8e]">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1 hover:text-[#111] cursor-pointer">
                                <span>👍</span>
                                <span>124</span>
                            </div>
                            <div className="flex items-center gap-1 hover:text-[#111] cursor-pointer">
                                <span>💬</span>
                                <span>8</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <span>👁️</span>
                            <span>1.8k просмотров • {readTime} мин</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`rounded-[1.5rem] bg-white px-6 py-6 ${className}`}>
            {renderedContent}
        </div>
    );
}
