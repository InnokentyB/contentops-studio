const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {verifyTerminalReadSource:verify}=require(path.join(process.env.SHARED_BROWSER_DIST||'/opt/planner/dist','services/browser_terminal_source_semantics.js'));
const browser='synthetic',profile='https://www.linkedin.com/company/synthetic/admin/page-posts/published/';
const valid='var b=await cua.getBrowser("synthetic"); var t=await b.createBrowserTab("'+profile+'"); await t.getAXState();';
test('AST accepts only an awaited profile read without executing the source',()=>{assert.equal(verify(JSON.stringify({code:valid}),browser,profile),undefined)});
test('AST rejects detached callbacks, dynamic effects and unknown receiver provenance',()=>{
 for(const code of ['await unknown.getAXState();',valid+' setTimeout(()=>t.click(1),0);',valid+' await t.evaluate(()=>document.forms[0].submit());',valid+' await t.playwright.getByRole("button",{name:"Post"}).click();'])assert.throws(()=>verify(JSON.stringify({code}),browser,profile),/TERMINAL_/);
});
test('sequential original calls preserve verified tab provenance and allow only read navigation',()=>{
 const {createTerminalReadVerifier}=require(path.join(process.env.SHARED_BROWSER_DIST||'/opt/planner/dist','services/browser_terminal_source_semantics.js'));
 const check=createTerminalReadVerifier(browser,profile);
 check(JSON.stringify({code:'var t=await cua.createBrowserTab("synthetic","'+profile+'",{sessionName:"readonly"});'}));
 check(JSON.stringify({code:'await t.playwright.domSnapshot();'}));
 check(JSON.stringify({code:'await t.playwright.getByRole("tab",{name:"Posts",exact:true}).click(); await t.playwright.domSnapshot();'}));
 for(const code of ['await t.playwright.getByRole("button",{name:"Post",exact:true}).click();','await t.playwright.getByRole("tab",{name:unknown,exact:true}).click();','await foreign.playwright.domSnapshot();'])assert.throws(()=>check(JSON.stringify({code})),/TERMINAL_/);
});
test('historical read documents on another supported public provider are scoped separately from target',()=>{
 const {createTerminalReadVerifier}=require(path.join(process.env.SHARED_BROWSER_DIST||'/opt/planner/dist','services/browser_terminal_source_semantics.js'));
 const check=createTerminalReadVerifier(browser,profile);
 check(JSON.stringify({code:'var unrelated=await cua.createBrowserTab("synthetic","https://x.com/synthetic_profile",{sessionName:"other-read"}); await unrelated.playwright.domSnapshot();'}));
 check(JSON.stringify({code:'var target=await cua.createBrowserTab("synthetic","'+profile+'",{sessionName:"target-read"});'}));
 for(const url of ['https://evil.invalid/profile','https://x.com/intent/post','https://x.com/synthetic_profile?redirect=anything','http://x.com/synthetic_profile'])
  assert.throws(()=>check(JSON.stringify({code:'var bad=await cua.createBrowserTab("synthetic","'+url+'",{sessionName:"deny"});'})),/TERMINAL_/);
});
test('AST rejects syntactically incomplete source instead of accepting parser recovery',()=>{assert.throws(()=>verify(JSON.stringify({code:valid+' var incomplete = ;'}),browser,profile),/TERMINAL_/)});
test('AST binds original browser and profile rather than accepting lookalike reads',()=>{assert.throws(()=>verify(JSON.stringify({code:valid}),browser+'-foreign',profile),/TERMINAL_/);assert.throws(()=>verify(JSON.stringify({code:valid}),browser,profile+'foreign'),/TERMINAL_/)});
test('AST supports the independently observed global CUA createBrowserTab shape',()=>{
 const code='var tab=await cua.createBrowserTab("synthetic","'+profile+'",{sessionName:"synthetic-read"}); await tab.getAXState();';
 assert.equal(verify(JSON.stringify({code}),browser,profile),undefined);
 for(const altered of [code.replace('"synthetic",','"foreign",'),code.replace('sessionName:', 'unknownOption:'),code.replace('"synthetic-read"','(()=>{return "hidden"})()'),code+' await tab.click(1);'])
  assert.throws(()=>verify(JSON.stringify({code:altered}),browser,profile),/TERMINAL_/);
});
