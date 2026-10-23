import {PublicationDiagnosticError} from './publication_diagnostics';

const catalog:Record<string,{code:string;message:string;action:string}>={
    PUBLICATION_HOLD_ACTIVE:{code:'PREPARE_READINESS_HOLD_ACTIVE',
        message:'An audited publication hold is active; preparation cannot clear it.',
        action:'Read the task hold and resolve it through the supported Owner recovery workflow before preparing. Preserve any uncertain attempt.'},
    VISUAL_REASSESSMENT_BINDING_INVALID:{code:'PREPARE_READINESS_VISUAL_BINDING_INVALID',
        message:'The stored visual reassessment binding is inconsistent.',
        action:'Ask engineering to inspect the current reassessment request audit. Do not repeat an old visual approval or reset its history.'},
    PUBLICATION_VISUAL_REVIEW_REQUIRED:{code:'PREPARE_READINESS_VISUAL_REVIEW_REQUIRED',
        message:'The current Owner-requested visual reassessment has no matching completed independent review.',
        action:'Complete the current art-direction and independent visual-review work, then prepare the same accepted package.'},
    VISUAL_REASSESSMENT_GENERATION_CONFLICT:{code:'PREPARE_READINESS_VISUAL_GENERATION_CONFLICT',
        message:'The current package no longer matches the persisted visual reassessment generation.',
        action:'Read the current art-direction context and resolve its exact generation/package binding before preparation.'},
    VISUAL_REASSESSMENT_DECISION_CONFLICT:{code:'PREPARE_READINESS_VISUAL_DECISION_CONFLICT',
        message:'The selected asset does not belong to the current reassessment decision.',
        action:'Use the asset and decision from the current reassessment and complete its independent review before preparation.'},
    OWNED_LIFECYCLE_IMMUTABLE:{code:'PREPARE_READINESS_EXISTING_AUTHORITY',
        message:'A persisted provider-owned publication lifecycle prevents generic preparation.',
        action:'Read and reconcile that existing lifecycle through its supported provider workflow; do not reset publication status.'}
};

/** Translate only known static gate codes; never expose the original error payload. */
export function preparationDiagnosticError(error:unknown):unknown{
    if(!(error instanceof Error)||error instanceof PublicationDiagnosticError)return error;
    const key=/^\[([A-Z_]+)\]/.exec(error.message)?.[1],entry=key?catalog[key]:undefined;
    if(!entry)return error;
    return new PublicationDiagnosticError({code:entry.code,message:entry.message,retry_allowed:false,
        reasons:[{code:entry.code,field:'publication_preparation',message:entry.message,action:entry.action}]});
}
