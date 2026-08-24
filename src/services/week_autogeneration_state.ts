export type WeekAutomationStage =
    | 'awaiting_theme'
    | 'awaiting_theme_approval'
    | 'generating_topics'
    | 'awaiting_topic_approval'
    | 'topics_rejected'
    | 'writing'
    | 'content_review'
    | 'visual_production'
    | 'ready_for_publication';

export interface WeekAutomationStateInput {
    themeExists: boolean;
    themeAccepted: boolean;
    topicCount: number;
    planDecision: string | null;
    activeWriteCount: number;
    activeReviewCount: number;
    activeVisualCount: number;
}

const STAGE_GUIDANCE: Record<WeekAutomationStage, { actor: string; command: string; description: string }> = {
    awaiting_theme: {
        actor: 'headquarters',
        command: 'ba_start_week_autogeneration',
        description: 'Штаб задаёт и принимает тему недели; Planner создаёт семь тем публикаций.'
    },
    awaiting_theme_approval: {
        actor: 'headquarters',
        command: 'ba_start_week_autogeneration',
        description: 'Штаб принимает текущую редакцию темы недели и запускает генерацию семи тем.'
    },
    generating_topics: {
        actor: 'planner',
        command: 'ba_generate_week_topic_preview',
        description: 'Planner должен собрать ровно семь тем, по одной на каждый день недели.'
    },
    awaiting_topic_approval: {
        actor: 'headquarters',
        command: 'ba_decide_week_plan',
        description: 'Штаб проверяет семь тем и утверждает или отклоняет пакет целиком.'
    },
    topics_rejected: {
        actor: 'planner',
        command: 'ba_start_week_autogeneration',
        description: 'Planner уточняет тему недели и формирует новую редакцию семи тем.'
    },
    writing: {
        actor: 'writer',
        command: 'ba_list_work_items',
        description: 'Writer забирает задания content_write, генерирует тексты и сдаёт результат через ba_complete_work_item.'
    },
    content_review: {
        actor: 'headquarters',
        command: 'ba_decide_approval',
        description: 'Штаб или редактор принимает проверенный текст либо возвращает его writer с комментарием.'
    },
    visual_production: {
        actor: 'art_director',
        command: 'ba_list_work_items',
        description: 'Art Director обрабатывает задания art_direction и готовит визуальные материалы.'
    },
    ready_for_publication: {
        actor: 'publisher',
        command: 'ba_list_publication_tasks',
        description: 'Тексты приняты, обязательные визуальные этапы завершены; материалы можно готовить к публикации.'
    }
};

export function deriveWeekAutomationState(input: WeekAutomationStateInput) {
    let stage: WeekAutomationStage;
    if (!input.themeExists) stage = 'awaiting_theme';
    else if (!input.themeAccepted) stage = 'awaiting_theme_approval';
    else if (input.topicCount !== 7) stage = 'generating_topics';
    else if (input.planDecision === 'rejected') stage = 'topics_rejected';
    else if (input.planDecision !== 'approved') stage = 'awaiting_topic_approval';
    else if (input.activeWriteCount > 0) stage = 'writing';
    else if (input.activeReviewCount > 0) stage = 'content_review';
    else if (input.activeVisualCount > 0) stage = 'visual_production';
    else stage = 'ready_for_publication';

    return { stage, next_action: STAGE_GUIDANCE[stage] };
}
