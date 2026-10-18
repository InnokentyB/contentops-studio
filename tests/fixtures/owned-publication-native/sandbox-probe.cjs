const {chromium}=require('playwright');
(async()=>{
 let browser;
 try{
  browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'/opt/playwright/chromium-1243/chrome-linux64/chrome'});
  const page=await browser.newPage();await page.goto('chrome://sandbox');const text=await page.textContent('body');console.log(JSON.stringify({sandboxPage:text.slice(0,3000),status:require('node:fs').readFileSync('/proc/self/status','utf8').split('\n').filter(line=>/^(CapEff|CapBnd|NoNewPrivs|Seccomp):/.test(line))}));
  if(!/Layer 1 SandboxNamespace/.test(text)||!/PID namespacesYes/.test(text)||!/Network namespacesYes/.test(text)||!/Seccomp-BPF sandboxYes/.test(text))throw Error('SANDBOX_STATUS_NOT_VERIFIED');
  console.log(JSON.stringify({sandbox:true,chromium:browser.version(),uid:process.getuid(),pid:process.pid}));
 }catch(error){console.error(error.message.includes('No usable sandbox')?'NO_USABLE_SANDBOX':error.message.slice(-5000));process.exitCode=1;}
 finally{if(browser)await browser.close();}
})();
