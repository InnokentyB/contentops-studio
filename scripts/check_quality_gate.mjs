#!/usr/bin/env node
import fs from 'node:fs'; import { execFileSync, spawnSync } from 'node:child_process';
const MIN_SCORE=77;
const checks=[
['remote_mcp_identity','src/tests/remote_mcp_auth.test.ts',/tenant|project|identity/i],
['mutating_tool_annotations','src/tests/remote_mcp_auth.test.ts',/destructive|readOnlyHint|idempotentHint/],
['header_cookie_sanitization','src/services/puppeteer_publisher.service.ts',/parseBrowserCookieHeader/],
['auth_rate_limits','src/routes/auth.routes.ts',/rateLimit/],
['db_pool_safety','src/db.ts',/pool\.on\(['"]error/],
['external_idempotency','src/services/delivery.service.ts',/idempotency/i],
['uncertain_provider_outcomes','src/tests/delivery.service.test.ts',/publication_fact|blocked/i],
['browser_cleanup','src/services/puppeteer_publisher.service.ts',/finally[\s\S]{0,500}close\(/],
['graceful_shutdown','src/server.ts',/gracefulShutdown[\s\S]*\$disconnect/]
];
const audit=JSON.parse(execFileSync(process.execPath,['scripts/audit_code_quality.mjs','--json'],{encoding:'utf8'}));
const results=checks.map(([id,file,pattern])=>({id,file,pass:pattern.test(fs.existsSync(file)?fs.readFileSync(file,'utf8'): '')}));
const hardStops=results.filter(x=>!x.pass); if(audit.score<MIN_SCORE) hardStops.push({id:'score_regression',expected:MIN_SCORE,actual:audit.score});
const runtimeProcess=spawnSync(process.execPath,['scripts/check_runtime_policy.cjs'],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,killSignal:'SIGKILL'});
let runtimePolicy;
try {runtimePolicy=JSON.parse(runtimeProcess.stdout);} catch {runtimePolicy={verdict:'FAIL',errors:[{code:'RUNTIME_POLICY_REPORT_INVALID'}]};}
if(runtimeProcess.status!==0 || runtimePolicy.verdict!=='PASS') hardStops.push({id:'runtime_policy_no_new_debt',report:runtimePolicy});
const report={command:'npm run quality:gate',timestamp:new Date().toISOString(),revision:execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim(),score:audit.score,minimum_score:MIN_SCORE,checks:results,runtime_policy:runtimePolicy,hard_stops:hardStops,verdict:hardStops.length?'FAIL':'PASS'};
console.log(JSON.stringify(report,null,2)); process.exitCode=hardStops.length?1:0;
