const test=require('node:test');
const assert=require('node:assert/strict');
const {createReadBudget}=require('../../scripts/runtime_policy_budget.cjs');
const matrix=require('../fixtures/runtime-policy-budget-scenarios.json');

for(const scenario of matrix.cases) test(`budget: ${scenario.name}`,()=>{
    let clock=scenario.startMs,index=0,observedError=null;
    const timeouts=[];
    const durations=scenario.readDurationsMs||Array(scenario.repeatRead.count).fill(scenario.repeatRead.durationMs);
    const budget=createReadBudget({now:()=>clock,execute:(_file,_args,options)=>{
        timeouts.push(options.timeout);
        clock+=durations[index]??0;
        const fault=scenario.childErrors?.[index];index++;
        if(fault)throw Object.assign(new Error('synthetic failure'),{code:fault,stderr:scenario.privateStderr});
        return Buffer.from('synthetic Git result');
    }});
    try {
        for(const duration of durations)budget.git(['show','synthetic:source'],{maxBytes:1024});
        if(scenario.attemptOneMoreRead)budget.git(['show','synthetic:source'],{maxBytes:1024});
    }catch(error){observedError=error;}
    assert.equal(observedError?.code??null,scenario.expectedError);
    assert.equal(timeouts.length,scenario.expectedReadCount);
    assert.deepEqual(timeouts,scenario.expectedTimeoutsMs||Array(scenario.repeatRead.count).fill(scenario.repeatRead.expectedTimeoutMs));
    if(observedError)assert.ok(!String(observedError).includes('SYNTHETIC_PRIVATE_GIT_STDERR'));
});

test('budget classifies child buffer overflow without exposing captured output',()=>{
    const budget=createReadBudget({execute:()=>{throw Object.assign(new Error('private'),{code:'ENOBUFS',stdout:'private'});}});
    assert.throws(()=>budget.git(['show','synthetic:source'],{maxBytes:10,overflowCode:'TRANSITION_SOURCE_TOO_LARGE'}),
        error=>error.code==='TRANSITION_SOURCE_TOO_LARGE'&&!String(error).includes('private'));
});
