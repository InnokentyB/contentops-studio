const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),feature=process.env.PRESERVATION_FEATURE_ROOT;
const artifact='docs/code-quality/runtime-policy-preservations.json',baseline='docs/code-quality/runtime-policy-baseline.json',gate=path.join(root,'scripts/check_runtime_policy.cjs');
const proof=JSON.parse(fs.readFileSync(path.join(root,'docs/tdpd/026-owner-manual-publication-confirmation/runtime-policy-transition-pairs.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,artifact),'utf8'));
const digest=text=>createHash('sha256').update(text).digest('hex');
const ts=require('typescript'),printer=ts.createPrinter({removeComments:true});
function leafMap(file,text,findings){
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),wanted=new Map(findings.map(row=>[row.identity,row])),rows=new Map();
 const print=node=>printer.printNode(ts.EmitHint.Unspecified,node,source);
 function walk(node){let anchor=node;while(anchor.parent&&!ts.isStatement(anchor)&&!ts.isSourceFile(anchor.parent))anchor=anchor.parent;
  for(const rule of ['task_identifier','business_binding','business_record_lookup','business_comparison']){const identity=digest(rule+'\0'+print(anchor)+'\0'+print(node));if(wanted.has(identity))rows.set(identity,{leafSha256:digest(print(node)),leaf:print(node)});}
  ts.forEachChild(node,walk);
 }walk(source);return rows;
}
let synthetic,propertySynthetic;
function syntheticData(propertyScope=false){
 if(propertyScope?propertySynthetic:synthetic)return propertyScope?propertySynthetic:synthetic;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'planner-preservation-data-'));test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const files=Array.from({length:16},(_,i)=>({file:`src/synthetic_${i}.ts`,before:'',after:''}));let cursor=0;
 const add=(name,expression)=>{const file=files[cursor++%16];file.before+=`export function ${name}(){return ${expression};}\n`;file.after+=`export function ${name}(){return guarded(()=>(${expression}));}\n`;};
 for(let i=0;i<73;i++)add(`identifierCase${i}`,i<8?`[task${2048+i},task${2048+i}]`:`task${2048+i}`);
 for(let i=0;i<20;i++)add(`bindingCase${i}`,`({taskId:${3000+i}})`);
 for(let i=0;i<8;i++)add(`lookupCase${i}`,`db.contentItem.findFirst({where:{id:${4000+i}}})`);
 add('comparisonCase','task.id===5000');
 if(propertyScope){files[0].before=files[0].before.replace('export function identifierCase0(){return [task2048,task2048];}','export const namedObject={handler:()=>[task2048,task2048]};');files[0].after=files[0].after.replace('export function identifierCase0(){return guarded(()=>([task2048,task2048]));}','export const namedObject={handler:()=>guarded(()=>([task2048,task2048]))};');}
 for(const row of files){fs.mkdirSync(path.dirname(path.join(directory,row.file)),{recursive:true});fs.writeFileSync(path.join(directory,row.file),row.before);}
 execFileSync('git',['init','--quiet'],{cwd:directory});execFileSync('git',['add','.'],{cwd:directory});
 const inspect=()=>{const result=spawnSync(process.execPath,[gate,'--inspect'],{cwd:directory,encoding:'utf8',timeout:15000,env:{...process.env,RUNTIME_POLICY_BASE_REF:'',GITHUB_ACTIONS:''}});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout);return JSON.parse(result.stdout).findings;};
 const previous=inspect();for(const row of files)fs.writeFileSync(path.join(directory,row.file),row.after);const current=inspect();
 assert.equal(previous.length,102);assert.equal(current.length,102);assert.equal(previous.reduce((sum,row)=>sum+row.count,0),110);
 const metadata={reason:'Existing isolated synthetic authority; exact preservation test',owner:'Synthetic policy reviewer',remediation:'Retire the isolated fixture after verification'};
 const pack={schemaVersion:1,review:structuredClone(manifest.review),entries:[]};
 for(const row of files){const old=previous.filter(f=>f.file===row.file),next=current.filter(f=>f.file===row.file),oldLeaves=leafMap(row.file,row.before,old),newLeaves=leafMap(row.file,row.after,next);
  pack.entries.push({file:row.file,oldSourceSha256:digest(row.before),newSourceSha256:digest(row.after),remaps:old.map(finding=>{const leaf=oldLeaves.get(finding.identity);assert.ok(leaf);const candidate=next.find(item=>item.rule===finding.rule&&newLeaves.get(item.identity)?.leafSha256===leaf.leafSha256);assert.ok(candidate);return{rule:finding.rule,oldIdentity:finding.identity,newIdentity:candidate.identity,count:finding.count,leafSha256:leaf.leafSha256};})});
 }
 const result={files,old:previous.map(row=>({...row,...metadata})),next:current.map(row=>({...row,...metadata})),pack};if(propertyScope)propertySynthetic=result;else synthetic=result;return result;
}
function actualData(){
 assert.ok(feature,'Actual frozen-source mode requires explicit PRESERVATION_FEATURE_ROOT');const files=proof.files.map(row=>{const before=fs.readFileSync(path.join(root,row.file),'utf8'),after=fs.readFileSync(path.join(feature,row.file),'utf8');assert.equal(digest(before),row.oldSourceSha256);assert.equal(digest(after),row.newSourceSha256);return{file:row.file,before,after};});
 const selected=new Set(files.map(row=>row.file)),old=JSON.parse(fs.readFileSync(path.join(root,baseline),'utf8')).entries.filter(row=>selected.has(row.file)),remaps=new Map(proof.pairs.map(row=>[[row.file,row.rule,row.oldIdentity].join('\0'),row]));
 return{files,old,next:old.map(row=>{const pair=remaps.get([row.file,row.rule,row.identity].join('\0'));return pair?{...row,identity:pair.newIdentity}:structuredClone(row);}),pack:manifest};
}
function fixture(t,{trusted=true,editManifest,actual=false,propertyScope=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'planner-preservation-transition-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const write=(file,value)=>{const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:directory,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']}).trim();
 const commit=()=>{git('add','.');git('-c','user.name=Synthetic policy reviewer','-c','user.email=policy@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Synthetic trusted-base fixture');return git('rev-parse','HEAD');};
 const data=actual?actualData():syntheticData(propertyScope),pack=structuredClone(data.pack);if(editManifest)editManifest(pack);const old=structuredClone(data.old),next=structuredClone(data.next);
 for(const row of data.files)write(row.file,row.before);
 const setBaseline=rows=>write(baseline,JSON.stringify({schemaVersion:1,entries:rows}));setBaseline(old);
 if(trusted)write(artifact,JSON.stringify(pack));git('init','--quiet');let base=commit();
 const apply=()=>{for(const row of data.files)write(row.file,row.after);setBaseline(next);};
 const reset=()=>{for(const row of data.files)write(row.file,row.before);setBaseline(old);};
 const run=(options={})=>{const result=spawnSync(process.execPath,[gate,...(options.inspect?['--inspect']:[]),...(options.noBase?[]:['--base-ref',options.base||base])],{cwd:directory,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,
  env:{...process.env,RUNTIME_POLICY_BASE_REF:'',GITHUB_ACTIONS:'',GITHUB_EVENT_NAME:'',...options.env}});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);return{status:result.status,report:JSON.parse(result.stdout)};};
 return{directory,write,git,commit,pack,old,next,data,apply,reset,run,setBaseline,get base(){return base;},trust(){write(artifact,JSON.stringify(pack));base=commit();}};
}
test('P01 synthetic102 pairs across16 files are admitted only from synthetic trusted Git base',t=>{
 const f=fixture(t);f.apply();const result=f.run();assert.equal(result.status,0,JSON.stringify(result.report));assert.equal(result.report.verdict,'PASS');assert.equal(result.report.appliedTransitions.length,102);
 assert.equal(new Set(result.report.appliedTransitions.map(row=>row.file)).size,16);assert.equal(result.report.appliedTransitions.reduce((n,row)=>n+row.count,0),110);
 assert.equal(result.report.findingsCount,result.report.baselineCount);
});
test('P02 StageA inert trusted manifest does not change old source or baseline',t=>{const f=fixture(t),r=f.run();assert.equal(r.status,0,JSON.stringify(r.report));assert.deepEqual(r.report.appliedTransitions,[]);});
test('P03 current-branch manifest cannot authorize its own baseline replacement',t=>{const f=fixture(t,{trusted:false});f.apply();f.write(artifact,JSON.stringify(f.pack));const r=f.run();assert.equal(r.status,1);assert.ok(r.report.errors.some(row=>row.code==='BASELINE_WIDENED'));});
if(feature)test('P04 explicitly requested actual frozen feature102/16 passes CLI in a synthetic trusted Git repository',t=>{const f=fixture(t,{actual:true});f.apply();const r=f.run();assert.equal(r.status,0,JSON.stringify(r.report));assert.equal(r.report.appliedTransitions.length,102);});
function refused(result){assert.equal(result.status,1,JSON.stringify(result.report));assert.equal(result.report.verdict,'FAIL');assert.deepEqual(result.report.appliedTransitions||[],[],'invalid preservation pack must not partially apply');}
function rebound(f,text){
 const source=f.data.files[0];f.apply();f.write(source.file,text);const findings=f.run({inspect:true}).report.findings,leaves=leafMap(source.file,text,findings.filter(row=>row.file===source.file));
 const next=structuredClone(f.next),entry=f.pack.entries.find(row=>row.file===source.file);
 for(const row of entry.remaps){const old=next.find(item=>item.file===source.file&&item.identity===row.newIdentity),current=findings.find(item=>item.file===source.file&&item.rule===row.rule&&item.line===old.line);assert.ok(current,'same scope test location must remain scanned');row.newIdentity=current.identity;row.count=current.count;row.leafSha256=leaves.get(current.identity).leafSha256;Object.assign(old,current);}
 entry.newSourceSha256=digest(text);f.reset();f.trust();f.apply();f.write(source.file,text);f.setBaseline(next);
}
test('P05 additional unreviewed literal cannot consume the exact pack',t=>{const f=fixture(t);f.apply();f.write(f.data.files[0].file,f.data.files[0].after+'\nexport const taskId=999999;');refused(f.run());});
test('P06 changed leaf fails even when evil trusted manifest and baseline match its new source hash',t=>{const f=fixture(t);rebound(f,f.data.files[0].after.replaceAll('task2048','task999999'));refused(f.run());});
test('P07 renamed named scope fails with exact trusted source hashes and unchanged leaf syntax',t=>{const f=fixture(t);const source=f.data.files[0],text=source.after.replace('identifierCase0','differentNamedScope');f.pack.entries[0].newSourceSha256=digest(text);f.trust();f.apply();f.write(source.file,text);refused(f.run());});
test('P08 count growth fails despite trusted matching new source and scanner baseline',t=>{const f=fixture(t);rebound(f,f.data.files[0].after.replace('[task2048,task2048]','[task2048,task2048,task2048]'));refused(f.run());});
for(const field of ['owner','reason','remediation'])test(`P09 changed baseline ${field} cannot inherit old authority`,t=>{const f=fixture(t);f.apply();const next=structuredClone(f.next);next[0][field]='Unreviewed replacement metadata';f.setBaseline(next);refused(f.run());});
test('P10 changed rule in trusted manifest is refused',t=>{const f=fixture(t,{editManifest:pack=>{pack.entries[0].remaps[0].rule='fixed_actor';}});f.apply();refused(f.run());});
test('P11 changed file binding in trusted manifest is refused',t=>{const f=fixture(t,{editManifest:pack=>{pack.entries[0].file='src/unreviewed.ts';}});f.apply();refused(f.run());});
for(const field of ['oldSourceSha256','newSourceSha256'])test(`P12 trusted ${field} drift is refused`,t=>{const f=fixture(t,{editManifest:pack=>{pack.entries[0][field]='0'.repeat(64);}});f.apply();refused(f.run());});
test('P13 old identity collision is refused without cardinality growth',t=>{const f=fixture(t,{editManifest:pack=>{pack.entries[0].remaps[1].oldIdentity=pack.entries[0].remaps[0].oldIdentity;}});f.apply();refused(f.run());});
test('P14 new identity collision is refused without cardinality growth',t=>{const f=fixture(t,{editManifest:pack=>{pack.entries[0].remaps[1].newIdentity=pack.entries[0].remaps[0].newIdentity;}});f.apply();refused(f.run());});
test('P15 missing reviewed pair cannot widen the baseline',t=>{const f=fixture(t,{editManifest:pack=>{pack.entries[0].remaps.pop();}});f.apply();refused(f.run());});
test('P16 one matching growth validates the entire pack rather than an active subset',t=>{const f=fixture(t);const source=f.data.files[0];f.write(source.file,source.after);f.setBaseline(f.old.map(row=>row.file===source.file?f.next.find(next=>next.file===row.file&&next.line===row.line&&next.rule===row.rule):row));refused(f.run());});
test('P17 production artifact byte limit remains65536',t=>{const f=fixture(t,{editManifest:pack=>{pack.review.reason='x'.repeat(65537);}});f.apply();refused(f.run());});
test('P18 malformed trusted artifact is refused safely',t=>{const f=fixture(t);f.write(artifact,'{"schemaVersion":1,"private":"synthetic-secret"');const base=f.commit();f.apply();const r=f.run({base});refused(r);assert.ok(!JSON.stringify(r.report).includes('synthetic-secret'));});
test('P19 unknown trusted base cannot supply authority',t=>{const f=fixture(t);f.apply();refused(f.run({base:'f'.repeat(40)}));});
test('P20 missing explicit trusted base cannot authorize baseline growth',t=>{const f=fixture(t);f.apply();refused(f.run({noBase:true}));});
test('P21 symlinked current source is rejected',t=>{const f=fixture(t);f.apply();const source=f.data.files[0];f.write('outside.ts',source.after);fs.unlinkSync(path.join(f.directory,source.file));fs.symlinkSync(path.join(f.directory,'outside.ts'),path.join(f.directory,source.file));refused(f.run());});
test('P22 symlinked artifact cannot be a trusted Git authority',t=>{const f=fixture(t,{trusted:false});f.write('linked-policy.json',JSON.stringify(f.pack));fs.symlinkSync('../../linked-policy.json',path.join(f.directory,artifact));const base=f.commit();f.apply();refused(f.run({base}));});
test('P23 proxy indirection cannot launder an old business leaf',t=>{const f=fixture(t);const source=f.data.files[0],text=source.after.replace('[task2048,task2048]','[proxy(task2048),proxy(task2048)]');f.pack.entries[0].newSourceSha256=digest(text);f.trust();f.apply();f.write(source.file,text);refused(f.run());});
test('P24 renamed object-property callable scope fails despite fully rebound trusted hashes and identities',t=>{const f=fixture(t,{propertyScope:true});const text=f.data.files[0].after.replace('handler:','erase:');assert.notEqual(text,f.data.files[0].after);rebound(f,text);const r=f.run();refused(r);assert.ok(r.report.errors.some(row=>row.code==='TRANSITION_CONTEXT_MISMATCH'),JSON.stringify(r.report));});
function ioProbe(f,{delay=0}={}){
 const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),trace=path.join(f.directory,'read-trace.txt'),wrapper=path.join(f.directory,'slow-git.cjs'),preload=path.join(f.directory,'io-probe.cjs');
 const targets=[artifact,...f.data.files.map(row=>row.file)];
 f.write('slow-git.cjs',`const fs=require('node:fs'),cp=require('node:child_process');fs.appendFileSync(${JSON.stringify(trace)},'read\\n');if(${delay}){process.stderr.write('SYNTHETIC_PRIVATE_GIT_STDERR');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${delay});}const r=cp.spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status===null?1:r.status);`);
 f.write('io-probe.cjs',`const cp=require('node:child_process'),original=cp.execFileSync;cp.execFileSync=function(file,args,options){if(file==='git'&&['show','ls-tree'].includes(args[0])&&args.some(arg=>${JSON.stringify(targets)}.some(p=>arg===p||arg.endsWith(':'+p))))return original(process.execPath,[${JSON.stringify(wrapper)},...args],options);return original(file,args,options);};`);
 return{trace,env:{NODE_OPTIONS:`--require=${preload}`}};
}
test('P25 actual active preservation pack stays within32 Git reads and shared2second budget',t=>{const f=fixture(t);f.apply();const probe=ioProbe(f),r=f.run({env:probe.env});assert.equal(r.status,0,JSON.stringify(r.report));const reads=(fs.readFileSync(probe.trace,'utf8').match(/read/g)||[]).length;assert.ok(reads>=18&&reads<=32,`actual bounded Git reads: ${reads}`);});
test('P26 one hung preservation Git read is bounded and sanitized',t=>{const f=fixture(t);f.apply();const probe=ioProbe(f,{delay:10000}),started=Date.now(),r=f.run({env:probe.env});refused(r);assert.ok(r.report.errors.some(row=>/^TRANSITION_(READ_TIMEOUT|DEADLINE_EXCEEDED)$/.test(row.code)),JSON.stringify(r.report));assert.ok(fs.existsSync(probe.trace));assert.ok(!JSON.stringify(r.report).includes('SYNTHETIC_PRIVATE_GIT_STDERR'));assert.ok(Date.now()-started<4000);});
test('P27 repeated subsecond Git reads cannot restart the shared2second deadline',t=>{const f=fixture(t);f.apply();const probe=ioProbe(f,{delay:650}),started=Date.now(),r=f.run({env:probe.env});refused(r);assert.ok(r.report.errors.some(row=>/^TRANSITION_(READ_TIMEOUT|DEADLINE_EXCEEDED)$/.test(row.code)),JSON.stringify(r.report));assert.ok(Date.now()-started<4500);});
test('P28 individual source larger than1MiB cannot be admitted with a matching reviewed hash',t=>{const f=fixture(t),source=f.data.files[0],text=source.after+'\n//'+'p'.repeat(1024*1024);f.pack.entries[0].newSourceSha256=digest(text);f.trust();f.apply();f.write(source.file,text);const r=f.run();refused(r);assert.ok(r.report.errors.some(row=>row.code==='TRANSITION_SOURCE_TOO_LARGE'),JSON.stringify(r.report));});
test('P29 aggregate old/new sources larger than8MiB remain bounded below individual limits',t=>{const f=fixture(t),padded=new Map();for(const source of f.data.files){const pad=text=>text+'\n//'+'p'.repeat(300*1024-Buffer.byteLength(text)-3),before=pad(source.before),after=pad(source.after),entry=f.pack.entries.find(row=>row.file===source.file);entry.oldSourceSha256=digest(before);entry.newSourceSha256=digest(after);f.write(source.file,before);padded.set(source.file,after);}f.trust();f.apply();for(const [file,text]of padded)f.write(file,text);const r=f.run();refused(r);assert.ok(r.report.errors.some(row=>row.code==='TRANSITION_SOURCE_TOO_LARGE'),JSON.stringify(r.report));});
test('P30 trusted source mode must be regular even when blob bytes and hashes match',t=>{const f=fixture(t),source=f.data.files[0],blob=execFileSync('git',['hash-object','-w','--stdin'],{cwd:f.directory,input:source.before,encoding:'utf8'}).trim();f.git('update-index','--cacheinfo','120000',blob,source.file);f.git('-c','user.name=Synthetic','-c','user.email=policy@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Synthetic invalid trusted mode');const base=f.git('rev-parse','HEAD');f.apply();const r=f.run({base});refused(r);assert.ok(r.report.errors.some(row=>row.code==='TRANSITION_SOURCE_MODE_INVALID'),JSON.stringify(r.report));});
function outside(f){const file='src/unchanged.ts';f.write(file,'export const taskId=8888;');f.git('add',file);const rows=f.run({inspect:true}).report.findings.filter(row=>row.file===file).map(row=>({...row,reason:'Existing unrelated unchanged debt',owner:'Original unrelated owner',remediation:'Original unrelated removal plan'}));assert.equal(rows.length,1);f.setBaseline([...f.old,...rows]);f.trust();f.apply();f.setBaseline([...f.next,...rows]);return rows;}
for(const field of ['owner','reason','remediation'])test(`P31 unchanged finding outside the reviewed pack cannot change ${field}`,t=>{const f=fixture(t),rows=outside(f);f.setBaseline([...f.next,...rows.map(row=>({...row,[field]:'Unreviewed unrelated metadata change'}))]);refused(f.run());});
test('P32 dropping an unchanged outside finding cannot partially apply an otherwise valid pack',t=>{const f=fixture(t);outside(f);f.setBaseline(f.next);refused(f.run());});
