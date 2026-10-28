const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const file=path.resolve(__dirname,'../../src/services/publication_placement_contract.ts');
const exportsObject={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject,require:()=>({default:{}})});
test('LinkedIn feed has portrait editorial geometry without changing manual transport authority',()=>{
 const result=JSON.parse(JSON.stringify(exportsObject.publicationPlacementAssetContract({type:'linkedin',config:{execution_modes:['manual']}},'feed')));
 assert.deepEqual(result.dimensions,{width:1080,height:1350,aspect_ratio:'4:5'});
 assert.deepEqual(result.safe_area,{unit:'px',top:108,right:86,bottom:108,left:86});
 assert.deepEqual(result.accepted_mime_types,['image/png','image/jpeg']);assert.equal(result.transport.connector_authority,'manual_only');
});

test('geometry preserves existing configured authority while explicit manual-only is fenced separately',()=>{assert.equal(exportsObject.publicationPlacementAssetContract({type:'linkedin',config:{execution_modes:['automated','manual']}},'feed').transport.connector_authority,'configured');assert.equal(exportsObject.publicationPlacementAssetContract({type:'linkedin'},'feed').transport.connector_authority,'configured');});
