// A trusted-base record can admit only its exact reviewed context replacement.
const fs=require('node:fs');
const {createReadBudget,fail}=require('./runtime_policy_budget.cjs');
const {artifactPath,parseTransitions}=require('./runtime_policy_transition_schema.cjs');
const {contexts}=require('./runtime_policy_transition_context.cjs');
const {preservationPath,parsePreservations,validatePreservation,completePreservationPack,preservationBijection}=require('./runtime_policy_transition_preservation.cjs');
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
function prepareEntries(entries,{base,budget}){
    if(!entries.length)return [];
    const files=[...new Set(entries.map(entry=>entry.file))];
    const records=budget.git(['ls-tree','-z',base,'--',...files],{maxBytes:files.length*4096}).toString();
    const modes=new Map();
    for(const record of records.split('\0').filter(Boolean)){
        const match=/^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/.exec(record);
        if(!match||!files.includes(match[3])||modes.has(match[3]))fail('TRANSITION_SOURCE_MODE_INVALID');
        modes.set(match[3],match[2]);
    }
    const sources=new Map();let total=0;
    for(const file of files){
        budget.check();
        if(!modes.has(file))fail('TRANSITION_SOURCE_UNAVAILABLE');
        const before=budget.git(['show',`${base}:${file}`],{maxBytes:mib,overflowCode:'TRANSITION_SOURCE_TOO_LARGE'});
        const after=currentSource(file,budget);
        total+=before.length+after.length;if(total>8*mib)fail('TRANSITION_SOURCE_TOO_LARGE');
        sources.set(file,{before,after});
    }
    return entries.map(entry=>{
        const {before,after}=sources.get(entry.file);
        if(digest(before)!==entry.oldSourceSha256||digest(after)!==entry.newSourceSha256)fail('TRANSITION_SOURCE_MISMATCH');
        return {entry,before,after};
    });
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
    const preservedBytes=trustedBlob(base,preservationPath,budget,{artifact:true});
    const entries=bytes?parseTransitions(bytes):[],preservations=preservedBytes?parsePreservations(preservedBytes):[];
    const old=new Map(oldRows.map(row=>[key(row),row])),current=new Map(currentRows.map(row=>[key(row),row]));
    const growth=new Set(currentRows.filter(row=>row.count>(old.get(key(row))?.count||0)).map(key));
    const active=entry=>entry.remaps.some(row=>growth.has(key({file:entry.file,rule:row.rule,identity:row.newIdentity})));
    const selected=entries.filter(active),pack=preservations.some(active)?preservations:[];
    if(pack.length)completePreservationPack(pack,{old,current,budget});
    const prepared=prepareEntries([...selected,...pack],{base,budget}),result=[];
    for(let index=0;index<prepared.length;index++){
        const item=prepared[index];
        result.push(...(index<selected.length?validateEntry(item,{budget,old,current}):validatePreservation(item,{budget,old,current})));
    }
    const used=new Set();
    for(const row of result){
        for(const identity of [row.oldIdentity,row.newIdentity]){
            const identityKey=key({...row,identity});
            if(used.has(identityKey))fail('TRANSITION_CONTEXT_MISMATCH');
            used.add(identityKey);
        }
    }
    if(pack.length)preservationBijection(result,{old,current,budget});
    budget.check();return result;
}
module.exports={reviewedTransitions};
