import * as fs from 'fs';
import * as path from 'path';
import { publisherLogDiagnostic } from './publisher_log_diagnostics';
const LOGS_DIR=path.join(__dirname,'../../../logs');
const PUBLISHER_LOG_FILE=path.join(LOGS_DIR,'publisher.log');
function writeFailure():void {
 console.error(JSON.stringify({event:'publisher_log',level:'ERROR',code:'PUBLISHER_LOG_WRITE_FAILED',
  message:'The publisher diagnostic file could not be written.',
  action:'Ask the administrator to inspect log storage permissions and capacity. Console diagnostics remain available; reconcile existing attempts before further execution.',retry_allowed:false}));
}
/** Append one reviewed structured envelope to both existing sinks. Raw messages/data are classification inputs only. */
export function logToFile(level:'INFO'|'WARN'|'ERROR',message:string,data?:unknown):void {
 const envelope={timestamp:new Date().toISOString(),event:'publisher_log',level,...publisherLogDiagnostic(message,data)};
 const line=JSON.stringify(envelope);
 fs.promises.mkdir(LOGS_DIR,{recursive:true}).then(()=>fs.promises.appendFile(PUBLISHER_LOG_FILE,line+'\n')).catch(writeFailure);
 if(level==='ERROR')console.error(line);
 else if(level==='WARN')console.warn(line);
 else console.log(line);
}
