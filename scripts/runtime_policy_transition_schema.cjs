const {fail}=require('./runtime_policy_budget.cjs');
const artifactPath='docs/code-quality/runtime-policy-transitions.json';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const relative=value=>typeof value==='string'&&/^[\w./-]+$/.test(value)&&!value.startsWith('/')
    &&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
function exact(value,keys) {
    if(!value||typeof value!=='object'||Array.isArray(value)
        ||Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))fail('TRANSITION_INVALID_ARTIFACT');
}
function parseTransitions(bytes) {
    if(Buffer.byteLength(bytes)>65536)fail('TRANSITION_ARTIFACT_TOO_LARGE');
    let data;
    try{data=JSON.parse(bytes.toString());}catch{fail('TRANSITION_INVALID_ARTIFACT');}
    exact(data,['schemaVersion','entries']);
    if(data.schemaVersion!==1||!Array.isArray(data.entries)||data.entries.length>8)fail('TRANSITION_INVALID_ARTIFACT');
    const files=new Set();let total=0;
    for(const entry of data.entries){
        exact(entry,['file','oldSourceSha256','newSourceSha256','remaps','review']);
        if(!relative(entry.file)||!/\.[cm]?[jt]sx?$/.test(entry.file)||/(?:^|\/)\.env(?:\.|$)/.test(entry.file)
            ||files.has(entry.file)||!hex(entry.oldSourceSha256)||!hex(entry.newSourceSha256)
            ||entry.oldSourceSha256===entry.newSourceSha256||!Array.isArray(entry.remaps)
            ||!entry.remaps.length||entry.remaps.length>64)fail('TRANSITION_INVALID_ARTIFACT');
        files.add(entry.file);total+=entry.remaps.length;
        const old=new Set(),next=new Set();
        for(const row of entry.remaps){
            exact(row,['rule','oldIdentity','newIdentity','count','symbol']);
            if(row.rule!=='task_identifier'||!hex(row.oldIdentity)||!hex(row.newIdentity)
                ||row.oldIdentity===row.newIdentity||old.has(row.oldIdentity)||next.has(row.newIdentity)
                ||!Number.isSafeInteger(row.count)||row.count<1||typeof row.symbol!=='string'
                ||!row.symbol.length||row.symbol.length>200)fail('TRANSITION_INVALID_ARTIFACT');
            old.add(row.oldIdentity);next.add(row.newIdentity);
        }
        exact(entry.review,['reference','owner','reason','removalPlan']);
        if(Object.values(entry.review).some(value=>typeof value!=='string'||value.trim().length<4||value.length>2000))
            fail('TRANSITION_INVALID_ARTIFACT');
    }
    if(total>256)fail('TRANSITION_INVALID_ARTIFACT');
    return data.entries;
}
module.exports={artifactPath,parseTransitions,relative};
