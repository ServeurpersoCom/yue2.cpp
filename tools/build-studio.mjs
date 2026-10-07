import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const env=process.platform==='win32'?Object.fromEntries(Object.entries(process.env).map(([k,v])=>[k.toUpperCase(),v])):process.env;
const args=['--build','build','--config','Release','--target','yue-server'];
if(process.platform==='win32')args.push('--',`/p:OutDir=${join(root,'build/Release-producer/').replaceAll('\\','/')}`);
const r=spawnSync('cmake',args,{cwd:root,env,stdio:'inherit',windowsHide:true});if(r.error)console.error(r.error);process.exit(r.status??1);
