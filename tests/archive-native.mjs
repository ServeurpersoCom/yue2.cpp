import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const env=process.platform==='win32'?Object.fromEntries(Object.entries(process.env).map(([k,v])=>[k.toUpperCase(),v])):process.env;
for(const [cmd,args] of [['cmake',['-S','tests/job-archive','-B','build/job-archive-tests']],['cmake',['--build','build/job-archive-tests','--config','Release']],[join(root,'build/job-archive-tests',process.platform==='win32'?'Release/job-archive-test.exe':'job-archive-test'),[]]]){const r=spawnSync(cmd,args,{cwd:root,env,stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(r.status??1);}
