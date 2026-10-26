import ts from 'typescript';
import {z} from 'zod';
import {terminalDocumentScope} from './browser_terminal_source_document';
const knownMethods=new Set(['createBrowserTab','getBrowser','getTab','listBrowsers','listTabs','getAXState','getScreenshot','getState','rewriteDocumentation','nameSession','get','write','emitImage','click','paste','pressKey','evaluate','domSnapshot','getByRole','count','setFiles','waitForEvent','downloadMedia','markHandoff','close']);
/** Diagnostic structure only. Never emits raw code, literals, identifier names or arbitrary object keys. */
export function terminalSourceShape(argumentsJson:string,targetProfile?:string){
 const input=z.object({code:z.string().max(262144)}).passthrough().parse(JSON.parse(argumentsJson));
 const source=ts.createSourceFile('local-source.js',input.code,ts.ScriptTarget.ES2020,true,ts.ScriptKind.JS);
 const shapes:{method:string;receiver:string;documentScope?:string;arguments:{kind:string;keys?:string[]}[]}[]=[];
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)){
   if(shapes.length>=100)throw new Error('[TERMINAL_SHAPE_LIMIT]');
   const property=ts.isPropertyAccessExpression(node.expression)?node.expression:null;
   const method=property&&knownMethods.has(property.name.text)?property.name.text:'UNRECOGNIZED';
   const receiver=property&&ts.isIdentifier(property.expression)&&['cua','nodeRepl'].includes(property.expression.text)?property.expression.text:'LOCAL_OR_DYNAMIC';
   const url=node.arguments[1],documentScope=method==='createBrowserTab'&&receiver==='cua'&&targetProfile&&url&&ts.isStringLiteral(url)?terminalDocumentScope(url.text,targetProfile)??'UNRECOGNIZED':undefined;
   shapes.push({method,receiver,...(documentScope?{documentScope}:{}),arguments:node.arguments.map(arg=>({kind:ts.SyntaxKind[arg.kind],...(ts.isObjectLiteralExpression(arg)?{keys:arg.properties.map(p=>ts.isPropertyAssignment(p)&&ts.isIdentifier(p.name)&&p.name.text==='sessionName'?'sessionName':'UNRECOGNIZED')}:{} )}))});
  }
  ts.forEachChild(node,visit);
 }
 visit(source);return shapes;
}
