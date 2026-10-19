import type {Page,Response,Request} from 'playwright';
import type {OwnedPublicationClaim,OwnedPublicationPackage,OwnedPublicationInventory} from './owned_publication_contract';
import type {OwnedNativeHooks} from './owned_publication_adapter_process';
import type {OwnedNativeInvocation} from './owned_publication_native_protocol';
import {ownedObject} from './owned_publication_contract';
import {dzenNativeCover,dzenNativeHash,dzenNativeUncertain,verifyDzenNativePrimary,verifyDzenNativeReceipt,type DzenNativePrimary} from './dzen_adapter_proof';

const selectors={add:'[data-testid="add-publication-button"]',article:'[role="button"][aria-label="Написать статью"]',
    title:'[contenteditable="true"][role="textbox"]:has(h1[data-block="true"])',body:'[contenteditable="true"][role="textbox"]:has(.zen-editor-block)',
    openPublishDialog:'[data-testid="article-publish-btn"]',confirm:'[data-testid="publish-btn"]',upload:'input[type="file"][accept*="image"]'};
const safeId=(value:string)=>/^[A-Za-z0-9_-]{1,200}$/.test(value);
const origin='https://dzen.ru';
export interface DzenNativePhase{value:'inventory'|'editing'|'verification'|'submitting'|'readback';objectId?:string;requests:number;submitRequests:number;createRequests:number;deadline:number;failed:boolean}
/** Fixed protocol routes only; business identity is validated package data. */
export function dzenAdapterRequest(method:string,input:string,pkg:OwnedPublicationPackage,phase:DzenNativePhase):boolean{
    let u:URL;try{u=new URL(input);}catch{return false;}
    if(u.protocol!=='https:'||u.username||u.password||u.port||!safeId(pkg.accountId))return false;
    if(['GET','HEAD','OPTIONS'].includes(method)){
        if(input===pkg.assetUrl)return ['supabase.co','r2.dev'].some(host=>u.hostname.endsWith(`.${host}`));
        if(u.hostname==='yastatic.net'||u.hostname.endsWith('.yastatic.net'))return true;
        if(u.hostname==='avatars.dzeninfra.ru')return /^\/get-zen_doc\/[A-Za-z0-9_/-]+$/.test(u.pathname);
        if(u.origin!==origin)return false;
        if(u.searchParams.has('publisherId')&&u.searchParams.get('publisherId')!==pkg.accountId)return false;
        const studio=`/profile/editor/id/${pkg.accountId}`;
        if(u.pathname==='/favicon.ico')return true;
        if(u.pathname===`${studio}/publications`||u.pathname===`/editor-api/v3/publishers/${pkg.accountId}`||u.pathname==='/editor-api/v3/publications')return true;
        if(phase.objectId)return u.pathname===`${studio}/${phase.objectId}/edit`||u.pathname===`/editor-api/v2/publisher/${pkg.accountId}/publication/${phase.objectId}`;
        return false;
    }
    if(u.origin!==origin||!['POST','PUT','PATCH'].includes(method))return false;
    const base=`/editor-api/v2/publisher/${pkg.accountId}/publication`;
    if(phase.value==='editing'&&u.pathname===base)return method==='POST'&&!phase.objectId&&phase.createRequests===0;
    if(phase.value==='editing'&&u.pathname==='/editor-api/v2/add-image'&&method==='POST'&&phase.objectId)return !u.searchParams.has('object')||u.searchParams.get('object')===phase.objectId;
    if(!phase.objectId)return false;
    return phase.value==='editing'&&u.pathname===`${base}/${phase.objectId}`
        ||phase.value==='submitting'&&method==='POST'&&phase.submitRequests===0&&u.pathname===`${base}/${phase.objectId}/publish`;
}

