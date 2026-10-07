// Manual real-media check; requires an idle Studio and existing real-media artifacts.
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {availableArtModels,artworkGraph} from '../tools/webui/src/lib/comfy-art.ts';
const base='http://127.0.0.1:8087',folder='build/media-acceptance/',report=JSON.parse(await readFile('build/media-acceptance/followup.json','utf8').catch(()=>'[]'));
async function json(path,init){const r=await fetch(base+path,init);if(!r.ok)throw Error(path+': '+await r.text());return r.json();}
async function record(name,data){report.push({name,data,at:new Date().toISOString()});console.log(name,JSON.stringify(data));await writeFile(folder+'followup.json',JSON.stringify(report,null,2));}
async function poll(id){for(let n=0;n<900;n++){const s=await json('/job?id='+id);if(s.status==='done')return;if(s.status!=='running')throw Error(JSON.stringify(s));if(n%15===0)console.log(await json('/jobs'));await new Promise(r=>setTimeout(r,2000));}throw Error('Job timeout');}
try{
 const cover=await readFile(folder+'cover.png');
 if(!process.argv.includes('--skip-reference')){
  const form=new FormData();form.append('image',new Blob([cover],{type:'image/png'}),'reference-check.png');form.append('type','input');
  const image=await json('/comfy/upload/image',{method:'POST',body:form});
  const models=availableArtModels(await json('/comfy/object_info'));
  const graph=artworkGraph(models,'Create an entirely NEW scene using only the illustration medium, amber lighting and purple color palette from <image1>. Replace the man, street and bridge completely. Show a close-up vintage drum machine and vinyl records on a rooftop table at sunset, distant city skyline. No people. No bridge. No lettering.',112346,'yue2-reference-check',(image.subfolder?image.subfolder+'/':'')+image.name+' [input]');
  const started=Date.now(),{prompt_id}=await json('/comfy/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph})});await record('Reference retry submitted',{prompt_id,cfg:4});
  for(let n=0;n<900;n++){const h=(await json('/comfy/history/'+prompt_id))[prompt_id];if(h?.status?.status_str==='error')throw Error(JSON.stringify(h.status));const img=h?.outputs?.['8']?.images?.[0];if(img){const r=await fetch(base+'/comfy/view?'+new URLSearchParams(img));await writeFile(folder+'reference-cover-guided.png',Buffer.from(await r.arrayBuffer()));await record('Reference retry completed',{seconds:(Date.now()-started)/1000});break;}if(n%15===0)console.log('Reference artwork processing');await new Promise(r=>setTimeout(r,2000));}
 }
 const form=new FormData();form.append('audio',new Blob([await readFile(folder+'take-0.wav')],{type:'audio/wav'}),'original.wav');form.append('vocal_gain_db','3');
 const start=Date.now(),{id}=await json('/vocal-balance',{method:'POST',body:form});await record('Vocal separation submitted',{id});await poll(id);const r=await fetch(base+'/job?id='+id+'&result=1');await writeFile(folder+'vocal-plus3.wav',Buffer.from(await r.arrayBuffer()));await record('Vocal separation completed',{seconds:(Date.now()-start)/1000,contentType:r.headers.get('Content-Type')});
 await fetch(base+'/job?id='+id+'&ack=1',{method:'POST'});
 const delivery=new FormData();delivery.append('audio',new Blob([await readFile(folder+'take-1.wav')],{type:'audio/wav'}),'master.wav');delivery.append('cover',new Blob([cover],{type:'image/png'}),'cover.png');
 const video=await json('/render-video',{method:'POST',body:delivery});await poll(video.id);await writeFile(folder+'hiphop-circuit-test.mp4',Buffer.from(await(await fetch(base+'/job?id='+video.id+'&result=1')).arrayBuffer()));await fetch(base+'/job?id='+video.id+'&ack=1',{method:'POST'});
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',folder+'hiphop-circuit-test.mp4'],{encoding:'utf8',windowsHide:true}));await record('MP4 codecs',probe.streams.map(s=>({codec:s.codec_name,width:s.width,height:s.height,duration:s.duration})));
}catch(e){await record('Needs attention',{error:String(e)});process.exitCode=1;}
