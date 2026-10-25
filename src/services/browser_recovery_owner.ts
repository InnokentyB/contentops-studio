import {requireBrowserOwner,type BrowserDb} from './browser_publication_contract';
/** Protected recovery requires a real current Owner, including private resumed-generation operations. */
export async function requireNonDemoBrowserOwner(tx:BrowserDb,args:{projectId:number;actorId:string}):Promise<void>{
 await requireBrowserOwner(tx,args);
 const user=await tx.user.findUnique({where:{id:Number(args.actorId.slice(5))},select:{is_demo:true}});
 if(!user||user.is_demo)throw new Error('[OWNER_REQUIRED]');
}
