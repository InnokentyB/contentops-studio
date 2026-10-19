const {createHash} = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const body = 'A synthetic accepted paragraph.\n\nA separate second paragraph.';
const snapshot = {projectId:7, taskId:1136, channelId:6, contentRevision:5,
    bodySha256:sha(body), scheduleAt:'2026-10-16T14:00:00.000Z', publishAt:'2026-10-16T14:00:00.000Z',
    selectedAssetId:166, assetSha256:'a'.repeat(64), decisionId:327, decisionVersion:4,
    manifestChecksum:'sha256:'+'b'.repeat(64), contentLanguage:'en',
    identity:{platform:'linkedin', accountType:'company_page', accountRef:'seturon_linkedin_page',
        profileUrl:'https://www.linkedin.com/company/seturon/', providerAccountId:'97416172',
        registryReference:'registry:profile_seturon_linkedin_page:v36', registryEvidenceSha256:'c'.repeat(64)}};
const request = {projectId:7, taskId:1136, actorId:'user:2', snapshot,
    approvalReference:'Owner approved exact accepted package', idempotencyKey:'synthetic-release'};
function fixture() {
    let state = {owner:true, manifest:snapshot.manifestChecksum, events:[], work:[], attempts:[], fact:null, failAudit:false,
        task:{id:1136, project_id:7, channel_id:6, week_package_id:null, item_key:'synthetic-slot',
            content_revision:5, accepted_revision:5, draft_text:body, text_state:'accepted', status:'ready_for_execution',
            publication_mode:'approval_required', handoff_state:'ready', visual_state:'APPROVED',
            visual_placement:'feed', visual_decision_version:4, selected_asset_id:166,
            schedule_at:new Date(snapshot.scheduleAt), publish_at:new Date(snapshot.publishAt),
            published_link:null, publication_fact:null, quality_report:{content_language:'ru',history:'preserve',
                handoff_bundle:{content_language:'ru', publication:{body}, task:{account_ref:'seturon_linkedin_page'}}},
            channel:{id:6, project_id:7, name:'seturon_linkedin_page', type:'linkedin', is_active:true,
                config:{account_ref:'seturon_linkedin_page', account_type:'company_page', execution_modes:['manual'],
                    raw_account:{url:snapshot.identity.profileUrl},capability_flags:{manual_handoff:true}}},
            selected_asset:{id:166, project_id:7, content_item_id:1136, content_revision:5, decision_id:327,
                placement:'feed', status:'approved', file_url:'https://synthetic.invalid/approved.jpg',
                provenance:{planner_storage:{managed:true,provider:'r2',mime_type:'image/jpeg',sha256:snapshot.assetSha256}}},
            art_direction_decisions:[{id:327,project_id:7,content_item_id:1136,source_content_revision:5,
                decision_version:4,status:'active',decision:'GENERATE',channel:'linkedin',placement:'feed'}]}};
    const matches = (row, where) => Object.entries(where).every(([key,value]) => {
        if(key==='OR')return value.some(branch=>matches(row,branch));
        if(value&&typeof value==='object'&&!(value instanceof Date)) {
            if('in' in value)return value.in.includes(row[key]);
            if('notIn' in value)return !value.notIn.includes(row[key]);
            if('lt' in value)return row[key]<value.lt;
            if('gt' in value)return row[key]>value.gt;
            if('not' in value)return row[key]!==value.not;
            return true;
        }
        return value instanceof Date ? row[key]?.getTime()===value.getTime() : row[key]===value;
    });
    const table = name => ({
        findFirst:async({where={}}={})=>state[name].find(row=>matches(row,where))||null,
        findMany:async({where={}}={})=>state[name].filter(row=>matches(row,where)),
        count:async({where={}}={})=>state[name].filter(row=>matches(row,where)).length,
        create:async({data})=>{if(name==='events'&&state.failAudit)throw Error('synthetic audit unavailable');
            const row={id:100+state[name].length,...(name==='attempts'?{created_at:new Date()}:{}),...data};state[name].push(row);return row;},
        updateMany:async({where,data})=>{const rows=state[name].filter(row=>matches(row,where));
            rows.forEach(row=>Object.assign(row,data));return{count:rows.length};}});
    const db = {$queryRaw:async()=>[{available:false}],projectMember:{findUnique:async()=>({role:state.owner?'owner':'editor'})},
        contentItem:{findFirst:async({where})=>matches(state.task,where)?state.task:null,
            updateMany:async({where,data})=>{if(!matches(state.task,where))return{count:0};Object.assign(state.task,data);return{count:1};}},
        workflowEvent:table('events'), workItem:table('work'), deliveryAttempt:table('attempts'),
        publicationFact:{findUnique:async()=>state.fact}, connectorDispatchJob:{findFirst:async()=>null},
        $transaction:async run=>{const before=structuredClone(state);try{return await run(db);}catch(error){state=before;throw error;}}};
    return {db, manifest:async()=>({checksum:state.manifest}), get state(){return state;}};
}
module.exports={sha,body,snapshot,request,fixture};
