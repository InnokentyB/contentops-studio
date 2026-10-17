// Six executable reachability diagnostics, not budget acceptance GREEN.
// Full controlled-clock budget assertions must bind to the approved mechanism
// after LOCK; this file cannot substitute for those acceptance regressions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture,policyFile,sourceFile} = require('../fixtures/runtime-policy-transition.cjs');
const scenarios = require('../fixtures/runtime-policy-budget-scenarios.json');
const probe = path.resolve(__dirname,'../fixtures/runtime-policy-budget-probe.cjs');

for(const scenario of scenarios.cases) test(`proposed budget diagnostic: ${scenario.name}`,t=>{
    const f=fixture(t); f.apply();
    const tracePath=path.join(f.root,'budget-trace.json');
    const preload=path.join(f.root,'fixture-budget-probe.cjs');
    f.write('fixture-budget-probe.cjs',`require(${JSON.stringify(probe)}).installBudgetProbe(${JSON.stringify({scenario,tracePath,policyFile,sourceFile})});`);
    const result=f.runWithEnv({NODE_OPTIONS:`--require=${preload}`},'--base-ref',f.base);
    assert.ok(fs.existsSync(tracePath),'the preload must initialize before the gate runs');
    const trace=JSON.parse(fs.readFileSync(tracePath,'utf8'));
    assert.equal(trace.probeInstalled,true);
    assert.equal(trace.case,scenario.name);
    const gateErrors=result.report.errors?.map(e=>e.code)||[];
    const expectedMissingMechanism=result.status===1&&result.report.verdict==='FAIL'
        &&gateErrors.length===1&&gateErrors[0]==='BASELINE_WIDENED'
        &&result.report.findingsCount===1&&result.report.baselineCount===1;
    const classification=trace.reads.length?'TRANSITION_IO_REACHED'
        :expectedMissingMechanism?'RED_MISSING_TRANSITION_MECHANISM':'UNCLASSIFIED_OR_SETUP_FAILURE';
    const diagnostic={case:scenario.name,status:result.status,gateErrors,
        transitionReads:trace.reads.length,observedTimeoutsMs:trace.reads.map(read=>read.timeoutMs),
        fakeElapsedMs:trace.elapsedMs,expectedBudgetError:scenario.expectedError,
        boundary:classification,
        budgetAcceptanceVerified:false};
    t.diagnostic(JSON.stringify(diagnostic));
    if(!trace.reads.length) assert.ok(expectedMissingMechanism,
        `Unexpected CLI/fixture failure; cannot classify as a missing mechanism: ${JSON.stringify(diagnostic)}`);
    assert.ok(trace.reads.length>0,
        `Expected missing-transition RED at a valid baseline: ${JSON.stringify(diagnostic)}. No budget control was exercised.`);
});
