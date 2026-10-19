// Container-only early iteration helper. Integrated tsc/build remains a separate required gate.
const fs=require('node:fs'),path=require('node:path'),ts=require('/opt/planner/node_modules/typescript');
const source=process.argv[2],output=process.argv[3];
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.ts')){
 const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
 const errors=result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)||[];if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>source,getCanonicalFileName:x=>x,getNewLine:()=> '\n'}));
 const target=path.join(output,path.relative(source,file)).replace(/\.ts$/,'.js');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,result.outputText);
}}}walk(source);
