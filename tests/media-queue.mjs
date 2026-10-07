import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const duration=process.argv.includes('--long')?360:3;
const root=fileURLToPath(new URL('../',import.meta.url)),work=await mkdtemp(join(root,'build/media-queue-'));
const env=Object.fromEntries(Object.entries(process.env).map(([k,v])=>[k.toUpperCase(),v]));env.GGML_BACKEND='CPU';
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:work,env,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});
run('ffmpeg',['-y','-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,'-ar','48000',join(work,'tone.wav')]);
run('ffmpeg',['-y','-f','lavfi','-i','color=c=purple:s=128x128','-frames:v','1',join(work,'cover.png')]);
await mkdir(join(work,'saved_presets'));
const preset={name:'Recovered',kind:'music',data:{ids:[],weights:{},prompt:'Jazz'}};
await writeFile(join(work,'saved_presets/music-Recovered.bak'),JSON.stringify(preset));
await writeFile(join(work,'saved_presets/music-Recovered.tmp'),'incomplete');
const child=spawn(join(root,'build/Release-producer/yue-server.exe'),['--host','127.0.0.1','--port','18088','--comfy-port','18188','--max-seq','512','--model',join(root,'models/YuE2-3B-Q8_0.gguf'),'--vae',join(root,'models/YuE2-Vae-F32.gguf')],{cwd:work,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';child.stderr.on('data',b=>logs+=b);child.stdout.on('data',()=>{});
const base='http://127.0.0.1:18088';
async function done(id){for(let i=0;i<2400;i++){const s=await(await fetch(base+`/job?id=${id}`)).json();if(s.status==='done'||s.status==='cancelled'||s.status==='failed')return s.status;await new Promise(r=>setTimeout(r,250));}throw Error('Media timeout '+logs);}
function form(audio,cover){const f=new FormData();f.append('audio',new Blob([audio],{type:'audio/wav'}),'tone.wav');f.append('cover',new Blob([cover],{type:'image/png'}),'cover.png');return f;}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal((await(await fetch(base+'/presets')).json())[0].name,'Recovered');
 assert.equal((await fetch(base+'/presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...preset,name:'Renamed',oldName:'Recovered',operation:'rename'})})).status,200);
 assert.equal((await(await fetch(base+'/presets')).json())[0].name,'Renamed');
 const audio=await readFile(join(work,'tone.wav')),cover=await readFile(join(work,'cover.png'));
 const id='22222222222222222222222222222222';
 const response=await fetch(base+'/render-video',{method:'POST',headers:{'X-Yue2-Job-Id':id},body:form(audio,cover)});
 assert.equal(response.status,200);assert.equal((await response.json()).id,id);assert.equal(await done(id),'done',logs);
 const video=Buffer.from(await(await fetch(base+`/job?id=${id}&result=1`)).arrayBuffer());await writeFile(join(work,'video.mp4'),video);
 const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',join(work,'video.mp4')]));
 assert.ok(probe.streams.some(s=>s.codec_name==='h264'&&s.width===1920&&s.height===1080));assert.ok(probe.streams.some(s=>s.codec_name==='aac'));assert.ok(Math.abs(Number(probe.streams[0].duration)-duration)<1);
 const retry=await fetch(base+'/render-video',{method:'POST',headers:{'X-Yue2-Job-Id':id},body:form(audio,cover)});assert.equal((await retry.json()).id,id);assert.equal(await done(id),'done');
 const cancelId='33333333333333333333333333333333';await fetch(base+'/render-video',{method:'POST',headers:{'X-Yue2-Job-Id':cancelId},body:form(audio,cover)});await fetch(base+`/job?id=${cancelId}&cancel=1`,{method:'POST'});assert.equal(await done(cancelId),'cancelled');
 assert.deepEqual(await(await fetch(base+'/jobs')).json(),[]);
 console.log('PASS: interrupted preset recovery; atomic rename; bounded asynchronous video, idempotent retry, H.264 1920x1080 + AAC, owned cancellation; '+duration+' seconds. '+work);
}finally{if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();await exit;}}
