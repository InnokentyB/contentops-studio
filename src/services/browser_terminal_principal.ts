import {terminalPrincipal,type TerminalPrincipal} from './browser_terminal_evidence_contract';
import {browserRecoveryEnabled} from './browser_recovery_guard';
/** Authenticated server-session identity, never an identity selected by source evidence. */
export function requireTerminalPrincipal(input:unknown,projectId:number,purpose:'owner'|'publisher',requireAdmission=true):TerminalPrincipal{
 const p=terminalPrincipal.parse(input);
 if(p.projectId!==projectId||p.actorId!==`user:${p.userId}`||p.profile!==purpose)throw new Error(purpose==='owner'?'[TERMINAL_OWNER_REQUIRED] Only the authenticated Owner can review evidence or transfer this original attempt.':'[TERMINAL_PUBLISHER_REQUIRED] Only the original project-scoped Publisher can pick up or dispatch this generation.');
 if(requireAdmission&&!browserRecoveryEnabled())throw new Error('[TERMINAL_RECOVERY_DISABLED] The recovery release is not enabled. Preserve the original attempt.');
 return p;
}
