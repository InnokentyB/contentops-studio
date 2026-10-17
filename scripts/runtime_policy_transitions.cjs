// A trusted-base record can admit only its exact reviewed context replacement.
const fs=require('node:fs');
const {createReadBudget,fail}=require('./runtime_policy_budget.cjs');
const {artifactPath,parseTransitions}=require('./runtime_policy_transition_schema.cjs');
const {contexts}=require('./runtime_policy_transition_context.cjs');
const {readSource}=require('./runtime_policy_source.cjs');
const {digest}=require('./runtime_policy_scanner.cjs');
const key=row=>[row.file,row.rule,row.identity].join('\0');
const mib=1024*1024;

function requireTransitionBase(base,cli,environment=process.env){
    const eventBase=environment.RUNTIME_POLICY_BASE_REF;
    if(!/^(?!0{40}$)[a-f0-9]{40}$/.test(base||''))fail('TRANSITION_BASE_REQUIRED');
    if(cli&&eventBase&&cli!==eventBase)fail('TRANSITION_BASE_CONFLICT');
    if(environment.GITHUB_ACTIONS==='true'&&(!eventBase||base!==eventBase
        ||!['pull_request','push'].includes(environment.GITHUB_EVENT_NAME)))fail('TRANSITION_BASE_REQUIRED');
}
function trustedBlob(base,file,budget,{artifact=false}={}){
    const cap=artifact?65536:mib;
    const modeCode=artifact?'TRANSITION_ARTIFACT_MODE_INVALID':'TRANSITION_SOURCE_MODE_INVALID';
    const overflowCode=artifact?'TRANSITION_ARTIFACT_TOO_LARGE':'TRANSITION_SOURCE_TOO_LARGE';
    const record=budget.git(['ls-tree','-z',base,'--',file],{maxBytes:4096}).toString();
    if(!record)return null;
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(record);
    if(!match||match[3]!==file)fail(modeCode);
    return budget.git(['show',`${base}:${file}`],{maxBytes:cap,overflowCode});
}
function currentSource(file,budget){
    budget.check();
    if(fs.lstatSync(file).size>mib)fail('TRANSITION_SOURCE_TOO_LARGE');
    const value=Buffer.from(readSource(file));
    if(value.length>mib)fail('TRANSITION_SOURCE_TOO_LARGE');
    budget.check();return value;
}
function prepareEntry(entry,{base,budget}){
    const before=trustedBlob(base,entry.file,budget);
    if(!before)fail('TRANSITION_SOURCE_UNAVAILABLE');
    const after=currentSource(entry.file,budget);
    if(digest(before)!==entry.oldSourceSha256||digest(after)!==entry.newSourceSha256)fail('TRANSITION_SOURCE_MISMATCH');
    return {entry,before,after};
}
function validateEntry({entry,before,after},{budget,old,current}){
    const oldContexts=contexts(entry.file,before.toString(),budget),newContexts=contexts(entry.file,after.toString(),budget);
    const accepted=[];
    for(const remap of entry.remaps){
        budget.check();
        const priorKey=key({file:entry.file,rule:remap.rule,identity:remap.oldIdentity});
        const nextKey=key({file:entry.file,rule:remap.rule,identity:remap.newIdentity});
        const prior=old.get(priorKey),next=current.get(nextKey);
        const oldContext=oldContexts.get(remap.oldIdentity),newContext=newContexts.get(remap.newIdentity);
        if(!prior||!next||current.has(priorKey)||old.has(nextKey)||prior.count!==remap.count||next.count!==remap.count
            ||['reason','owner','remediation'].some(field=>prior[field]!==next[field])
            ||!oldContext||!newContext||oldContext.symbol!==remap.symbol||newContext.symbol!==remap.symbol
            ||oldContext.signature!==newContext.signature||oldContext.count!==remap.count||newContext.count!==remap.count)
            fail('TRANSITION_CONTEXT_MISMATCH');
        accepted.push({file:entry.file,rule:remap.rule,oldIdentity:remap.oldIdentity,newIdentity:remap.newIdentity,count:remap.count});
    }
    return accepted;
}
function reviewedTransitions({base,cli,oldRows,currentRows}){
    requireTransitionBase(base,cli);
    const budget=createReadBudget();
    const bytes=trustedBlob(base,artifactPath,budget,{artifact:true});
    if(!bytes)return [];
    const entries=parseTransitions(bytes),old=new Map(oldRows.map(row=>[key(row),row])),current=new Map(currentRows.map(row=>[key(row),row]));
    const growth=new Set(currentRows.filter(row=>row.count>(old.get(key(row))?.count||0)).map(key));
    const result=[],prepared=[];let total=0;
    for(const entry of entries){
        budget.check();
        if(!entry.remaps.some(row=>growth.has(key({file:entry.file,rule:row.rule,identity:row.newIdentity}))))continue;
        const item=prepareEntry(entry,{base,budget});
        total+=item.before.length+item.after.length;if(total>8*mib)fail('TRANSITION_SOURCE_TOO_LARGE');
        prepared.push(item);
    }
    for(const item of prepared)result.push(...validateEntry(item,{budget,old,current}));
    budget.check();return result;
}
module.exports={reviewedTransitions};
