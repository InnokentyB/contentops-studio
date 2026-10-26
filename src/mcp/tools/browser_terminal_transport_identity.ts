import type {RemotePrincipal} from '../remote-auth';
import {currentPublicationPrincipal} from '../publication-principal';
/** Every action uses the authenticated request, never a captured session as a fallback identity. */
export function terminalTransportIdentity(session:Readonly<RemotePrincipal>|null|undefined,projectId:number){
 const current=currentPublicationPrincipal();
 if(!current||!session)throw new Error('[TERMINAL_CURRENT_PRINCIPAL_REQUIRED]');
 if(current.userId!==session.userId||current.actorId!==session.actorId||current.profile!==session.profile
  ||(session.projectId!==undefined&&current.projectId!==session.projectId)
  ||(current.projectId!==undefined&&current.projectId!==projectId)
  ||(current.profile==='publisher'&&current.projectId===undefined))throw new Error('[TERMINAL_REQUEST_PRINCIPAL_MISMATCH]');
 return {userId:current.userId,actorId:current.actorId,projectId:current.projectId??projectId,profile:current.profile};
}
