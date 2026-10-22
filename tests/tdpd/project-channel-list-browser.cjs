const fs=require('node:fs');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('/app/node_modules/playwright');
const initial=[
 {id:8,type:'telegram',name:'Канал 10'}, {id:5,type:'zen',name:'Бета'},
 {id:3,type:'telegram',name:'альфа'}, {id:6,type:'dzen',name:'Альфа'},
 {id:9,type:'telegram',name:'Канал 2'}, {id:7,type:'custom_provider',name:'Очень длинное название канала для проверки переноса без потери доступности действий'},
].map(channel=>({...channel,is_active:channel.id!==8,config:{}}));
(async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/fonts/material-symbols-outlined.woff2'){res.setHeader('Content-Type','font/woff2');res.end(fs.readFileSync('/source/frontend/public/fonts/material-symbols-outlined.woff2'));return;}
  const file=req.url==='/fixture.js'?'fixture.js':req.url==='/fixture.css'?'fixture.css':null;
  res.setHeader('Content-Type',file?(file.endsWith('.js')?'application/javascript':'text/css'):'text/html; charset=utf-8');
  res.end(file?fs.readFileSync('/results/'+file):'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script><link rel="stylesheet" href="/fixture.css"></html>');
 });
 await new Promise(resolve=>server.listen(8097,'127.0.0.1',resolve));let browser;
 const errors=[],writes=[];let channels=structuredClone(initial);
 try{
  browser=await chromium.launch({executablePath:process.env.X_BROWSER_EXECUTABLE,headless:true,chromiumSandbox:true});
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname!=='127.0.0.1')return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(req.method()==='PUT'){const body=req.postDataJSON();writes.push({path:url.pathname,body});channels=channels.map(c=>url.pathname.endsWith('/'+c.id)?{...c,...body}:c);return route.fulfill({json:{}});}
   assert.equal(req.method(),'GET','view operations must never write');
   return route.fulfill({json:url.pathname==='/api/projects/101'?{id:101,name:'Синтетический проект',channels,settings:[{key:'default_channel_id',value:'9'}],members:[{user_id:202,role:'owner'}]}:[]});
  });
  const names=key=>page.locator(`tbody[data-platform-key="${key}"] td[data-label="Канал"] strong`).allTextContents();
  for(const width of [1280,375]){
   channels=structuredClone(initial);await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:8097/?tab=channels');
   await page.getByRole('heading',{name:'Каналы публикации',exact:true}).waitFor();
   assert.equal(await page.locator('tbody[data-platform-key]').count(),3,'channels must form three platform groups');
   assert.deepEqual(await names('telegram'),['альфа','Канал 2','Канал 10']);assert.deepEqual(await names('dzen'),['Альфа','Бета']);
   const sort=page.getByLabel('Сортировка по каналу');await sort.selectOption('desc');
   assert.deepEqual(await names('telegram'),['Канал 10','Канал 2','альфа']);assert.deepEqual(await names('dzen'),['Бета','Альфа']);
   assert.equal(writes.length,0);assert.equal(await sort.isVisible(),true);
   assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('.channel-list__group th').first().evaluate(el=>el.getBoundingClientRect().width>el.closest('table').getBoundingClientRect().width*0.9),true,'group heading spans table width');
   await page.screenshot({path:`/results/channels-${width}.png`,fullPage:true});
   await sort.selectOption('asc');
   const row=page.locator('tr').filter({has:page.getByText('Канал 2',{exact:true})});await row.getByRole('button',{name:'Изменить',exact:true}).click();
   const editor=page.locator('.channel-table__editor-row');const input=editor.locator('input').first();await input.fill('Изменённый канал');
   await sort.selectOption('desc');assert.equal(await input.inputValue(),'Изменённый канал');
   await editor.getByRole('button',{name:'Save',exact:true}).click();
   await page.getByText('Изменённый канал',{exact:true}).waitFor();assert.equal(writes.at(-1).path,'/api/projects/101/channels/9');
   writes.length=0;
  }
  channels=[];await page.reload();await page.getByText('Каналы пока не подключены.',{exact:true}).waitFor();
  assert.equal(await page.locator('tbody[data-platform-key]').count(),0);
  channels=structuredClone(initial);await page.goto('http://127.0.0.1:8097/?tab=channels&lang=en');
  await page.getByLabel('Sort channels by name').waitFor();assert.equal(await page.locator('tbody[data-platform-key]').count(),3);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,widths:[1280,375],grouping:true,naturalSorting:true,dzenAliases:true,editBinding:true,noSortWrites:true,empty:true,english:true,pageErrors:errors}));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
