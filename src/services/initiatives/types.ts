export type InitiativeKind = 'publication' | 'event' | 'campaign' | 'infrastructure';
export type DependencyType = 'blocks' | 'requires' | 'not_before' | 'informs';
export type DependencyConfirmationState = 'none' | 'confirmed';

export type DependencyConfirmationInput = {
    type: string;
    sourceStatus: string;
    sourceKey: string;
};

export interface ExternalInitiativeInput {
    external_key: string;
    kind: string;
    subtype?: string;
    title: string;
    description?: string;
    status?: string;
    due_at?: string;
    start_at?: string;
    end_at?: string;
    decision_at?: string;
    event_at?: string;
    measurement_at?: string;
}

export interface ExternalDependencyInput {
    from: string;
    to: string;
    type?: string;
    condition?: string;
}

export interface ExternalOperationalPlan {
    initiatives?: ExternalInitiativeInput[];
    dependencies?: ExternalDependencyInput[];
}
