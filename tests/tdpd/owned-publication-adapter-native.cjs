const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base=path.resolve(process.env.OWNED_TEST_DIST||'dist');
const optional=file=>fs.existsSync(file)?require(file):{};
const registry=optional(path.join(base,'services/owned_publication_registry.js'));
const fixture=optional(path.resolve('tests/fixtures/owned-publication-native/root.cjs'));
test('OAR01 production registry is registered independent process and policy-held before secrets',async()=>{
 assert.equal(typeof registry.createProductionOwnedPublicationAdapter,'function','shared registered independent adapter is absent');
 const a=registry.createProductionOwnedPublicationAdapter();await assert.rejects(a.authorize('inventory'),/OWNED_DZEN_ACTION_SCOPE_UNRESOLVED/);
 assert.equal(a.registration.transport,'independent_process');assert.equal(a.registration.provider,'dzen');
});
test('OAR02 two packages use actual local inventory/edit/upload/one Submit/strict receipt/readback in separate sandboxed child',async()=>{
 assert.equal(typeof fixture.runNativeScenarios,'function','independent native fixture composition is absent');
 const r=await fixture.runNativeScenarios(base);assert.equal(r.packages,2);assert.equal(r.submits,2);assert.equal(r.readbacks,2);assert.equal(r.sandbox,true);assert.equal(r.externalRequests,0);assert.equal(r.childrenClosed,true);
});
test('OAR03 phase denial, unsupported proof, cancelled child and child crash clean up without resend',async()=>{
 assert.equal(typeof fixture.runFailureScenarios,'function','independent native failure/cleanup implementation is absent');
 const r=await fixture.runFailureScenarios(base);assert.equal(r.submitsAfterDenied,0);assert.equal(r.uncertain,true);assert.equal(r.childrenClosed,true);assert.equal(r.secretLeaked,false);
});

test('OAR04 all native phases share invocation deadline, expired budget avoids secrets and cancellation joins in-flight fences',async()=>{const result=await fixture.runBudgetScenarios(base);assert.deepEqual(result,{sharedDeadline:true,callbacksJoined:true,secretRead:false});});

test('OAR05 a malicious native page cannot POST final Submit twice under one consumed permission',async()=>{assert.deepEqual(await fixture.runDoubleSubmitScenarios(base),{providerSubmits:1,uncertain:true});});

test('OAR06 SIGKILL before browser resource ACK closes paused startup browser within ten seconds and zero native requests',async()=>{assert.deepEqual(await fixture.runStartupCrashScenarios(base),{startupClosed:true,nativeRequests:0});});

test('OAR07 one claim permits only first create POST before binding; a duplicate draft request is blocked',async()=>{assert.deepEqual(await fixture.runDoubleCreateScenarios(base),{drafts:1,providerSubmits:0});});

test('OAR08 oversized chunked creation response and redirect fail closed after exactly one native HTTP request',async()=>{assert.deepEqual(await fixture.runTransportBounds(base),{singleRequest:true,noSubmit:true,bounded:true});});

test('OAR09 oversized and redirected Submit responses remain uncertain; same-object readback reconciles without resend',async()=>{assert.deepEqual(await fixture.runSubmitTransportBounds(base),{singleSubmit:true,reconciliationOnly:true});});

test('OAR10 receipt requires freshly reloaded native primary body after Submit; stale editor DOM is insufficient',async()=>{assert.deepEqual(await fixture.runFreshProof(base),{freshBody:true,providerSubmits:1});});

test('OAR11 awaited Submit fence changing persisted body triggers fresh read-only proof and zero outgoing publish requests',async()=>{assert.deepEqual(await fixture.runAwaitedSubmitProof(base),{providerSubmits:0,originalBindingHeld:true});});

test('OAR12 an admitted unfinished autosave must drain before fresh verification and can never race Submit',async()=>{assert.deepEqual(await fixture.runPendingAutosaveProof(base),{providerSubmits:0,pendingWriteDrained:true});});
