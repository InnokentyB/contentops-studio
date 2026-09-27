export type LinkedInContentIssueCode =
    | 'empty'
    | 'too_long'
    | 'markdown_styling'
    | 'unsupported_bullet'
    | 'block_spacing'
    | 'single_newline'
    | 'paragraph_too_long'
    | 'bullet_too_long';

export type LinkedInContentIssue = {
    code: LinkedInContentIssueCode;
    blockIndex: number | null;
};

export type LinkedInContentValidation = {
    valid: boolean;
    issues: LinkedInContentIssue[];
};

export type LinkedInSemanticBlockMismatch = {
    index: number;
    expected: string | null;
    actual: string | null;
};

export type LinkedInSemanticComparison = {
    matches: boolean;
    expectedBlockCount: number;
    actualBlockCount: number;
    firstMismatch: LinkedInSemanticBlockMismatch | null;
};

const LINKEDIN_MAX_CHARS = 3000;
const PROSE_BLOCK_MAX_CHARS = 280;
const BULLET_LINE_MAX_CHARS = 180;
const SUPPORTED_BULLET = /^\s*[•◦▪]\s+\S/;
const LIST_LIKE_PREFIX = /^\s*(?:[-+*•◦▪]\s+|\d+[.)]\s+)/;
const MARKDOWN_STYLING = /(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s|```|~~~)|\*\*|__|`|\[[^\]]+\]\([^)]+\)/;

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}

function addIssue(
    issues: LinkedInContentIssue[],
    code: LinkedInContentIssueCode,
    blockIndex: number | null
): void {
    if (!issues.some((issue) => issue.code === code)) {
        issues.push({ code, blockIndex });
    }
}

function semanticBlocks(text: string): string[] {
    const normalized = normalizeLineEndings(text)
        .replace(/\u00a0/g, ' ')
        .trim();

    if (!normalized) return [];

    return normalized.split(/\n{2,}/).map((block) => block
        .split('\n')
        .map((line) => line.trim().replace(/[\t ]+/g, ' '))
        .filter(Boolean)
        .join('\n'));
}

/** Validates an accepted body against the LinkedIn-native formatting contract. */
export function validateLinkedInNativeText(text: string): LinkedInContentValidation {
    const normalized = normalizeLineEndings(text).trim();
    const issues: LinkedInContentIssue[] = [];

    if (!normalized) {
        return { valid: false, issues: [{ code: 'empty', blockIndex: null }] };
    }
    if (normalized.length > LINKEDIN_MAX_CHARS) addIssue(issues, 'too_long', null);
    if (MARKDOWN_STYLING.test(normalized)) addIssue(issues, 'markdown_styling', null);
    if (/\n{3,}/.test(normalized)) addIssue(issues, 'block_spacing', null);

    const blocks = normalized.split(/\n{2,}/);
    blocks.forEach((block, blockIndex) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
        const bulletLines = lines.filter((line) => SUPPORTED_BULLET.test(line));
        const unsupportedListLine = lines.some((line) => LIST_LIKE_PREFIX.test(line) && !SUPPORTED_BULLET.test(line));

        if (unsupportedListLine) addIssue(issues, 'unsupported_bullet', blockIndex);
        if (bulletLines.length === lines.length && lines.length > 0) {
            if (bulletLines.some((line) => line.length > BULLET_LINE_MAX_CHARS)) {
                addIssue(issues, 'bullet_too_long', blockIndex);
            }
            return;
        }
        if (block.length > PROSE_BLOCK_MAX_CHARS) addIssue(issues, 'paragraph_too_long', blockIndex);
        if (lines.length > 1 && lines.some((line) => !LIST_LIKE_PREFIX.test(line))) {
            addIssue(issues, 'single_newline', blockIndex);
        }
    });

    return { valid: issues.length === 0, issues };
}

/** Compares accepted and provider-returned LinkedIn bodies by semantic blocks. */
export function compareLinkedInSemanticBlocks(
    expected: string,
    actual: string
): LinkedInSemanticComparison {
    const expectedBlocks = semanticBlocks(expected);
    const actualBlocks = semanticBlocks(actual);
    const maxLength = Math.max(expectedBlocks.length, actualBlocks.length);
    let firstMismatch: LinkedInSemanticBlockMismatch | null = null;

    for (let index = 0; index < maxLength; index += 1) {
        const expectedBlock = expectedBlocks[index] ?? null;
        const actualBlock = actualBlocks[index] ?? null;
        if (expectedBlock !== actualBlock) {
            firstMismatch = { index, expected: expectedBlock, actual: actualBlock };
            break;
        }
    }

    return {
        matches: firstMismatch === null,
        expectedBlockCount: expectedBlocks.length,
        actualBlockCount: actualBlocks.length,
        firstMismatch
    };
}
