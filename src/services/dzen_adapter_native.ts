import {retainOwnedNativeResources,ownedNativeResourceArgument} from './owned_publication_adapter_resources';
import {chromium} from 'playwright';
import {parseBrowserCookieHeader} from './puppeteer/dzen_dom_helpers';
import {runDzenAdapterInPage} from './dzen_adapter_native_page';
import type {OwnedNativeInvocation} from './owned_publication_native_protocol';
import type {OwnedNativeHooks} from './owned_publication_adapter_process';
/** Independent process owns an ephemeral, sandboxed browser and its server-resolved session. */
export async function runDzenAdapterNative(input:OwnedNativeInvocation,secret:{cookies:string},hooks:OwnedNativeHooks,signal:AbortSignal):Promise<unknown>{
    const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:chromium.executablePath(),args:[ownedNativeResourceArgument(input.nonce)],timeout:30000});
    let closeFailed=false;const abort=()=>{void browser.close().catch(()=>{closeFailed=true;});};signal.addEventListener('abort',abort,{once:true});
    try{
        await retainOwnedNativeResources(input.nonce,signal);
        const context=await browser.newContext({serviceWorkers:'block'});
        const cookies=['dzen.ru','.dzen.ru','.yandex.ru'].flatMap(domain=>parseBrowserCookieHeader(secret.cookies,domain));
        if(!cookies.length)throw Error('OWNED_NATIVE_SESSION_UNAVAILABLE');await context.addCookies(cookies);
        const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
        const result=await runDzenAdapterInPage(page,input,hooks,signal);if(closeFailed)throw Error('OWNED_NATIVE_CLEANUP_FAILED');return result;
    }finally{signal.removeEventListener('abort',abort);await browser.close();}
}
