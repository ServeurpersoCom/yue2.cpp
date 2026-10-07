import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const work=await mkdtemp(join(root,'build/recovery-http-'));
await mkdir(join(work,'job_results'));
const id='0123456789abcdef0123456789abcdef', interrupted='1111111111111111';
const body=Buffer.from('archived\0audio'),mime='audio/wav';
await writeFile(join(work,'job_results',id+'.result'),Buffer.concat([Buffer.from(`YUE2JOB1\n1\n${mime.length}\n${body.length}\n${mime}`),body]));
await writeFile(join(work,'job_results',interrupted+'.pending'),'interrupted\n');
const env=Object.fromEntries(Object.entries(process.env).map(([k,v])=>[k.toUpperCase(),v]));env.GGML_BACKEND='CPU';
const base='http://127.0.0.1:18088';let child;
async function start(){
 child=spawn(join(root,'build/Release-producer/yue-server.exe'),['--host','127.0.0.1','--port','18088','--comfy-port','18188','--max-seq','512','--model',join(root,'models/YuE2-3B-Q8_0.gguf'),'--vae',join(root,'models/YuE2-Vae-F32.gguf')],{cwd:work,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',b=>logs=(logs+b).slice(-8000));
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Server startup timeout '+logs);
}
async function stop(){const stopping=child;child=undefined;if(stopping&&stopping.exitCode===null&&stopping.signalCode===null){const ended=once(stopping,'exit');stopping.kill();await ended;}}
try{
 for(let pass=0;pass<2;pass++){
  await start();
  assert.deepEqual(await(await fetch(base+`/job?id=${id}`)).json(),{status:'done',durable:true});
  assert.equal(Buffer.compare(Buffer.from(await(await fetch(base+`/job?id=${id}&result=1`)).arrayBuffer()),body),0);
  assert.equal((await(await fetch(base+`/job?id=${interrupted}`)).json()).status,'interrupted');
  const retry=await fetch(base+'/synth',{method:'POST',headers:{'Content-Type':'application/json','X-Yue2-Job-Id':id},body:JSON.stringify({style:'Audit replay'})});
  assert.equal(retry.status,200);assert.equal((await retry.json()).id,id);
  assert.equal((await(await fetch(base+`/job?id=${id}`)).json()).status,'done');
  assert.equal((await fetch(base+`/job?id=${id}&ack=1`,{method:'POST'})).status,200);
  await stop();
 }
 console.log('PASS: archived binary results survive server restart; retries return the same completed job; interrupted status and acknowledgement work. No synthesis performed.');
}finally{await stop();}
