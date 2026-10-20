// Exact reviewed leaf preservation only; no scanner or baseline authority is defined here.
const ts=require('typescript');
const {digest}=require('./runtime_policy_scanner.cjs');
const {fail}=require('./runtime_policy_budget.cjs');
const {relative}=require('./runtime_policy_transition_schema.cjs');
const preservationPath='docs/code-quality/runtime-policy-preservations.json';
const rules=new Set(['task_identifier','business_binding','business_record_lookup','business_comparison']);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const key=(file,rule,identity)=>[file,rule,identity].join('\0');
const printer=ts.createPrinter({removeComments:true});
function exact(value,keys){
    if(!value||typeof value!=='object'||Array.isArray(value)
        ||Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))fail('TRANSITION_INVALID_ARTIFACT');
}
function parsePreservations(bytes){
    if(Buffer.byteLength(bytes)>65536)fail('TRANSITION_ARTIFACT_TOO_LARGE');
    let data;try{data=JSON.parse(bytes.toString());}catch{fail('TRANSITION_INVALID_ARTIFACT');}
    exact(data,['schemaVersion','review','entries']);
    if(data.schemaVersion!==1||!Array.isArray(data.entries)||data.entries.length>16)fail('TRANSITION_INVALID_ARTIFACT');
    exact(data.review,['reference','owner','reason','removalPlan']);
    if(Object.values(data.review).some(value=>typeof value!=='string'||value.trim().length<4||value.length>2000))fail('TRANSITION_INVALID_ARTIFACT');
    const files=new Set(),identities=new Set();let total=0;
    for(const entry of data.entries){
        exact(entry,['file','oldSourceSha256','newSourceSha256','remaps']);
        if(!relative(entry.file)||!/\.[cm]?[jt]sx?$/.test(entry.file)||/(?:^|\/)\.env(?:\.|$)/.test(entry.file)
            ||files.has(entry.file)||!hex(entry.oldSourceSha256)||!hex(entry.newSourceSha256)
            ||entry.oldSourceSha256===entry.newSourceSha256||!Array.isArray(entry.remaps)||!entry.remaps.length||entry.remaps.length>64)fail('TRANSITION_INVALID_ARTIFACT');
        files.add(entry.file);total+=entry.remaps.length;
        if(total>102)fail('TRANSITION_INVALID_ARTIFACT');
        for(const row of entry.remaps){
            exact(row,['rule','oldIdentity','newIdentity','count','leafSha256']);
            const old=key(entry.file,row.rule,row.oldIdentity),next=key(entry.file,row.rule,row.newIdentity);
            if(!rules.has(row.rule)||!hex(row.oldIdentity)||!hex(row.newIdentity)||!hex(row.leafSha256)
                ||row.oldIdentity===row.newIdentity||!Number.isSafeInteger(row.count)||row.count<1
                ||identities.has(old)||identities.has(next))fail('TRANSITION_INVALID_ARTIFACT');
            identities.add(old);identities.add(next);
        }
    }
    return data.entries;
}
function completePreservationPack(entries,{old,current,budget}){
    const files=new Set(entries.map(entry=>entry.file)),prior=new Set(),next=new Set();
    for(const entry of entries)for(const row of entry.remaps){
        prior.add(key(entry.file,row.rule,row.oldIdentity));next.add(key(entry.file,row.rule,row.newIdentity));
    }
    for(const [identity,row] of old){
        budget.check();if(!files.has(row.file))continue;
        const value=current.get(identity);
        if((!value||value.count!==row.count)&&!prior.has(identity))fail('TRANSITION_CONTEXT_MISMATCH');
        if(value&&['reason','owner','remediation'].some(field=>row[field]!==value[field]))fail('TRANSITION_CONTEXT_MISMATCH');
    }
    for(const [identity,row] of current){
        budget.check();if(!files.has(row.file))continue;
        if((!old.has(identity)||old.get(identity).count!==row.count)&&!next.has(identity))fail('TRANSITION_CONTEXT_MISMATCH');
    }
}
function preservationBijection(remaps,{old,current,budget}){
    const replacements=new Map(remaps.map(row=>[key(row.file,row.rule,row.oldIdentity),key(row.file,row.rule,row.newIdentity)]));
    const consumed=new Set();
    for(const [identity,row] of old){
        budget.check();
        const nextKey=replacements.get(identity)||identity,next=current.get(nextKey);
        if(!next||consumed.has(nextKey)||next.count!==row.count
            ||['reason','owner','remediation'].some(field=>next[field]!==row[field]))fail('TRANSITION_CONTEXT_MISMATCH');
        consumed.add(nextKey);
    }
    if(consumed.size!==current.size)fail('TRANSITION_CONTEXT_MISMATCH');
}
function namedScope(node,source){
    const result=[];
    for(let current=node;current;current=current.parent){
        const named=ts.isFunctionDeclaration(current)||ts.isFunctionExpression(current)||ts.isClassDeclaration(current)
            ||ts.isClassExpression(current)||ts.isMethodDeclaration(current)||ts.isGetAccessorDeclaration(current)
            ||ts.isSetAccessorDeclaration(current)||ts.isInterfaceDeclaration(current)||ts.isTypeAliasDeclaration(current)
            ||ts.isModuleDeclaration(current);
        if(named&&current.name)result.push(`${current.kind}:${printer.printNode(ts.EmitHint.Unspecified,current.name,source)}`);
        if(ts.isConstructorDeclaration(current))result.push('constructor');
        if((ts.isVariableDeclaration(current)||ts.isPropertyAssignment(current)||ts.isPropertyDeclaration(current))&&current.initializer
            &&(ts.isArrowFunction(current.initializer)||ts.isFunctionExpression(current.initializer)))
            result.push(`callable:${current.kind}:${printer.printNode(ts.EmitHint.Unspecified,current.name,source)}`);
    }
    return JSON.stringify(result);
}
function leafContexts(file,text,remaps,side,budget){
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    if(source.parseDiagnostics.length)fail('TRANSITION_SOURCE_INVALID');
    const wanted=new Set(remaps.map(row=>key(file,row.rule,row[side]))),rows=new Map(),anchors=new WeakMap();
    function walk(node){
        budget.check();
        const kinds=ts.isIdentifier(node)?['task_identifier']
            :ts.isPropertyAssignment(node)?['business_binding','business_record_lookup']
                :ts.isVariableDeclaration(node)?['business_binding']
                    :ts.isBinaryExpression(node)?['business_comparison']:[];
        if(kinds.length){
            let anchor=node;
            while(anchor.parent&&!ts.isStatement(anchor)&&!ts.isSourceFile(anchor.parent))anchor=anchor.parent;
            if(!anchors.has(anchor))anchors.set(anchor,printer.printNode(ts.EmitHint.Unspecified,anchor,source));
            const leaf=printer.printNode(ts.EmitHint.Unspecified,node,source);
            for(const rule of kinds){
                const identity=digest(rule+'\0'+anchors.get(anchor)+'\0'+leaf),identityKey=key(file,rule,identity);
                if(!wanted.has(identityKey))continue;
                const signature=namedScope(node,source),leafSha256=digest(leaf),prior=rows.get(identityKey);
                if(prior){
                    if(prior.leafSha256!==leafSha256)fail('TRANSITION_CONTEXT_MISMATCH');
                    prior.scopes.set(signature,(prior.scopes.get(signature)||0)+1);prior.count++;
                }else rows.set(identityKey,{scopes:new Map([[signature,1]]),leafSha256,count:1});
            }
        }
        ts.forEachChild(node,walk);
    }
    walk(source);
    for(const row of rows.values()){row.signature=JSON.stringify([...row.scopes].sort(([left],[right])=>left.localeCompare(right)));delete row.scopes;}
    budget.check();return rows;
}
function validatePreservation({entry,before,after},{budget,old,current}){
    const previous=leafContexts(entry.file,before.toString(),entry.remaps,'oldIdentity',budget);
    const next=leafContexts(entry.file,after.toString(),entry.remaps,'newIdentity',budget);
    return entry.remaps.map(remap=>{
        budget.check();
        const priorKey=key(entry.file,remap.rule,remap.oldIdentity),nextKey=key(entry.file,remap.rule,remap.newIdentity);
        const prior=old.get(priorKey),row=current.get(nextKey),oldLeaf=previous.get(priorKey),newLeaf=next.get(nextKey);
        if(!prior||!row||current.has(priorKey)||old.has(nextKey)||prior.count!==remap.count||row.count!==remap.count
            ||['reason','owner','remediation'].some(field=>prior[field]!==row[field])
            ||!oldLeaf||!newLeaf||oldLeaf.count!==remap.count||newLeaf.count!==remap.count
            ||oldLeaf.leafSha256!==remap.leafSha256||newLeaf.leafSha256!==remap.leafSha256
            ||oldLeaf.signature!==newLeaf.signature)fail('TRANSITION_CONTEXT_MISMATCH');
        return {file:entry.file,rule:remap.rule,oldIdentity:remap.oldIdentity,newIdentity:remap.newIdentity,count:remap.count};
    });
}
module.exports={preservationPath,parsePreservations,validatePreservation,completePreservationPack,preservationBijection};
