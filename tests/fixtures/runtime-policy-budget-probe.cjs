// Test process instrumentation only. It observes real gate reads, advances fake
// clocks and injects configured child faults; it never grants a remap or enforces
// a deadline/count policy on behalf of the unimplemented gate mechanism.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {performance} = require('node:perf_hooks');

function installBudgetProbe({scenario, tracePath, policyFile, sourceFile}) {
    let elapsed = 0;
    const trace = {probeInstalled:true,case:scenario.name,startMs:scenario.startMs,reads:[]};
    const persist = () => fs.writeFileSync(tracePath,JSON.stringify({...trace,elapsedMs:elapsed}),{mode:0o600});
    Date.now = () => scenario.startMs + elapsed;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>scenario.startMs+elapsed});
    const originals = {execFileSync:cp.execFileSync,spawnSync:cp.spawnSync};
    const isTransitionRead = (file,args,options) => path.basename(file)==='git'
        && ['show','ls-tree','cat-file'].includes(args[0])
        && (args[0]==='cat-file'||args.some(arg=>[policyFile,sourceFile].some(p=>arg===p||arg.endsWith(':'+p)))
            ||[policyFile,sourceFile].some(p=>String(options?.input||'').includes(p)));
    for(const method of ['execFileSync','spawnSync']) cp[method] = function(file,args=[],options={}) {
        if(!isTransitionRead(file,args,options)) return originals[method].call(cp,file,args,options);
        const index=trace.reads.length;
        const duration=scenario.readDurationsMs?.[index]??scenario.repeatRead?.durationMs??0;
        trace.reads.push({method,command:args[0],timeoutMs:options.timeout??null,startedMs:elapsed,durationMs:duration});
        elapsed+=duration; persist();
        const fault=scenario.childErrors?.[index];
        if(fault){
            const error=Object.assign(new Error('synthetic child read failure'),{code:fault,
                stderr:Buffer.from(scenario.privateStderr||''),stdout:Buffer.alloc(0)});
            if(method==='execFileSync') throw error;
            return {error,status:null,signal:null,stdout:'',stderr:scenario.privateStderr||''};
        }
        return originals[method].call(cp,file,args,options);
    };
    persist();
}
module.exports = {installBudgetProbe};
