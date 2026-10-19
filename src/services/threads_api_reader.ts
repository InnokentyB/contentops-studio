import {ThreadsProviderError} from './threads_provider_error';
const maxBytes=1024*1024;
/** Known-provider GET only, no redirect following and no unbounded JSON body materialization. */
export async function readThreadsApiJson(url:string,token:string,signal:AbortSignal):Promise<unknown>{
    try{
        const response=await fetch(url,{signal,redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
        if(!response.ok){await response.body?.cancel();throw new ThreadsProviderError('THREADS_PROVIDER_REQUEST_FAILED','recovery_read',response.status);}
        const size=Number(response.headers.get('content-length'));
        if(Number.isFinite(size)&&size>maxBytes){await response.body?.cancel();throw new ThreadsProviderError('THREADS_PROVIDER_RESPONSE_TOO_LARGE','recovery_read');}
        if(!response.body)throw new ThreadsProviderError('THREADS_PROVIDER_INVALID_RESPONSE','recovery_read');
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
        try{
            for(;;){
                if(signal.aborted){await reader.cancel();throw new ThreadsProviderError('THREADS_PROVIDER_UNAVAILABLE','recovery_read');}
                const part=await reader.read();if(part.done)break;
                length+=part.value.byteLength;
                if(length>maxBytes){await reader.cancel();throw new ThreadsProviderError('THREADS_PROVIDER_RESPONSE_TOO_LARGE','recovery_read');}
                chunks.push(part.value);
            }
        }finally{reader.releaseLock();}
        try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}
        catch{throw new ThreadsProviderError('THREADS_PROVIDER_INVALID_RESPONSE','recovery_read');}
    }catch(error:unknown){
        if(error instanceof ThreadsProviderError)throw error;
        throw new ThreadsProviderError('THREADS_PROVIDER_UNAVAILABLE','recovery_read');
    }
}
