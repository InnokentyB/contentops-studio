/** Disposable tower-linux PostgreSQL acceptance runner. Mac Docker is never used. */
const {spawnSync,spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {resolve}=require('node:path');
const net=require('node:net');
const root=resolve(__dirname,'../..');
const name=`dzen1002-store-${randomUUID()}`;
function run(cmd,args,env=process.env){const r=spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',timeout:60000});if(r.status!==0)throw new Error(`${cmd} failed (${r.status}): ${r.stderr||r.stdout||r.error?.message}`);return r.stdout.trim();}
const remote=args=>run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','tower-linux','docker',...args]);
const pause=()=>new Promise(r=>setTimeout(r,250));
async function localPort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function portReady(port){return new Promise(r=>{const socket=net.connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();r(true);});socket.once('error',()=>r(false));});}
async function main(){
 let created=false,tunnel;
 try{
  remote(['run','--detach','--rm','--name',name,'-e','POSTGRES_PASSWORD=dzen_synthetic_only','-e','POSTGRES_USER=dzen_synthetic','-e','POSTGRES_DB=dzen_store_test','-p','127.0.0.1::5432','postgres:16-alpine']);created=true;
  const binding=remote(['port',name,'5432']);if(!/^127\.0\.0\.1:\d+$/.test(binding))throw Error('unexpected isolated PostgreSQL binding');
  let ready=false;for(let i=0;i<40;i++){const r=spawnSync('ssh',['-o','BatchMode=yes','tower-linux','docker','exec',name,'pg_isready','-U','dzen_synthetic','-d','dzen_store_test'],{encoding:'utf8',timeout:10000});if(r.status===0){ready=true;break;}await pause();}if(!ready)throw Error('disposable tower PostgreSQL not ready');
  const port=await localPort();
  tunnel=spawn('ssh',['-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=10','-N','-L',`127.0.0.1:${port}:${binding}`,'tower-linux'],{stdio:'ignore'});
  let tunnelError;tunnel.once('error',error=>{tunnelError=error;});
  ready=false;for(let i=0;i<40;i++){if(tunnelError)throw tunnelError;if(tunnel.exitCode!==null)throw Error('SSH database tunnel failed');if(await portReady(port)){ready=true;break;}await pause();}if(!ready)throw Error('SSH database tunnel unavailable');
  const env={...process.env,DZEN1002_TEST_DATABASE_URL:`postgresql://dzen_synthetic:dzen_synthetic_only@127.0.0.1:${port}/dzen_store_test`};
  run(resolve(root,'node_modules/.bin/prisma'),['db','push','--config','tests/fixtures/dzen1002-store-prisma.config.ts'],env);
  const result=spawnSync(process.execPath,['--test','tests/tdpd/dzen1002-store.test.cjs'],{cwd:root,env,stdio:'inherit',timeout:60000});process.exitCode=result.status===0?0:1;
 }finally{if(tunnel)tunnel.kill();if(created)remote(['rm','--force',name]);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
