#!/usr/bin/env node
const cp = require('node:child_process');
const {readSource} = require('./runtime_policy_source.cjs');
const {scanRepository} = require('./runtime_policy_scanner.cjs');
const {reviewedTransitions} = require('./runtime_policy_transitions.cjs');
const key = row => [row.file, row.rule, row.identity].join('\0');
// Only the reviewed introduction may have no baseline in its trusted parent.
const bootstrapBase = '12025f29ddf51d30e90825caf2d90e09e1045a1b';

function parseBaseline(text) {
    const data = JSON.parse(text), seen = new Set();
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw new Error('INVALID_BASELINE');
    for (const row of data.entries) {
        if (!row || typeof row.file !== 'string' || !/^[\w./-]+$/.test(row.file) || row.file.split('/').includes('..')
            || !/^[a-z_]+$/.test(row.rule) || !/^[a-f0-9]{64}$/.test(row.identity)
            || !Number.isSafeInteger(row.count) || row.count < 1
            || ['reason', 'owner', 'remediation'].some(field => typeof row[field] !== 'string' || row[field].trim().length < 4)
            || seen.has(key(row))) throw new Error('INVALID_BASELINE');
        seen.add(key(row));
    }
    return data.entries;
}

// HEAD can only demand an explicit comparison; it never authorizes a transition.
function localComparisonNeeded(baselinePath,baseline){
    const result=cp.spawnSync('git',['show','HEAD:'+baselinePath],{encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024});
    if(result.error)return true;
    if(result.status===0){
        let committed;
        try{committed=parseBaseline(result.stdout);}catch{return true;}
        const old=new Map(committed.map(row=>[key(row),row.count]));
        return baseline.some(row=>row.count>(old.get(key(row))||0));
    }
    const head=cp.spawnSync('git',['rev-parse','--verify','HEAD'],{stdio:'ignore',timeout:5000});
    return Boolean(head.error)||(head.status===0&&baseline.length>0);
}

function run() {
    const started = Date.now(), args = process.argv.slice(2);
    const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
    const baselinePath = value('--baseline') || 'docs/code-quality/runtime-policy-baseline.json';
    const result = scanRepository();
    if (args.includes('--inspect')) return {...result, verdict: result.errors.length ? 'FAIL' : 'INSPECT', elapsedMs: Date.now() - started};
    let baseline;
    try { baseline = parseBaseline(readSource(baselinePath)); }
    catch { result.errors.push({code: 'INVALID_BASELINE'}); baseline = []; }
    const admitted = new Map(baseline.map(row => [key(row), row.count]));
    for (const finding of result.findings) {
        if (finding.count > (admitted.get(key(finding)) || 0)) result.errors.push({code: 'NEW_RUNTIME_POLICY_DEBT', ...finding});
    }
    const current = new Map(result.findings.map(row => [key(row), row.count]));
    for (const row of baseline) {
        if ((current.get(key(row)) || 0) < row.count) result.errors.push({code: 'STALE_BASELINE_ENTRY', file: row.file, rule: row.rule, identity: row.identity});
    }
    const cliBase=value('--base-ref'),eventBase=process.env.RUNTIME_POLICY_BASE_REF;
    const baseRef = eventBase || cliBase;
    const transitions=[];
    if(cliBase&&eventBase&&cliBase!==eventBase)result.errors.push({code:'TRANSITION_BASE_CONFLICT'});
    if(process.env.GITHUB_ACTIONS==='true'&&(!/^(?!0{40}$)[a-f0-9]{40}$/.test(eventBase||'')
        ||!['pull_request','push'].includes(process.env.GITHUB_EVENT_NAME)))result.errors.push({code:'TRANSITION_BASE_REQUIRED'});
    if(!baseRef&&localComparisonNeeded(baselinePath,baseline))result.errors.push({code:'TRANSITION_BASE_REQUIRED'});
    if (baseRef) {
        if (!/^[a-f0-9]{7,40}$|^HEAD$/.test(baseRef)) throw new Error('INVALID_BASE_REF');
        let old;
        try { old = parseBaseline(cp.execFileSync('git', ['show', baseRef + ':' + baselinePath], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 5000
        })); }
        catch {
            const absent = cp.spawnSync('git', ['cat-file', '-e', baseRef + ':' + baselinePath], {stdio: 'ignore'}).status !== 0;
            const commitExists = cp.spawnSync('git', ['cat-file', '-e', baseRef + '^{commit}'], {stdio: 'ignore'}).status === 0;
            const bootstrap = baseRef === bootstrapBase && absent && commitExists;
            if (!bootstrap) result.errors.push({code: 'TRUSTED_BASELINE_UNAVAILABLE'});
            old = bootstrap ? baseline : [];
        }
        const oldMap = new Map(old.map(row => [key(row), row.count]));
        const growth=baseline.filter(row=>row.count>(oldMap.get(key(row))||0));
        if(growth.length){
            try {transitions.push(...reviewedTransitions({base:baseRef,cli:cliBase,oldRows:old,currentRows:baseline}));}
            catch(error){result.errors.push({code:/^TRANSITION_[A-Z_]+$/.test(error.code)?error.code:'TRANSITION_VALIDATION_FAILED'});}
            const reviewed=new Set(transitions.map(row=>key({file:row.file,rule:row.rule,identity:row.newIdentity})));
            if(growth.some(row=>!reviewed.has(key(row))))result.errors.push({code:'BASELINE_WIDENED'});
        }
    }
    return {verdict: result.errors.length ? 'FAIL' : 'PASS', errors: result.errors, scannedFiles: result.scannedFiles,
        operationalFiles: result.operationalFiles, findingsCount: result.findings.length, baselineCount: baseline.length,
        appliedTransitions:transitions,elapsedMs: Date.now() - started};
}

try {
    const result = run();
    console.log(JSON.stringify(result));
    process.exitCode = result.verdict === 'FAIL' ? 1 : 0;
} catch (error) {
    // Never print parser errors, source excerpts, child-process stdout or secrets.
    const code = /^(?:TRACKED_SOURCE_SYMLINK_UNSUPPORTED|SOURCE_OUTSIDE_REPOSITORY|SOURCE_NOT_REGULAR|RUN_FROM_REPOSITORY_ROOT|INVALID_SOURCE_PATH|INVALID_BASE_REF)(?::[\w./-]+)?$/.test(error.message) ? error.message : 'RUNTIME_POLICY_SCAN_FAILED';
    console.log(JSON.stringify({verdict: 'FAIL', errors: [{code}]}));
    process.exitCode = 1;
}
