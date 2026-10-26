import ts from 'typescript';
const plannerReads=new Set(['ba_get_publication_task','ba_get_publication_fact','ba_get_work_item_context','ba_get_agent_workspace_manifest','ba_diagnose_browser_publication','ba_list_work_items','ba_list_publication_tasks','ba_get_publication_task_resources','ba_list_project_channels','ba_read_publication_plan_asset','ba_get_agent_chat_bootstrap']);
const plannerWrites=new Set(['ba_start_browser_submission','ba_pre_submit_browser_submission','ba_confirm_browser_submission','ba_mark_browser_submission_uncertain','ba_claim_browser_publication','ba_release_browser_publication']);
/** Local diagnostic only; recognized spellings do not establish transport binding or permission. */
export function terminalExternalShape(raw:string){
 if(raw.length>262144)throw new Error('[TERMINAL_EXTERNAL_SHAPE_LIMIT]');
 let code=raw;
 try{const decoded:unknown=JSON.parse(raw);if(decoded&&typeof decoded==='object'&&'code' in decoded&&typeof decoded.code==='string')code=decoded.code;}catch(error:unknown){if(!(error instanceof SyntaxError))throw error;}
 const source=ts.createSourceFile('external-local.js',code,ts.ScriptTarget.ES2020,true,ts.ScriptKind.JS);
 const calls:{method:string;family:string;argumentKinds:string[]}[]=[];
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)){
   if(calls.length>=100)throw new Error('[TERMINAL_EXTERNAL_SHAPE_LIMIT]');
   const name=ts.isPropertyAccessExpression(node.expression)?node.expression.name.text:ts.isIdentifier(node.expression)?node.expression.text:'';
   const base=name.split('__').slice(-1)[0]??'',read=plannerReads.has(base),write=plannerWrites.has(base);
   const benign=['text','image','JSON.stringify','all','allSettled'].includes(name);
   calls.push({method:read||write?base:benign?name:'UNRECOGNIZED',family:read?'PLANNER_READ_SPELLING':write?'PLANNER_MUTATION_SPELLING':benign?'ORCHESTRATION_SPELLING':'UNRECOGNIZED',argumentKinds:node.arguments.map(arg=>ts.SyntaxKind[arg.kind])});
  }
  ts.forEachChild(node,visit);
 }
 visit(source);return calls;
}
