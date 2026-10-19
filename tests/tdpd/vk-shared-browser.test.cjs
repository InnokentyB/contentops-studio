const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const modulePath='../../dist/services/browser_launch.js';
test('BR-01 shared browser options enforce sandbox without weakening caller protections',()=>{
 const {sandboxedChromiumLaunchOptions}=require(modulePath);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'browser-options-'));const executablePath=path.join(dir,'browser');
 try{fs.writeFileSync(executablePath,'fixture',{mode:0o755});fs.chmodSync(executablePath,0o755);
 const opts=sandboxedChromiumLaunchOptions({headless:true,executablePath});
 assert.equal(opts.chromiumSandbox,true);assert.equal(opts.headless,true);assert.equal(opts.timeout,30000);
 assert.equal(opts.executablePath,executablePath);assert.equal(opts.args,undefined);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('BR-02 unsafe executable and unbounded launch deadlines fail before browser starts',()=>{
 const {sandboxedChromiumLaunchOptions}=require(modulePath);
 for(const executablePath of ['relative/chrome','/missing/browser'])assert.throws(()=>sandboxedChromiumLaunchOptions({headless:true,executablePath}));
 for(const timeout of [0,-1,30001,Infinity,1.5])assert.throws(()=>sandboxedChromiumLaunchOptions({headless:true,timeout}));
});
test('BR-03 shared launch works on a synthetic local page with namespace and seccomp sandbox',async()=>{
 const {sandboxedChromiumLaunchOptions}=require(modulePath);
 const {chromium}=require('playwright');
 const browser=await chromium.launch(sandboxedChromiumLaunchOptions({headless:true,executablePath:process.env.APP_BROWSER_EXECUTABLE_PATH}));
 try{const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent('<title>adapter-fixture</title><button>Ready</button>');assert.equal(await page.title(),'adapter-fixture');
 await page.goto('chrome://sandbox');const status=await page.locator('body').innerText();assert.match(status,/Seccomp-BPF sandbox\s+Yes/i);assert.match(status,/(Namespace sandbox|PID namespaces)\s+Yes/i);
 }finally{await browser.close();}
});

test('BR-04 symlink and writable executables are rejected before launch',()=>{
 const {sandboxedChromiumLaunchOptions}=require(modulePath);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'browser-path-'));
 try{const target=path.join(dir,'browser');fs.writeFileSync(target,'fixture',{mode:0o777});fs.chmodSync(target,0o777);assert.throws(()=>sandboxedChromiumLaunchOptions({headless:true,executablePath:target}));
 fs.chmodSync(target,0o755);const link=path.join(dir,'link');fs.symlinkSync(target,link);assert.throws(()=>sandboxedChromiumLaunchOptions({headless:true,executablePath:link}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
