export interface VisualGenerationGateInput {
    weekPackageId?: number | null;
    weekApprovalStatus?: string | null;
    textState?: string | null;
    acceptedRevision?: number | null;
    contentRevision: number;
    decisionType?: string | null;
    decisionSourceRevision?: number | null;
    channelId?: number | null;
    channelName?: string | null;
    channelType: string;
    placement: string;
    decisionChannel?: string | null;
    decisionPlacement?: string | null;
    prompt?: string | null;
    altText?: string | null;
}

export function assertVisualGenerationGate(input: VisualGenerationGateInput) {
    if (input.weekPackageId && input.weekApprovalStatus !== 'approved') {
        throw new Error('[WEEK_PLAN_NOT_APPROVED] Visual generation requires an approved weekly topic plan');
    }
    if (input.textState !== 'accepted' || !input.acceptedRevision || input.acceptedRevision !== input.contentRevision) {
        throw new Error('[TEXT_NOT_ACCEPTED] Visual generation requires the current accepted text revision');
    }
    if (input.decisionType !== 'GENERATE' || input.decisionSourceRevision !== input.acceptedRevision) {
        throw new Error('[VISUAL_BRIEF_NOT_APPROVED] An active GENERATE decision for the accepted revision is required');
    }
    const decisionChannel = input.decisionChannel?.trim().toLowerCase();
    const channelBindings = [
        input.channelType,
        input.channelName,
        input.channelId != null ? String(input.channelId) : null
    ].filter((value): value is string => Boolean(value)).map((value) => value.trim().toLowerCase());
    if (!decisionChannel || !channelBindings.includes(decisionChannel) || input.decisionPlacement !== input.placement) {
        throw new Error('[VISUAL_DECISION_BINDING_MISMATCH] Decision channel and placement must match the current task');
    }
    if (!input.prompt?.trim()) {
        throw new Error('[VISUAL_PROMPT_REQUIRED] The approved visual brief must contain a prompt');
    }
    if (!input.altText?.trim()) {
        throw new Error('[ALT_TEXT_REQUIRED] An approved visual brief must contain alt text');
    }
}

export function hardenEditorialVisualPrompt(prompt: string) {
    return `${prompt.trim()}

MANDATORY PRODUCTION CONSTRAINTS:
- No visible text, letters, numbers, captions, labels, logos, watermarks, or invented claims.
- No user-interface panels, screens, dashboards, buttons, chat bubbles, diagrams, arrows, or comic-strip framing.
- No people, office teams, handshakes, meetings, or stock-photo business scenes.
- Use one independent editorial metaphor with one clear focal object and strong thumbnail readability.
- The visual must add a distinct function; it must not retell the post scene by scene.`;
}
