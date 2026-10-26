const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {terminalPreparationDiagnostic:diagnose}=require(path.join(process.env.SHARED_BROWSER_DIST||'/opt/planner/dist','services/browser_terminal_diagnostics.js'));
test('operator sees different actionable causes for unsupported source, wrong release and expired verification',()=>{
 const results=['TERMINAL_LOCAL_OUTPUT_UNVERIFIED','TERMINAL_PRODUCER_VERSION_MISMATCH','TERMINAL_REVIEW_STALE'].map(code=>diagnose(new Error('['+code+'] sensitive provider payload')));
 assert.equal(new Set(results.map(r=>r.message)).size,3);assert.equal(new Set(results.map(r=>r.reasons[0].action)).size,3);
 for(const result of results){assert.equal(result.retry_allowed,false);assert.ok(result.reasons[0].action.length>50);assert.doesNotMatch(JSON.stringify(result),/sensitive provider payload/);}
 assert.match(results[0].reasons[0].action,/original computer/);assert.match(results[1].message,/different verifier/);assert.match(results[2].reasons[0].action,/budget/);
});
test('untyped failures and authorization errors never echo native payloads or suggest another send',()=>{
 for(const error of [new Error('Bearer private-secret cookie=private-cookie'),new Error('[TERMINAL_PUBLISHER_REQUIRED] secret-lease')]){
  const result=diagnose(error);assert.doesNotMatch(JSON.stringify(result),/private-secret|private-cookie|secret-lease/);assert.equal(result.retry_allowed,false);assert.ok(result.reasons[0].action);
 }
});
