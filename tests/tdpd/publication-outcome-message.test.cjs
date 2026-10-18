const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../frontend/src/utils/publicationOutcomeMessage.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}});
const exportsObject={};
vm.runInNewContext(compiled.outputText,{exports:exportsObject});
const {publicationOutcomeMessage}=exportsObject;
const en=(_ru,text)=>text;
test('operator sees blocker code and corrective step rather than publication started',()=>{
 const message=publicationOutcomeMessage({success:false,code:'OWNER_RELEASE_REQUIRED',message:'Owner release is missing.',
  reasons:[{action:'Ask the project owner to review the accepted package.'}],retry_allowed:false},en);
 assert.match(message,/OWNER_RELEASE_REQUIRED/);assert.match(message,/Ask the project owner/);
 assert.doesNotMatch(message,/Publication started/);
});
test('browser handoff and unknown results never claim a completed or started publication',()=>{
 for(const outcome of [{success:true,browserRequired:true},{success:false,blocked:true},null]){
  const message=publicationOutcomeMessage(outcome,en);assert.doesNotMatch(message,/Publication started/);
  assert.match(message,/inspect|review|confirmed|workflow/i);
 }
});
test('unknown raw reason is not presented and publication receipt is not independent success proof',()=>{
 const message=publicationOutcomeMessage({success:true,status:'published',reason:'private-provider-token'},en);
 assert.doesNotMatch(message,/private-provider-token/);assert.match(message,/publication fact/i);
});
