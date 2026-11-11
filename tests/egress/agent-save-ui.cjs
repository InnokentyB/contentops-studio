const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.AGENT_PLAYWRIGHT_MODULE||'/app/node_modules/playwright');
const source=process.env.AGENT_UI_SOURCE||'/source',results=process.env.AGENT_UI_RESULTS||'/results';
(async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/fonts/')){res.end(fs.readFileSync(source+'/frontend/public'+req.url));return;}
  const file=req.url==='/fixture.js'?'fixture.js':req.url==='/fixture.css'?'fixture.css':null;
  res.setHeader('Content-Type',file?(file.endsWith('.js')?'text/javascript':'text/css'):'text/html; charset=utf-8');
  res.end(file?fs.readFileSync(results+'/'+file):'<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script><link rel="stylesheet" href="/fixture.css"></html>');
 });await new Promise(resolve=>server.listen(8097,'127.0.0.1',resolve));let browser;
 let scenario='not_saved',writes=0;const errors=[];
 try{
  browser=await chromium.launch({executablePath:process.env.X_BROWSER_EXECUTABLE,headless:true,chromiumSandbox:true});const page=await browser.newPage();await page.clock.install();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());if(url.hostname!=='127.0.0.1')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
   if(req.method()==='PUT'){
    writes++;assert.equal(url.pathname,'/api/settings/agents/post_creator');
    if(scenario==='network')return route.abort('failed');
    if(scenario==='success')return route.fulfill({json:{success:true}});
    const fields={prompt:'not_saved',api_key:'not_attempted',model:'not_attempted'};
    if(scenario==='synchronization_pending')fields.prompt='synchronization_pending';
    if(scenario==='partially_saved'){fields.prompt='saved';fields.api_key='saved';fields.model='not_saved';}
    if(scenario==='unknown')fields.prompt='unknown';
    return route.fulfill({status:503,json:{error:'Agent settings save needs attention',code:scenario==='synchronization_pending'?'SETTINGS_SAVED_CACHE_SYNC_PENDING':scenario==='unknown'?'AGENT_SETTINGS_SAVE_UNKNOWN':'SETTINGS_CACHE_SYNC_UNAVAILABLE',save_state:scenario,fields,action:'SYNTHETIC_SERVER_ACTION',details:'PRIVATE_DIAGNOSTIC'}});
   }
   assert.equal(req.method(),'GET');
   const json=url.pathname==='/api/projects/101'?{id:101,channels:[],settings:[],members:[{user_id:202,role:'owner'}]}:url.pathname==='/api/settings/agents'?[{role:'post_creator',prompt:'old prompt',model:'old model',apiKey:''}]:url.pathname.startsWith('/api/settings/model-usage')?{}:[];
   return route.fulfill({json});
  });
  for(const width of [1280,375])for(const lang of ['ru','en'])for(scenario of ['not_saved','synchronization_pending','partially_saved','unknown','network','success']){
   writes=0;await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:8097/?tab=agents&lang='+lang);
   await page.getByText('post_creator',{exact:true}).click();const prompt=page.getByPlaceholder('Enter system instructions for this agent...').first();await prompt.fill('unsaved draft');await page.getByPlaceholder('e.g. gpt-4o').first().fill('new-model');
   await page.getByRole('button',{name:/Save Changes|Сохранить изменения/}).first().click();
   const toast=page.locator('.toast-card').first();await toast.waitFor();await toast.evaluate(el=>el.getAnimations().forEach(animation=>animation.finish()));const copy=await toast.innerText();
   if(scenario==='success')assert.match(copy,/saved successfully|сохранены/i);
   else{
    assert.doesNotMatch(copy,/PRIVATE|SYNTHETIC|saved successfully/);assert.equal(await prompt.inputValue(),'unsaved draft');
    if(scenario==='not_saved')assert.match(copy,lang==='ru'?/не сохранены/:/not saved/i);
    else if(scenario==='synchronization_pending')assert.match(copy,lang==='ru'?/синхронизац/:/synchronization/i);
    else if(scenario==='partially_saved')assert.match(copy,lang==='ru'?/частично/:/partially/i);
    else assert.match(copy,lang==='ru'?/неизвестен/:/unknown/i);
    assert.match(copy,lang==='ru'?/Redis|проверьте/i:/Redis|check/i);
    assert.equal(await toast.getAttribute('role'),'alert');
    await page.clock.fastForward(6000);assert.equal(await toast.isVisible(),true,'recovery guidance must remain until dismissed');
   }
   assert.equal(writes,1,'no automatic replay');
   if(scenario==='partially_saved'&&lang==='ru')await page.screenshot({path:results+'/agent-save-'+width+'.png',fullPage:true,animations:'disabled'});
   if(scenario!=='success'){
    const rect=await toast.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width,'notification fits viewport');
    await toast.getByRole('button',{name:'Dismiss notification'}).click();assert.equal(await toast.count(),0);
   }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,scenarios:24,widths:[1280,375],locales:['ru','en'],editsRetained:true,noAutomaticRetry:true}));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
