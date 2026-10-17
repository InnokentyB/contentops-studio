// Proposed resource/trust regressions only; no admission implementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {fixture, hash, before, after, sourceFile, policyFile} = require('../fixtures/runtime-policy-transition.cjs');
const mib = 1024 * 1024;
const padded = (source, bytes) => source + '\n//' + 'p'.repeat(bytes - Buffer.byteLength(source) - 3);
const commit = (f, message) => {
    f.git('-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid',
        '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message);
    return f.git('rev-parse', 'HEAD');
};
function rejected(result, code) {
    assert.equal(result.status, 1, JSON.stringify(result.report));
    assert.ok(result.report.errors.some(error => error.code === code), JSON.stringify(result.report));
}

for (const side of ['before', 'after']) test(`proposed R27: ${side} source over 1 MiB is classified and rejected`, t => {
    const options = {[side]: padded(side === 'before' ? before : after, mib + 1)};
    const f = fixture(t, options); f.apply();
    rejected(f.checked(), 'TRANSITION_SOURCE_TOO_LARGE');
});

test('proposed R28: exact 1 MiB source boundary permits the reviewed correction', t => {
    const f = fixture(t, {before:padded(before,mib),after:padded(after,mib)}); f.apply();
    const result = f.checked();
    assert.equal(result.status, 0, JSON.stringify(result.report));
});

test('proposed R29: aggregate source bytes over 8 MiB are rejected despite individual limits', t => {
    const f = fixture(t), size = 600 * 1024, oldText = padded(before, size), newText = padded(after, size);
    const files = Array.from({length:7}, (_, index) => `src/provider_${index}.ts`);
    for (const file of files) {
        f.write(file, oldText);
        f.transition.entries.push({...f.transition.entries[0],file,oldSourceSha256:hash(oldText),newSourceSha256:hash(newText)});
    }
    f.baseline([...f.entries,...files.map(file=>({...f.entries[0],file}))]);
    f.write(policyFile, JSON.stringify(f.transition)); f.git('add', '.');
    const base = commit(f, 'trusted synthetic aggregate source bound');
    f.apply();
    for (const file of files) f.write(file, newText);
    f.baseline([...f.next.map(row=>({...f.entries[0],...row})),...files.map(file=>({...f.entries[0],...f.next[0],file}))]);
    const marker=path.join(f.root,'contexts-called.txt'),preload=path.join(f.root,'context-probe.cjs');
    const contextModule=path.resolve(__dirname,'../../scripts/runtime_policy_transition_context.cjs');
    f.write('context-probe.cjs',`require(${JSON.stringify(contextModule)}).contexts=()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'called');throw Error('AST_BEFORE_SIZE_CHECK');};`);
    rejected(f.runWithEnv({NODE_OPTIONS:`--require=${preload}`},'--base-ref',base), 'TRANSITION_SOURCE_TOO_LARGE');
    assert.equal(fs.existsSync(marker),false,'aggregate size must be rejected before any context parsing');
});

test('proposed R30: trusted source Git mode is checked independently of valid source bytes', t => {
    const f = fixture(t);
    const blob = execFileSync('git',['hash-object','-w','--stdin'],{cwd:f.root,input:before,encoding:'utf8'}).trim();
    f.git('update-index','--cacheinfo','120000',blob,sourceFile);
    const base = commit(f, 'valid source bytes with invalid trusted mode'); f.apply();
    rejected(f.run('--base-ref',base), 'TRANSITION_SOURCE_MODE_INVALID');
});

test('proposed R31: working-tree source symlink is rejected by the existing source boundary', t => {
    const f = fixture(t); f.apply();
    f.write('docs/synthetic-source.txt', after);
    fs.unlinkSync(path.join(f.root,sourceFile));
    fs.symlinkSync('../docs/synthetic-source.txt',path.join(f.root,sourceFile));
    rejected(f.checked(), `TRACKED_SOURCE_SYMLINK_UNSUPPORTED:${sourceFile}`);
});

test('proposed R32: a missing nonzero full commit object cannot authorize a transition', t => {
    const f = fixture(t); f.apply();
    const missing = 'f'.repeat(40);
    assert.notEqual(spawnSync('git',['cat-file','-e',missing+'^{commit}'],{cwd:f.root,stdio:'ignore'}).status,0);
    rejected(f.run('--base-ref',missing), 'TRUSTED_BASELINE_UNAVAILABLE');
});

test('proposed R33: one hung transition Git read has a bounded sanitized failure', t => {
    const f = fixture(t); f.apply();
    const realGit = execFileSync('which',['git'],{encoding:'utf8'}).trim();
    const wrapper = path.join(f.root,'fixture-bin/git'), trace = path.join(f.root,'git-delay-trace.txt');
    const script = `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2),paths=${JSON.stringify([policyFile,sourceFile])};
if(['show','ls-tree','cat-file'].includes(args[0]) && (args[0]==='cat-file'||args.some(arg=>paths.some(file=>arg===file||arg.endsWith(':'+file))))){
 fs.appendFileSync(${JSON.stringify(trace)},'hung-read\\n');
 process.stderr.write('SYNTHETIC_PRIVATE_GIT_STDERR');
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);
}
const result=cp.spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});
process.exit(result.status===null?1:result.status);
`;
    f.write('fixture-bin/git',script); fs.chmodSync(wrapper,0o700);
    const started = process.hrtime.bigint();
    // /tmp is deliberately noexec in the reviewed container. Invoke the fixture
    // through Node, retaining the real child timeout rather than weakening mounts.
    const preload=path.join(f.root,'git-timeout-preload.cjs');
    f.write('git-timeout-preload.cjs',`
const cp=require('node:child_process'),original=cp.execFileSync;
cp.execFileSync=function(file,args,options){
 if(file==='git'&&['show','ls-tree','cat-file'].includes(args[0])&&args.some(arg=>${JSON.stringify([policyFile,sourceFile])}.some(p=>arg===p||arg.endsWith(':'+p))))
  return original(process.execPath,[${JSON.stringify(wrapper)},...args],options);
 return original(file,args,options);
};`);
    const result = f.runWithEnv({NODE_OPTIONS:`--require=${preload}`},'--base-ref',f.base);
    const elapsedMs = Number(process.hrtime.bigint()-started)/1e6;
    rejected(result,'TRANSITION_READ_TIMEOUT');
    assert.ok(fs.existsSync(trace),'transition I/O must actually reach the delayed provider-independent Git boundary');
    assert.ok(!JSON.stringify(result.report).includes('SYNTHETIC_PRIVATE_GIT_STDERR'));
    assert.ok(elapsedMs<4000,`bounded read plus runner overhead exceeded: ${elapsedMs}`);
});
