import ts from 'typescript';
import {z} from 'zod';
import {terminalDocumentScope} from './browser_terminal_source_document';
/** Deliberately small read-only subset for original profile inspection. Never executes source. */
export function createTerminalReadVerifier(browserId:string,profileUrl:string){
 let savedAliases=new Map<string,'browser'|'tab'>();
 return (argumentsJson:string):void=>{
 const args=z.object({code:z.string().min(1).max(262144),title:z.string().max(1000).optional(),timeout_ms:z.number().positive().optional()}).strict().parse(JSON.parse(argumentsJson));
 const parsed=ts.transpileModule(args.code,{fileName:'native-receipt.js',reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,allowJs:true}});
 if(parsed.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw new Error('[TERMINAL_SOURCE_SYNTAX_INVALID]');
 const source=ts.createSourceFile('native-receipt.js',args.code,ts.ScriptTarget.ES2020,true,ts.ScriptKind.JS);
 const aliases=new Map(savedAliases);
 const deny=():never=>{throw new Error('[TERMINAL_SOURCE_EFFECT_UNSUPPORTED] Original operations include an effect that this verifier cannot prove read-only. Preserve the attempt and review the original source.');};
 const literal=(node:ts.Expression|undefined)=>node&&ts.isStringLiteral(node)?node.text:undefined;
 function call(node:ts.Expression):'browser'|'tab'|'read'{
  if(!ts.isAwaitExpression(node)||!ts.isCallExpression(node.expression))return deny();
  const c=node.expression;
  if(ts.isPropertyAccessExpression(c.expression)&&ts.isPropertyAccessExpression(c.expression.expression)&&ts.isIdentifier(c.expression.expression.expression)){
   const receiver=c.expression.expression.expression.text;
   if(aliases.get(receiver)==='tab'&&c.expression.expression.name.text==='playwright'&&c.expression.name.text==='domSnapshot'&&c.arguments.length===0)return 'read';
  }
  if(ts.isPropertyAccessExpression(c.expression)&&c.expression.name.text==='click'&&c.arguments.length===0&&safeReadNavigation(c.expression.expression,aliases))return 'read';
  if(!ts.isPropertyAccessExpression(c.expression)||!ts.isIdentifier(c.expression.expression))return deny();
  const receiver=c.expression.expression.text,method=c.expression.name.text;
  const document=literal(c.arguments[1]);
  if(receiver==='cua'&&method==='createBrowserTab'&&c.arguments.length===3&&literal(c.arguments[0])===browserId&&document&&terminalDocumentScope(document,profileUrl)){
   const options=c.arguments[2];
   if(!options||!ts.isObjectLiteralExpression(options)||options.properties.length!==1)return deny();
   const property=options.properties[0];
   if(!property||!ts.isPropertyAssignment(property)||!ts.isIdentifier(property.name)||property.name.text!=='sessionName'||literal(property.initializer)===undefined)return deny();
   return 'tab';
  }
  if(receiver==='cua'&&method==='getBrowser'&&c.arguments.length===1&&literal(c.arguments[0])===browserId)return 'browser';
  if(aliases.get(receiver)==='browser'&&method==='createBrowserTab'&&c.arguments.length===1&&literal(c.arguments[0])===profileUrl)return 'tab';
  if(aliases.get(receiver)==='tab'&&['getAXState','getScreenshot'].includes(method)&&c.arguments.length===0)return 'read';
  return deny();
 }
 for(const statement of source.statements){
  if(ts.isVariableStatement(statement)){
   for(const declaration of statement.declarationList.declarations){
    if(!ts.isIdentifier(declaration.name)||aliases.has(declaration.name.text)||!declaration.initializer)return deny();
    const kind=call(declaration.initializer);if(kind==='read')return deny();aliases.set(declaration.name.text,kind);
   }
  }else if(ts.isExpressionStatement(statement)){if(call(statement.expression)!=='read')return deny();}
  else return deny();
 }
 if(!aliases.size)return deny();savedAliases=aliases;
 };
}
function safeReadNavigation(expression:ts.Expression,aliases:Map<string,'browser'|'tab'>):boolean{
 if(!ts.isCallExpression(expression)||!ts.isPropertyAccessExpression(expression.expression)||expression.expression.name.text!=='getByRole')return false;
 const receiver=expression.expression.expression;
 if(!ts.isPropertyAccessExpression(receiver)||receiver.name.text!=='playwright'||!ts.isIdentifier(receiver.expression)||aliases.get(receiver.expression.text)!=='tab')return false;
 const [role,options]=expression.arguments;
 if(expression.arguments.length!==2||!role||!ts.isStringLiteral(role)||!['tab','link'].includes(role.text)||!options||!ts.isObjectLiteralExpression(options)||options.properties.length!==2)return false;
 const fields=new Map<string,ts.Expression>();
 for(const field of options.properties){if(!ts.isPropertyAssignment(field)||!ts.isIdentifier(field.name)||fields.has(field.name.text))return false;fields.set(field.name.text,field.initializer);}
 const name=fields.get('name'),exact=fields.get('exact');
 return !!name&&ts.isStringLiteral(name)&&['Posts','Published','Content'].includes(name.text)&&exact?.kind===ts.SyntaxKind.TrueKeyword;
}
/** Stateless compatibility entry point. Multi-call original turns use one verifier instance. */
export function verifyTerminalReadSource(argumentsJson:string,browserId:string,profileUrl:string):void{createTerminalReadVerifier(browserId,profileUrl)(argumentsJson);}
