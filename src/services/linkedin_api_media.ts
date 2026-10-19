import {inspectVisualBinary} from './visual_asset_binding.service';

type Asset = {project_id:number;content_item_id:number;id:number;file_url:string|null;provenance:unknown};
type Scope = {projectId:number;taskId:number;assetId:number;sha256:string};
const MAX_BYTES=10*1024*1024;
const mimeExtensions:Readonly<Record<string,string>>={'image/png':'png','image/jpeg':'jpg','image/gif':'gif'};
function object(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function invalid():Error{return new Error('[LINKEDIN_API_MEDIA_INVALID] The accepted managed image could not be verified. Repair its canonical storage binding and accepted asset before another release.');}
function publicBase(value:string|undefined):string{
    if(!value)throw invalid();
    const url=new URL(value);
    const host=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash
        ||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')
        ||/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
        ||host.includes(':'))throw invalid();
    return url.href.replace(/\/+$/,'');
}
function binding(asset:Asset,scope:Scope):{url:string;storage:Record<string,unknown>}{
    if(![scope.projectId,scope.taskId,scope.assetId].every(v=>Number.isSafeInteger(v)&&v>0)
        ||asset.project_id!==scope.projectId||asset.content_item_id!==scope.taskId||asset.id!==scope.assetId
        ||!/^[a-f0-9]{64}$/.test(scope.sha256))throw invalid();
    const storage=object(object(asset.provenance).planner_storage);
    const extension=mimeExtensions[String(storage.mime_type)];
    if(storage.managed!==true||storage.sha256!==scope.sha256||!extension
        ||!Number.isSafeInteger(storage.byte_size)||Number(storage.byte_size)<1||Number(storage.byte_size)>MAX_BYTES)throw invalid();
    const key=`visual-sources/project-${scope.projectId}/content-${scope.taskId}/${scope.sha256}.${extension}`;
    if(storage.object_key!==key)throw invalid();
    let base:string;
    if(storage.provider==='supabase')base=publicBase(process.env.SUPABASE_URL)+'/storage/v1/object/public/post-images';
    else if(storage.provider==='r2')base=publicBase(process.env.R2_PUBLIC_BASE_URL);
    else throw invalid();
    const expected=base+'/'+key;
    if(asset.file_url!==expected)throw invalid();
    return {url:expected,storage};
}
async function boundedBytes(response:Response,signal:AbortSignal):Promise<Buffer>{
    const size=response.headers.get('content-length');
    if(size!==null&&(!/^\d+$/.test(size)||Number(size)>MAX_BYTES))throw invalid();
    if(!response.body)throw invalid();
    const reader=response.body.getReader();const chunks:Buffer[]=[];let length=0;
    try{
        while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>MAX_BYTES)throw invalid();chunks.push(Buffer.from(part.value));}
        if(size!==null&&length!==Number(size))throw invalid();
        return Buffer.concat(chunks,length);
    }finally{try{await reader.cancel();}finally{reader.releaseLock();}}
}
/** Only accepted tenant-managed storage records can supply public LinkedIn image bytes. */
export async function resolveLinkedInApiMedia(asset:Asset,scope:Scope,signal:AbortSignal):Promise<Buffer>{
    try{
        const source=binding(asset,scope);const bounded=AbortSignal.any([signal,AbortSignal.timeout(20_000)]);
        bounded.throwIfAborted();
        const response=await fetch(source.url,{method:'GET',redirect:'error',signal:bounded});
        if(!response.ok||response.redirected)throw invalid();
        const bytes=await boundedBytes(response,bounded);const metadata=inspectVisualBinary(bytes,String(source.storage.mime_type));
        if(metadata.sha256!==scope.sha256||metadata.byte_size!==source.storage.byte_size
            ||metadata.width!==source.storage.width||metadata.height!==source.storage.height
            ||!metadata.width||!metadata.height||metadata.width*metadata.height>36_000_000)throw invalid();
        const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if(mime&&mime!==metadata.mime_type)throw invalid();
        bounded.throwIfAborted();return bytes;
    }catch{throw invalid();}
}
