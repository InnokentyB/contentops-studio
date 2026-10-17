const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {contexts}=require(process.cwd()+'/scripts/runtime_policy_transition_context.cjs');
const {digest}=require(process.cwd()+'/scripts/runtime_policy_scanner.cjs');
const source=process.cwd(),candidate=JSON.parse(fs.readFileSync('docs/evidence/browser-sandbox-transition-candidate-2026-10-17.json'));
const git=(args,cwd=source)=>cp.execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const blob=(ref,file)=>cp.execFileSync('git',['show',ref+':'+file],{cwd:source,maxBuffer:8*1024*1024});
const baseline=JSON.parse(blob('HEAD','docs/code-quality/runtime-policy-baseline.json'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sandbox-stage2-'));
const rows=[];
try{
 for(const entry of candidate.candidateArtifact.entries){
  const before=blob(candidate.sourceComparisonBase,entry.file),after=blob(candidate.sourceCorrectionCommit,entry.file);
  if(digest(before)!==entry.oldSourceSha256||digest(after)!==entry.newSourceSha256)throw Error('SOURCE_HASH');
  const old=contexts(entry.file,before.toString(),{check(){}}),next=contexts(entry.file,after.toString(),{check(){}});
  for(const remap of entry.remaps){
   const prior=baseline.entries.find(r=>r.file===entry.file&&r.rule===remap.rule&&r.identity===remap.oldIdentity);
   const a=old.get(remap.oldIdentity),b=next.get(remap.newIdentity);
   if(!prior||!a||!b||a.signature!==b.signature||a.symbol!==remap.symbol||b.symbol!==remap.symbol||a.count!==remap.count||b.count!==remap.count||prior.count!==remap.count)throw Error('CONTEXT');
   rows.push({file:entry.file,...remap,signature:a.signature,signatureUnchanged:true,owner:prior.owner,reason:prior.reason,remediation:prior.remediation,metadataPreservationRequired:true});
  }
 }
 git(['clone','--quiet','--shared',source,root]);
 const authority='docs/code-quality/runtime-policy-transitions.json',baselinePath='docs/code-quality/runtime-policy-baseline.json';
 fs.writeFileSync(path.join(root,authority),JSON.stringify(candidate.candidateArtifact));
 git(['add',authority],root);git(['-c','user.name=SyntheticFixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--quiet','-m','Synthetic reviewed predecessor only'],root);
 const stage=git(['rev-parse','HEAD'],root),original=structuredClone(baseline);
 for(const e of candidate.candidateArtifact.entries){fs.writeFileSync(path.join(root,e.file),blob(candidate.sourceCorrectionCommit,e.file));for(const m of e.remaps)original.entries.find(r=>r.file===e.file&&r.identity===m.oldIdentity).identity=m.newIdentity;}
 const corrected=()=>{for(const e of candidate.candidateArtifact.entries)fs.writeFileSync(path.join(root,e.file),blob(candidate.sourceCorrectionCommit,e.file));fs.writeFileSync(path.join(root,baselinePath),JSON.stringify(original));};
 const run=args=>{const r=cp.spawnSync(process.execPath,['scripts/check_runtime_policy.cjs',...args],{cwd:root,encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024,env:{...process.env,GITHUB_ACTIONS:'',GITHUB_EVENT_NAME:'',RUNTIME_POLICY_BASE_REF:''}});if(r.error)throw r.error;return {exit:r.status,...JSON.parse(r.stdout)};};
 const brief=r=>({exit:r.exit,verdict:r.verdict,errorCodes:[...new Set(r.errors.map(e=>e.code))],appliedTransitions:r.appliedTransitions?.length||0});
 corrected();const positive=brief(run(['--base-ref',stage]));if(positive.exit!==0||positive.appliedTransitions!==6)throw Error('POSITIVE');
 const negatives=[];
 for(const field of ['taskId','accountId','channelId']){
  corrected();const file=candidate.candidateArtifact.entries[0].file;
  fs.appendFileSync(path.join(root,file),'\nconst syntheticBindingProbe = { '+field+': 987654321 };\n');
  const findings=run(['--inspect']).findings;
  const additions=findings.filter(r=>r.file===file&&!original.entries.some(old=>old.file===r.file&&old.rule===r.rule&&old.identity===r.identity));
  if(!additions.length)throw Error('NEGATIVE_NOT_DETECTED');
  // Simulate rebaselining a new business binding; it must still not be admitted.
  const widened=structuredClone(original);for(const row of additions)widened.entries.push({...row,owner:'Synthetic fixture',reason:'Synthetic attempted rebaseline',remediation:'Must remain rejected'});
  fs.writeFileSync(path.join(root,baselinePath),JSON.stringify(widened));
  const result=brief(run(['--base-ref',stage]));if(result.exit!==1||!result.errorCodes.includes('BASELINE_WIDENED')||!result.errorCodes.includes('TRANSITION_SOURCE_MISMATCH'))throw Error('BINDING_ADMITTED');
  negatives.push({scenario:'added_'+field+'_and_attempted_rebaseline',newFindings:additions.length,...result});
 }
 for(const field of ['taskId','accountId','channelId']){
  corrected();const file='src/services/synthetic_binding_probe.ts';
  fs.writeFileSync(path.join(root,file),'export const syntheticBindingProbe = { '+field+': 987654321 };\n');git(['add',file],root);
  const additions=run(['--inspect']).findings.filter(r=>r.file===file);
  if(!additions.length)throw Error('SEPARATE_BINDING_NOT_DETECTED');
  const widened=structuredClone(original);for(const row of additions)widened.entries.push({...row,owner:'Synthetic fixture',reason:'Synthetic attempted rebaseline',remediation:'Must remain rejected'});
  fs.writeFileSync(path.join(root,baselinePath),JSON.stringify(widened));
  const result=brief(run(['--base-ref',stage]));if(result.exit!==1||!result.errorCodes.includes('BASELINE_WIDENED')||result.appliedTransitions!==6)throw Error('SEPARATE_BINDING_ADMITTED');
  negatives.push({scenario:'separate_file_'+field+'_with_exact_six_remaps',newFindings:additions.length,...result});
  git(['reset','--quiet',stage,'--',file],root);fs.unlinkSync(path.join(root,file));
 }
 for(const field of ['owner','reason','remediation','count']){
  corrected();const changed=structuredClone(original),e=candidate.candidateArtifact.entries[0],r=changed.entries.find(r=>r.file===e.file&&r.identity===e.remaps[0].newIdentity);
  r[field]=field==='count'?r.count+1:'Unreviewed synthetic metadata';fs.writeFileSync(path.join(root,baselinePath),JSON.stringify(changed));
  const result=brief(run(['--base-ref',stage]));if(result.exit!==1||!result.errorCodes.includes('TRANSITION_CONTEXT_MISMATCH'))throw Error('METADATA_ADMITTED');
  negatives.push({scenario:'changed_'+field,...result});
 }
 console.log(JSON.stringify({recordType:'exact_stage2_review_proof',status:'NOT_ADMITTED',sourceHead:git(['rev-parse','HEAD']),sourceCorrectionCommit:candidate.sourceCorrectionCommit,actualProjectArtifactInstalled:false,syntheticPredecessor:stage,rows,positive,negatives,allExpectedOutcomesVerified:true,scope:'Static developer gate only; no provider or application imports, no approval, merge, deploy or publication'},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
