// Offline developer-control I/O budget. No runtime publication authority.
const cp=require('node:child_process');
const {performance}=require('node:perf_hooks');
const fail=code=>{throw Object.assign(new Error(code),{code});};

function createReadBudget({now=()=>performance.now(),execute=cp.execFileSync}={}) {
    const deadline=now()+2000;
    let reads=0;
    const check=()=>{if(now()>=deadline)fail('TRANSITION_DEADLINE_EXCEEDED');};
    return {
        check,
        git(args,{maxBytes,overflowCode='TRANSITION_ARTIFACT_TOO_LARGE'}={}) {
            check();
            if(reads>=32)fail('TRANSITION_READ_LIMIT_EXCEEDED');
            const remaining=Math.floor(deadline-now());
            if(remaining<1)fail('TRANSITION_DEADLINE_EXCEEDED');
            const timeout=Math.min(1000,remaining);
            reads++;
            let output;
            try {
                output=execute('git',args,{stdio:['ignore','pipe','pipe'],timeout,maxBuffer:maxBytes,killSignal:'SIGKILL'});
            }catch(error){
                check();
                if(error.code==='ETIMEDOUT')fail('TRANSITION_READ_TIMEOUT');
                if(error.code==='ENOBUFS')fail(overflowCode);
                fail('TRANSITION_READ_FAILED');
            }
            check();
            const bytes=Buffer.isBuffer(output)?output:Buffer.from(output);
            if(bytes.length>maxBytes)fail(overflowCode);
            return bytes;
        }
    };
}
module.exports={createReadBudget,fail};