/** Bounded browser-owned streaming; no redirects, response payloads or headers escape this process. */
async function read(page:Page,url:string,binary=false):Promise<unknown>{
    const result=await page.evaluate(async input=>{
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
        try{
            const response=await fetch(input.url,{method:'GET',credentials:'same-origin',redirect:'error',signal:controller.signal});
            if(response.status!==200||!response.body)return null;
            const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
            try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>2000000)return null;parts.push(chunk.value);}}
            finally{await reader.cancel();}
            const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
            return input.binary?Array.from(bytes):new TextDecoder().decode(bytes);
        }finally{clearTimeout(timer);}
    },{url,binary});
    if(binary&&Array.isArray(result))return Uint8Array.from(result);
    if(typeof result!=='string')return dzenNativeUncertain();try{return JSON.parse(result) as unknown;}catch{return dzenNativeUncertain();}
}
async function identity(page:Page,p:OwnedPublicationPackage,write:boolean):Promise<void>{
    await page.goto(`${origin}/profile/editor/id/${p.accountId}/publications`,{waitUntil:'domcontentloaded',timeout:30000});
    if(new URL(page.url()).pathname!==`/profile/editor/id/${p.accountId}/publications`)return dzenNativeUncertain();
    const root=ownedObject(await read(page,`${origin}/editor-api/v3/publishers/${p.accountId}`));
    if(ownedObject(root.publisher).id!==p.accountId||ownedObject(root.accessData)[write?'canWrite':'canRead']!==true)return dzenNativeUncertain();
}
async function inventory(page:Page,p:OwnedPublicationPackage,workDeadline:number):Promise<OwnedPublicationInventory>{
    const deadline=Math.min(Date.now()+60000,workDeadline);let pages=0,objects=0,absent=true;
    for(const state of ['published','draft']){
        let cursor='';const seen=new Set<string>();
        while(true){
            if(++pages>50||Date.now()>deadline)return dzenNativeUncertain();
            const query=new URLSearchParams({publisherId:p.accountId,state,pageSize:'200',...(cursor?{cursor}:{})});
            const root=ownedObject(await read(page,`${origin}/editor-api/v3/publications?${query}`));
            if(!Array.isArray(root.publications)||typeof root.hasMore!=='boolean')return dzenNativeUncertain();
            objects+=root.publications.length;if(objects>10000)return dzenNativeUncertain();
            for(const value of root.publications){const row=ownedObject(value);
                if(typeof row.id!=='string'||!safeId(row.id)||row.publisherId!==p.accountId||typeof row.title!=='string'
                    ||typeof row.bodySha256!=='string'||!/^([a-f0-9]{64})$/.test(row.bodySha256)
                    ||row.status!==state||row.isPublished!==(state==='published'))return dzenNativeUncertain();
                if(row.title===p.title||row.bodySha256===p.bodySha256)absent=false;
            }
            if(!root.hasMore)break;
            if(typeof root.nextCursor!=='string'||!root.nextCursor||root.nextCursor.length>1000||seen.has(root.nextCursor))return dzenNativeUncertain();
            seen.add(root.nextCursor);cursor=root.nextCursor;
        }
    }
    return {complete:true,absent,accountId:p.accountId,packageDigest:p.digest,checkedAt:new Date().toISOString()};
}
async function primary(page:Page,p:OwnedPublicationPackage,objectId:string):Promise<DzenNativePrimary>{
    if(!safeId(objectId))return dzenNativeUncertain();const path=`/profile/editor/id/${p.accountId}/${objectId}/edit`;
    if(new URL(page.url()).pathname!==path)await page.goto(`${origin}${path}`,{waitUntil:'domcontentloaded',timeout:30000});
    if(new URL(page.url()).pathname!==path)return dzenNativeUncertain();
    const root=ownedObject(await read(page,`${origin}/editor-api/v2/publisher/${p.accountId}/publication/${objectId}`));
    if(!Array.isArray(root.publications)||root.publications.length!==1)return dzenNativeUncertain();
    const row=ownedObject(root.publications[0]),image=ownedObject(ownedObject(ownedObject(row.content).preview).image),original=ownedObject(ownedObject(image.sizes).orig);
    if(row.id!==objectId||row.publisherId!==p.accountId||typeof image.id!=='string'||typeof original.url!=='string')return dzenNativeUncertain();
    const title=page.locator(selectors.title),body=page.locator(selectors.body);
    if(await title.count()!==1||await body.count()!==1)return dzenNativeUncertain();
    return {objectId,accountId:p.accountId,title:await title.innerText(),body:await body.innerText(),imageId:image.id,imageUrl:original.url};
}
async function verifiedPrimary(page:Page,claim:OwnedPublicationClaim,objectId:string){
    const observed=await primary(page,claim.package,objectId),bytes=await read(page,dzenNativeCover(observed),true);
    if(!(bytes instanceof Uint8Array))return dzenNativeUncertain();verifyDzenNativePrimary(claim,observed,bytes,objectId);return {observed,bytes};
}
async function publishedRow(page:Page,p:OwnedPublicationPackage,objectId:string):Promise<unknown>{
    const query=new URLSearchParams({publisherId:p.accountId,state:'published',pageSize:'200'}),root=ownedObject(await read(page,`${origin}/editor-api/v3/publications?${query}`));
    if(!Array.isArray(root.publications)||root.publications.length>200)return dzenNativeUncertain();
    const matches=root.publications.map(ownedObject).filter(row=>row.id===objectId);if(matches.length!==1)return dzenNativeUncertain();
    const r=matches[0];return {id:r.id,publisherId:r.publisherId,title:r.title,isPublished:r.isPublished,status:r.status,publishTime:r.publishTime,commonUrl:r.commonUrl};
}
function finalReady(node:Element):boolean{
    const ready=(e:Element):boolean=>e instanceof HTMLButtonElement&&e.isConnected&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'
        &&/^(опубликовать|publish)$/i.test(e.innerText.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0
        &&getComputedStyle(e).visibility!=='hidden'&&Boolean(e.closest('[role="dialog"], [aria-modal="true"]'));
    const matches=Array.from(document.querySelectorAll('[data-testid="publish-btn"]')).filter(ready);return ready(node)&&matches.length===1&&matches[0]===node;
}
async function openNativeFinalButton(page:Page){
    await page.locator(selectors.openPublishDialog).click();await page.locator(selectors.confirm).waitFor({state:'visible',timeout:15000});
    const handles=await page.locator(selectors.confirm).elementHandles(),matches=[];
    for(const handle of handles)if(await handle.evaluate(finalReady))matches.push(handle);
    if(matches.length!==1)return dzenNativeUncertain();return matches[0];
}
/** Continue only the already intercepted native UI request; no retries or redirects. */
async function nativeUiResponse(request:Request,expected:string,deadline:number,signal:AbortSignal):Promise<Buffer>{
    if(request.url()!==expected||request.method()!=='POST')return dzenNativeUncertain();
    const body=request.postDataBuffer();if(body&&body.length>65536)return dzenNativeUncertain();
    const original=await request.allHeaders(),headers:Record<string,string>={};
    for(const name of ['cookie','content-type'])if(original[name])headers[name]=original[name];
    const remaining=Math.min(15000,deadline-Date.now());if(remaining<=0||signal.aborted)return dzenNativeUncertain();
    const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,remaining);let response:globalThis.Response|undefined;
    try{
        const requestBody=body?Uint8Array.from(body).buffer:undefined;
        response=await fetch(expected,{method:'POST',headers,body:requestBody,redirect:'error',signal:controller.signal});
        if(response.status!==200||!response.body)return dzenNativeUncertain();
        const declared=response.headers.get('content-length');
        if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>2000000))return dzenNativeUncertain();
        const reader=response.body.getReader(),parts:Buffer[]=[];let size=0;
        try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>2000000)return dzenNativeUncertain();parts.push(Buffer.from(chunk.value));}}
        finally{await reader.cancel();reader.releaseLock();}
        return Buffer.concat(parts,size);
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);if(response?.body&&!response.body.locked)await response.body.cancel();}
}
async function nativeResponseJson(response:Response):Promise<unknown>{
    const headers=response.headers(),length=Number(headers['content-length']);
    if(response.status()!==200||(headers['content-encoding']&&headers['content-encoding']!=='identity')||!Number.isSafeInteger(length)||length<1||length>2000000)return dzenNativeUncertain();
    const bytes=await response.body();if(bytes.length>length)return dzenNativeUncertain();return JSON.parse(bytes.toString('utf8')) as unknown;
}
/** Reusable Dzen protocol execution; test roots supply only an isolated real Page, never production flags. */
export async function runDzenAdapterInPage(page:Page,input:OwnedNativeInvocation,hooks:OwnedNativeHooks,signal:AbortSignal):Promise<unknown>{
    const p=input.package;if(signal.aborted||Date.now()>=input.deadline)return dzenNativeUncertain();if(!safeId(p.accountId))return dzenNativeUncertain();
    const phase:DzenNativePhase={value:input.operation==='readback'?'readback':'inventory',requests:0,submitRequests:0,createRequests:0,deadline:Math.min(Date.now()+180000,input.deadline),failed:false,
        ...(input.operation==='readback'&&input.claim?.nativeObjectId?{objectId:input.claim.nativeObjectId}:{})};
    const editingWrites=new Set<Request>();
    page.context().on('requestfinished',request=>editingWrites.delete(request));
    page.context().on('requestfailed',request=>{if(editingWrites.has(request))phase.failed=true;});
    page.context().on('response',response=>{if(editingWrites.has(response.request())&&!response.ok())phase.failed=true;});
    await page.context().route('**/*',async route=>{
        phase.requests++;if(phase.failed||phase.requests>500||Date.now()>phase.deadline||signal.aborted||!dzenAdapterRequest(route.request().method(),route.request().url(),p,phase)){
            phase.failed=true;await route.abort();return;
        }
        const request=route.request();
        if(phase.value==='editing'&&['POST','PUT','PATCH'].includes(request.method()))editingWrites.add(request);
        const path=new URL(request.url()).pathname,base=`/editor-api/v2/publisher/${p.accountId}/publication`;
        if(request.method()==='POST'&&(path===base||path===`${base}/${phase.objectId}/publish`)){
            const creating=path===base;
            if(creating)phase.createRequests++;else phase.submitRequests++;
            // Consume the single permit before any network continuation.
            try{
                const bytes=await nativeUiResponse(request,`${origin}${path}`,phase.deadline,signal);
                const root=ownedObject(JSON.parse(bytes.toString('utf8')) as unknown);
                if(creating){
                    if(typeof root.id!=='string'||!safeId(root.id)||root.publisherId!==p.accountId)throw Error('OWNED_NATIVE_BINDING_INVALID');
                    phase.objectId=root.id;
                }
                await route.fulfill({status:200,contentType:'application/json',body:bytes});
            }catch{phase.failed=true;await route.abort();}
            return;
        }
        await route.fallback();
    });
    await identity(page,p,input.operation==='publish');
    if(input.operation==='inventory'){const result=await inventory(page,p,input.deadline);if(phase.failed||signal.aborted||Date.now()>=phase.deadline)return dzenNativeUncertain();return result;}
    const claim=input.claim;if(!claim||claim.package.digest!==p.digest)return dzenNativeUncertain();
    if(input.operation==='readback'){
        const objectId=claim.nativeObjectId;if(!objectId)return null;
        const row=await publishedRow(page,p,objectId),proof=await verifiedPrimary(page,claim,objectId);
        if(phase.failed||signal.aborted||Date.now()>=phase.deadline)return dzenNativeUncertain();
        return verifyDzenNativeReceipt(claim,{id:objectId,publisherId:p.accountId},row,proof.observed,proof.bytes,new Date().toISOString());
    }
    const asset=await read(page,p.assetUrl,true);if(!(asset instanceof Uint8Array)||dzenNativeHash(asset)!==p.assetSha256)return dzenNativeUncertain();
    if(phase.failed||signal.aborted||Date.now()>=phase.deadline)return dzenNativeUncertain();await hooks.beforeMutation();phase.value='editing';
    await page.locator(selectors.add).click();await page.locator(selectors.article).click();
    const bindingDeadline=Math.min(Date.now()+15000,phase.deadline);
    while(!phase.objectId&&!phase.failed&&!signal.aborted&&Date.now()<bindingDeadline)await new Promise(resolve=>setTimeout(resolve,5));
    if(!phase.objectId||phase.failed)return dzenNativeUncertain();const objectId=phase.objectId;
    await page.waitForURL(`${origin}/profile/editor/id/${p.accountId}/${objectId}/edit`,{timeout:15000});
    if(phase.failed)return dzenNativeUncertain();
    const title=page.locator(selectors.title),body=page.locator(selectors.body);
    if(await title.count()!==1||await body.count()!==1||await title.innerText()!==''||await body.innerText()!=='')return dzenNativeUncertain();
    await title.fill(p.title);await body.fill(p.body);
    const upload=page.waitForResponse(r=>new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/editor-api/v2/add-image'&&r.request().method()==='POST',{timeout:30000}).then(r=>r.status(),()=>null);
    await page.locator(selectors.upload).setInputFiles({name:'approved-cover.png',mimeType:'image/png',buffer:Buffer.from(asset)});
    if(await upload!==200)return dzenNativeUncertain();await verifiedPrimary(page,claim,objectId);
    await openNativeFinalButton(page);await verifiedPrimary(page,claim,objectId);
    if(phase.failed||signal.aborted||Date.now()>=phase.deadline)return dzenNativeUncertain();
    await hooks.beforeSubmit({objectId,accountId:p.accountId});
    phase.value='verification'; // ACK is not a network permit: every write remains blocked during fresh proof.
    const drainDeadline=Math.min(Date.now()+15000,phase.deadline);
    while(editingWrites.size&&!phase.failed&&!signal.aborted&&Date.now()<drainDeadline)await new Promise(resolve=>setTimeout(resolve,5));
    if(editingWrites.size||phase.failed||signal.aborted||Date.now()>=phase.deadline)return dzenNativeUncertain();
    await page.reload({waitUntil:'domcontentloaded',timeout:Math.max(1,Math.min(30000,phase.deadline-Date.now()))});
    await verifiedPrimary(page,claim,objectId);
    const final=await openNativeFinalButton(page);
    if(!(await final.evaluate(finalReady))||phase.failed||signal.aborted||Date.now()>=phase.deadline)return dzenNativeUncertain();
    const endpoint=`${origin}/editor-api/v2/publisher/${p.accountId}/publication/${objectId}/publish`;
    const pending=page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='POST',{timeout:30000}).then(nativeResponseJson).then(root=>ownedObject(root).publication).catch(()=>null);
    phase.value='submitting';await final.click();const submit=await pending;if(!submit||phase.failed)return dzenNativeUncertain();
    await page.reload({waitUntil:'domcontentloaded',timeout:Math.max(1,Math.min(30000,phase.deadline-Date.now()))});
    const row=await publishedRow(page,p,objectId),proof=await verifiedPrimary(page,claim,objectId);
    if(phase.failed)return dzenNativeUncertain();return verifyDzenNativeReceipt(claim,submit,row,proof.observed,proof.bytes,new Date().toISOString());
}
