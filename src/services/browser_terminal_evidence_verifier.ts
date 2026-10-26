import {hash,type BrowserRequest} from './browser_publication_contract';
import {terminalEvidence,type TerminalMetadata} from './browser_terminal_evidence_contract';
import {createTerminalReadVerifier} from './browser_terminal_source_semantics';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// Bind to the actual collector packaged with this application release.
const collector=()=>hash(readFileSync(join(__dirname,'../../ops/original-terminal-source/collect.cjs'),'utf8'));
export type TerminalBinding={projectId:number;taskId:number;attemptId:number;workItemId:number;keySha256:string;leaseSha256:string;snapshotSha256:string;approvalSha256:string;publisherActorSha256:string;createdAtMs:number;snapshot:BrowserRequest['snapshot']};
function refuse(reason:string):never{throw new Error(`[TERMINAL_${reason}] Original source or Published coverage is incomplete. Preserve this attempt and obtain complete evidence from its original profile.`);}
function checkWindow(e:TerminalMetadata,b:TerminalBinding,now:number):void{
 const w=e.providerWindow,identity=b.snapshot.identity;
 if(w.profileUrl!==identity.profileUrl||w.providerAccountId!==identity.providerAccountId||w.accountType!==identity.accountType)refuse('PROFILE_MISMATCH');
 if(w.startedAtMs>w.observedAtMs||w.observedAtMs>now+5000||w.startedAtMs<now-180000||w.observedAtMs<b.createdAtMs)refuse('WINDOW_STALE');
 const ids=new Set<string>(),sources=new Set<string>();let previous=Infinity,oldest=Infinity;
 for(let i=0;i<w.pages.length;i++){
  const page=w.pages[i]!;
  if(sources.has(page.sourceCallId)||page.ordinal!==i+1||page.previousPageSha256!==(i===0?null:hash(JSON.stringify(w.pages[i-1]))))refuse('WINDOW_GAP');
  sources.add(page.sourceCallId);
  for(const item of page.items){
   if(ids.has(item.providerId)||item.earliestMs>item.latestMs||item.latestMs>previous||item.latestMs>w.observedAtMs+5000)refuse('WINDOW_ORDER');
   ids.add(item.providerId);previous=item.latestMs;oldest=item.latestMs;
   if(item.bodySha256===b.snapshot.bodySha256)refuse('POSSIBLE_DUPLICATE');
  }
 }
 if(oldest>=b.createdAtMs)refuse('WINDOW_CUTOFF');
}
/** Common canonical source/window checks, without synthesizing native programs or acknowledgements. */
export function checkTerminalMetadata(e:TerminalMetadata,b:TerminalBinding,now:number):void{
 const o=e.observation,s=e.originalStart;
 const start=Date.parse(o.start.timestamp),end=Date.parse(o.end.timestamp);
 if(e.collectorSha256!==collector()||!e.controlReference.startsWith(`codex-control://local/thread/${o.threadId}/turn/${o.turnId}/call/`))refuse('SOURCE_BINDING');
 if(start>end||end<b.createdAtMs||start>b.createdAtMs||end>now+5000||s.ordinal<=o.start.ordinal||s.ordinal>=o.end.ordinal)refuse('SOURCE_CHRONOLOGY');
 for(const key of ['projectId','taskId','attemptId','workItemId','keySha256','leaseSha256','snapshotSha256'] as const)if(s[key]!==b[key])refuse('ORIGINAL_START_MISMATCH');
 if(!o.operations.length)refuse('SOURCE_GAP');
 const calls=new Set<string>(),positions=new Set<number>();let previousTerminal=o.start.ordinal;
 if(b.snapshot.identity.platform!=='linkedin'||b.snapshot.identity.accountType!=='company_page')refuse('PROFILE_UNSUPPORTED');
 for(let i=0;i<o.operations.length;i++){
  const op=o.operations[i]!;
  if(calls.has(op.callId)||positions.has(op.ordinal)||positions.has(op.terminalOrdinal)||op.ordinal<=previousTerminal||op.terminalOrdinal<=op.ordinal||op.terminalOrdinal>=o.end.ordinal||op.completedAtMs<start||op.completedAtMs>end||op.status!=='completed')refuse('SOURCE_GAP');
  calls.add(op.callId);positions.add(op.ordinal);positions.add(op.terminalOrdinal);
  previousTerminal=op.terminalOrdinal;
 }
 if(positions.has(s.ordinal)||calls.has(s.callId))refuse('ORIGINAL_START_MISMATCH');
 checkWindow(e,b,now);
}
export function terminalEvidenceSummary(e:TerminalMetadata,b:TerminalBinding,now:number,evidenceSha256:string){
 return {evidence_class:'OWNER_VERIFIED_TERMINAL_OPERATIONS_V1',evidence_sha256:evidenceSha256,archive_sha256:e.archiveSha256,collector_sha256:e.collectorSha256,
  source_reference_sha256:hash(e.controlReference),profile_sha256:hash(JSON.stringify(b.snapshot.identity)),original_key_sha256:b.keySha256,old_lease_sha256:b.leaseSha256,
  package_sha256:b.snapshotSha256,approval_sha256:b.approvalSha256,publisher_actor_sha256:b.publisherActorSha256,attempt_id:b.attemptId,work_item_id:b.workItemId,created_at_ms:now,expires_at_ms:Math.min(now+180000,e.providerWindow.startedAtMs+180000),
  operation_count:e.observation.operations.length,window_sha256:hash(JSON.stringify(e.providerWindow)),submission_permitted:false};
}
/** Local raw validation for the original computer and isolated tests; no raw-source MCP intake. */
export function verifyTerminalEvidence(input:unknown,b:TerminalBinding,now:number){
 const parsed=terminalEvidence.safeParse(input);if(!parsed.success)refuse('EVIDENCE_INVALID');const e=parsed.data;
 checkTerminalMetadata(e,b,now);
 if(e.observation.operations.length!==e.declarations.length)refuse('SOURCE_GAP');
 const verify=createTerminalReadVerifier(e.browserInstanceId,`https://www.linkedin.com/company/${b.snapshot.identity.providerAccountId}/admin/page-posts/published/`);
 for(let i=0;i<e.observation.operations.length;i++){
  const op=e.observation.operations[i]!,declaration=e.declarations[i]!;
  if(op.callId!==declaration.callId||op.argumentsSha256!==hash(declaration.argumentsJson))refuse('SOURCE_DIGEST');
  try{verify(declaration.argumentsJson);}catch(error:unknown){if(error instanceof Error)refuse('SOURCE_EFFECT_UNSUPPORTED');throw error;}
 }
 return terminalEvidenceSummary(e,b,now,hash(JSON.stringify(e)));
}
