import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {LegacyBrowserRecovery} from '../../services/legacy_browser_recovery';
import {legacyBrowserOutcome} from '../../services/legacy_browser_recovery';
import {legacyRecoveryRequest} from '../../services/legacy_browser_recovery_contract';
import {publicationDiagnosticResult} from './publication_diagnostic_result';
import {INTERNAL_MUTATION_ANNOTATIONS} from './common';
import type {PublicationDiagnostic} from '../../services/publication_diagnostics';
function diagnostic(code:string):PublicationDiagnostic{
 const value=legacyBrowserOutcome(code);
 return {code:value.code,message:value.message,retry_allowed:false,reasons:[{code:value.code,field:'recovery',message:value.message,action:value.action}]};
}
/** Database-only preview is available; adoption is hidden until the application supplies registered ports. */
export function registerLegacyBrowserRecoveryTools(server:McpServer,service:LegacyBrowserRecovery):void{
 const projection=(result:Record<string,unknown>)=>({payload:result,...(typeof result.code==='string'&&!['RECOVERY_PREPARE_RESUMED','RECONCILIATION_FOUND'].includes(result.code)?{diagnostic:diagnostic(result.code),isError:result.code==='RECOVERY_INPUT_INVALID'}:{})});
 server.registerTool('ba_preview_browser_preparation_recovery',{
  description:'Owner-scoped read-only preview of historical pre-first-permit recovery. Reads current release/attempt/custody; no provider access, proof claim, lease rotation, send or recovery write.',
  annotations:{readOnlyHint:true},inputSchema:legacyRecoveryRequest.shape
 },async args=>publicationDiagnosticResult('browser',()=>service.preview(args),()=>diagnostic('RECOVERY_INPUT_INVALID'),projection));
 if(!service.available())return;
 server.registerTool('ba_adopt_browser_preparation_recovery',{
  description:'Audited historical attempt adoption only before the first permit, using application-registered technical fencing and the existing permitted profile reader. Preserves attempt/history; may reconcile a verified existing fact or queue the same supervised generation. Never submits. Missing/incomplete custody remains UNKNOWN.',
  annotations:INTERNAL_MUTATION_ANNOTATIONS,inputSchema:legacyRecoveryRequest.shape
 },async args=>publicationDiagnosticResult('browser',()=>service.adopt(args),()=>diagnostic('RECOVERY_INPUT_INVALID'),projection));
}
