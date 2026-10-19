const {chromium}=require('playwright');const fs=require('node:fs');const path=require('node:path');
const base=path.resolve('/workspace/dist/services');
const {serveOwnedNativeChild}=require(path.join(base,'owned_publication_native_child.js'));
const {retainOwnedNativeResources,ownedNativeResourceArgument}=require(path.join(base,'owned_publication_adapter_resources.js'));
const {runDzenAdapterInPage}=require(path.join(base,'dzen_adapter_native_page.js'));
// Test-only executable, never imported or selected by production registration. Endpoint is encoded in synthetic cookie only.
serveOwnedNativeChild(async(input,secret,hooks,signal)=>{
 const match=secret.cookies.match(/^fixture_port=([0-9]+);fixture_mode=(normal|crash|stall|crash_after_start|crash_during_start)$/);if(!match)throw Error('fixture config invalid');
 const port=Number(match[1]),mode=match[2];if(mode==='crash'){process.stderr.write('synthetic-sensitive-value');process.exit(37);}
 const launch=chromium.launch({headless:true,chromiumSandbox:true,executablePath:chromium.executablePath(),args:[ownedNativeResourceArgument(input.nonce)]});
 if(mode==='crash_during_start'){
  const until=Date.now()+3000;let stopped=false;
  while(Date.now()<until&&!stopped){const children=fs.readFileSync(`/proc/self/task/${process.pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean);
   for(const pid of children){let args;try{args=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');}catch{continue;}
    if(args.includes(`--owned-publication-resource=${input.nonce}`)){process.kill(Number(pid),'SIGSTOP');fs.writeFileSync('/tmp/owned-native-startup-killed','before_resource_ack');stopped=true;process.kill(process.pid,'SIGKILL');}}
   await new Promise(resolve=>setTimeout(resolve,5));
  }if(!stopped)throw Error('startup crash fixture did not reach browser fork');
 }
 const browser=await launch;let closeError=false;
 const originalFetch=globalThis.fetch;const trace=[];const abort=()=>{void browser.close().catch(()=>{closeError=true;});};signal.addEventListener('abort',abort,{once:true});
 try{
  await retainOwnedNativeResources(input.nonce,signal);if(mode==='crash_after_start')process.kill(process.pid,'SIGKILL');
  const check=await browser.newPage();await check.goto('chrome://sandbox');const status=await check.textContent('body');
  if(!/Layer 1 SandboxNamespace/.test(status)||!/PID namespacesYes/.test(status)||!/Network namespacesYes/.test(status)||!/Seccomp-BPF sandboxYes/.test(status))throw Error('sandbox failed');
  const caps=fs.readFileSync('/proc/self/status','utf8');if(!/CapEff:\s+0000000000000000/.test(caps)||!/CapBnd:\s+0000000000000000/.test(caps))throw Error('outer caps nonzero');await check.close();
  const page=await browser.newPage({serviceWorkers:'block'});page.setDefaultTimeout(15000);
  page.on('requestfailed',request=>{if(trace.length<20)trace.push({failed:request.method()+' '+new URL(request.url()).pathname});});
  page.on('response',response=>{if(response.request().method()==='POST'&&response.url().endsWith('/publication'))void response.body().then(bytes=>trace.push({createBytes:bytes.length}),error=>trace.push({createError:error.message}));});
  async function localResponse(route){
   const u=new URL(route.request().url()),local=new URL(`http://127.0.0.1:${port}${u.pathname}${u.search}`);local.searchParams.set('__native_host',u.hostname);
   if(!['dzen.ru','avatars.dzeninfra.ru','fixture-assets.supabase.co'].includes(u.hostname))throw Error('external fixture request');
   const response=await originalFetch(local,{method:route.request().method(),headers:{'content-type':route.request().headers()['content-type']||'application/octet-stream'},body:route.request().postDataBuffer()||undefined});
   return {status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())};
  }
  const context=page.context(),register=context.route.bind(context);
  await register('**/*',async route=>{
   if(mode==='stall'){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return;}
   await route.fulfill(await localResponse(route));
  });
  // Test-only transport root: no production selector or fixture import exists.
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
   const u=new URL(url);if(u.origin!=='https://dzen.ru'||options.method!=='POST'||options.redirect!=='error')throw Error('invalid native continuation');
   return nativeFetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`,options);
  };
  const result=await runDzenAdapterInPage(page,input,hooks,signal);if(closeError)throw Error('cleanup failed');return result;
 }catch(error){fs.writeFileSync('/tmp/owned-native-fixture-error.txt',(String(error.message)+' '+JSON.stringify(trace)).slice(0,2000));throw error;}finally{signal.removeEventListener('abort',abort);await browser.close();}
});
