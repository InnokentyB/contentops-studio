import {ownedTransaction} from './owned_publication_invocation';
import {join,dirname} from 'path';
import type {OwnedPublicationAdapter,OwnedPublicationPackage,OwnedPublicationClaim,OwnedPublicationInventory,OwnedPublicationReceipt,OwnedPublicationBudget} from './owned_publication_contract';
import {ownedReceiptSchema} from './owned_publication_contract';
import {requireDzenAdapterAction} from './dzen_adapter_restriction';
import {invokeOwnedPublicationProcess,type OwnedNativeHooks} from './owned_publication_adapter_process';
import {nativeInventorySchema} from './owned_publication_native_protocol';

function checkBudget(budget?:OwnedPublicationBudget):void{if(budget&&(budget.signal.aborted||Date.now()>=budget.deadline))throw Error('OWNED_NATIVE_CANCELLED');}
async function session(pkg:OwnedPublicationPackage,budget?:OwnedPublicationBudget):Promise<{cookies:string}>{
    const {default:db}=await import('../db');const{resolveEffectiveChannelConfig}=await import('../utils/channel.utils');
    checkBudget(budget);const remaining=Math.max(1,Math.min(10000,(budget?.deadline??Date.now()+10000)-Date.now()));
    const channel=await ownedTransaction(db,async tx=>{checkBudget(budget);const row=await tx.socialChannel.findFirst({where:{id:pkg.channelId,project_id:pkg.projectId,is_active:true}});checkBudget(budget);return row;},{timeout:remaining,maxWait:remaining});
    if(!channel||!['dzen','zen','zen_article'].includes(channel.type))throw Error('OWNED_NATIVE_SESSION_UNAVAILABLE');
    const config:unknown=resolveEffectiveChannelConfig(channel.type,channel.config);
    if(!config||typeof config!=='object'||!('cookies'in config)||typeof config.cookies!=='string'
        ||!('channel_id'in config)||config.channel_id!==pkg.accountId)throw Error('OWNED_NATIVE_SESSION_UNAVAILABLE');
    return {cookies:config.cookies};
}
/** Registry entry is server-owned and fixed. It is identity, never an action permit or session proof. */
export function createProductionOwnedPublicationAdapter():OwnedPublicationAdapter&{registration:{provider:'dzen';transport:'independent_process'}}{
    const registration={provider:'dzen' as const,transport:'independent_process' as const};
    const authorize=async(operation:Parameters<OwnedPublicationAdapter['authorize']>[0],budget?:OwnedPublicationBudget)=>{checkBudget(budget);requireDzenAdapterAction(operation);};
    const invoke=async(operation:'inventory'|'publish'|'readback',pkg:OwnedPublicationPackage,claim?:OwnedPublicationClaim,hooks?:OwnedNativeHooks,budget?:OwnedPublicationBudget)=>{
        await authorize(operation==='publish'?'mutation':operation,budget);if(operation==='publish')await authorize('readback',budget);
        try{
            const modulePath=dirname(dirname(require.resolve('playwright/package.json')));
            const {chromium}=await import('playwright');const browserPath=dirname(dirname(dirname(chromium.executablePath())));
            return await invokeOwnedPublicationProcess({executable:join(__dirname,'owned_publication_native_child.js'),modulePath,browserPath},
                {operation,package:pkg,claim},await session(pkg,budget),hooks??{beforeMutation:async()=>{throw Error('OWNED_NATIVE_PHASE_INVALID');},beforeSubmit:async()=>{throw Error('OWNED_NATIVE_PHASE_INVALID');}},budget?.signal,budget?.deadline);
        }catch{throw Error('OWNED_NATIVE_UNCERTAIN');}
    };
    return {registration,authorize,
        inventory:async(pkg,budget)=>nativeInventorySchema.parse(await invoke('inventory',pkg,undefined,undefined,budget)),
        publish:async(claim,hooks,budget)=>ownedReceiptSchema.parse(await invoke('publish',claim.package,claim,{
            beforeMutation:async()=>{await authorize('mutation',budget);await hooks.beforeMutation();},
            beforeSubmit:async observation=>{await authorize('submit',budget);await hooks.beforeSubmit(observation);}},budget)),
        readback:async(claim,budget)=>{if(!claim.nativeObjectId){await authorize('readback',budget);return null;}
            const value=await invoke('readback',claim.package,claim,undefined,budget);return value===null?null:ownedReceiptSchema.parse(value);}
    };
}
