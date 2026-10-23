import type {Prisma} from '@prisma/client';

const secretKey=/(?:token|secret|password|authorization|cookie|session|credential|api[_-]?key|provider_payload)/i;

export function safePreparationValue(value:unknown):Prisma.JsonValue{
    if(value instanceof Date)return value.toISOString();
    if(Array.isArray(value))return value.map(safePreparationValue);
    if(value!==null&&typeof value==='object')return safePreparationBundle(value as Record<string,unknown>);
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    return null;
}

/** Operator handoffs are content packets, never credential transport. Preserve content/asset hashes. */
export function safePreparationBundle(bundle:Record<string,unknown>):Record<string,Prisma.JsonValue>{
    const safe:Record<string,Prisma.JsonValue>={};
    for(const [key,value] of Object.entries(bundle))safe[key]=secretKey.test(key)?'[REDACTED]':safePreparationValue(value);
    return safe;
}

/** Redact stored provider metadata in responses without altering canonical review history. */
export function safePreparationAsset<T extends {provenance:Prisma.JsonValue;qa_report:Prisma.JsonValue}>(asset:T){
    return {...asset,provenance:safePreparationValue(asset.provenance),qa_report:safePreparationValue(asset.qa_report)};
}
