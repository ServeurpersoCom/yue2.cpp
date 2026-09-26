// Disposable profile and mocked generation: never touches the live library/GPU.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url));
const jobs=new Map(), submitted=[];
let hold=false, active=0, maxActive=0;
const wav=Buffer.alloc(48044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/synth') { let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);submitted.push(request);const id=String(submitted.length);jobs.set(id,{request,status:hold?'running':'done'});active++;maxActive=Math.max(active,maxActive);json({id});return; }
 if(url.pathname==='/job') {
  const job=jobs.get(url.searchParams.get('id'));if(!job){json({},404);return;}
  if(req.method==='POST'){job.status='cancelled';active--;json({status:'cancelled'});return;}
  if(url.searchParams.has('result')){active--;res.writeHead(200,{'Content-Type':'multipart/mixed; boundary=take'});res.end(Buffer.concat([Buffer.from('--take\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify({...job.request,output_format:'wav16',abc:'X:1',semantic_tokens:'1,2'})+'\r\n--take\r\nContent-Type: audio/wav\r\n\r\n'),wav,Buffer.from('\r\n--take--\r\n')]));return;}
  json({status:job.status});return;
 }
 if(url.pathname==='/props'){json({version:'test',sample_rate:48000,frame_rate:25,defaults:{style:'',cot:'full',abc_sampling:{temperature:.7},semantic_sampling:{temperature:1},steps:32}});return;}
 if(url.pathname==='/logs'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(html);
});
await new Promise(r=>server.listen(18789,'127.0.0.1',r));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yue2-producer-'));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=19230',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','--mute-audio','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,sequence=0;const pending=new Map(),errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(new Error(method+' timed out')),10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw new Error('Timeout: '+expression);}
async function input(label,value,event='input'){await evaluate(`{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('${event}',{bubbles:true}));}`);await delay(50);}
try {
 let target;for(let i=0;i<60;i++){try{target=(await(await fetch('http://127.0.0.1:19230/json')).json()).find(x=>x.type==='page');if(target)break;}catch{}await delay(200);}
 assert.ok(target);ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result);}});
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:18789'});
 await until(`!!document.querySelector('[aria-label="Amount of singing"]')`);
 await input('Amount of singing',100);await input('Different voices',2,'change');await input('Voice 1 description','Warm velvet tenor');
 await evaluate(`document.querySelector('.producer .lock input').click()`);
 assert.equal(await evaluate(`document.querySelector('[aria-label="Voice 1 description"]').disabled`),true);
 await input('Takes per generation',3,'change');await input('Planner tempo',90);
 await evaluate(`{const e=document.querySelector('#lyrics-editor textarea');e.value='[Verse]\\nWe carry light into the morning';e.dispatchEvent(new Event('input',{bubbles:true}));}`);
 await send('Page.reload');await until(`!!document.querySelector('[aria-label="Amount of singing"]')`);
 assert.equal(await evaluate(`document.querySelector('[aria-label="Amount of singing"]').value`),'100');
 assert.equal(await evaluate(`document.querySelector('[aria-label="Voice 1 description"]').value`),'Warm velvet tenor');
 assert.equal(await evaluate(`document.querySelector('[aria-label="Voice 1 description"]').disabled`),true);
 await evaluate(`document.querySelector('.generate-btn').click()`);
 await until(`document.querySelector('.side-count').textContent==='3'`);
 assert.equal(submitted.length,3);assert.equal(maxActive,1,'takes are sequential');
 assert.equal(new Set(submitted.map(r=>r.lm_seed)).size,3);
 for(const r of submitted){assert.match(r.style,/Fully melodic/);assert.match(r.style,/Warm velvet tenor/);assert.match(r.style,/2 distinct/);assert.equal(r.lm_batch_size,1);assert.equal(r.synth_batch_size,1);}
 await evaluate(`document.querySelectorAll('.side-nav button')[2].click()`);
 await until(`!!document.querySelector('[aria-label="Compare takes"]')`);
 await evaluate(`{const s=document.querySelector('[aria-label="Compare takes"]');s.selectedIndex=1;s.dispatchEvent(new Event('change',{bubbles:true}));}`);
 assert.equal(await evaluate(`document.querySelectorAll('.song-list .card-name').length`),3);
 await evaluate(`document.querySelectorAll('.side-nav button')[1].click()`);
 // Cancel a held first take and prove the rest are not sent.
 hold=true;await evaluate(`document.querySelector('.generate-btn').click()`);
 await until(`!!document.querySelector('[title="Cancel the active job"]')`);
 await evaluate(`document.querySelector('[title="Cancel the active job"]').click()`);
 await until(`!document.querySelector('.request-form').classList.contains('is-generating')`);
 assert.equal(submitted.length,4);assert.equal(await evaluate(`localStorage.getItem('yue2-job-synth')`),null);
 // Instrumental request preserves editor text and can run after cancellation.
 hold=false;await input('Vocal presence',0);await input('Takes per generation',1,'change');
 await evaluate(`document.querySelector('.generate-btn').click()`);
 await until(`!document.querySelector('.request-form').classList.contains('is-generating')`);
 assert.equal(submitted.length,5);assert.equal(submitted.at(-1).lyrics,'');
 assert.match(await evaluate(`document.querySelector('#lyrics-editor textarea').value`),/carry light/);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate(`document.querySelector('.producer').scrollIntoView({behavior:'instant'})`);await delay(150);
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'mobile overflow');
 fs.writeFileSync(new URL('../../../build/ui-review/producer-mobile.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.deepEqual(errors,[]);
 console.log('PASS: controls, locked profile persistence, three sequential independent takes, comparison grouping, cancellation, instrumental preservation, mobile layout; no live generation.');
}catch(error){console.error({submitted:submitted.length,errors,body:await evaluate('document.body.innerText.slice(-5000)'),pendingJob:await evaluate(`localStorage.getItem('yue2-job-synth')`)});throw error;}
finally{ws?.close();browser.kill();server.closeAllConnections();server.close();for(const p of pending.values())clearTimeout(p.timer);}
