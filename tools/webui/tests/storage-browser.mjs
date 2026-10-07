import {chromium} from '../../youtube-agent/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const html=await readFile(new URL('../dist/index.html',import.meta.url));
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'msedge'}),headless:true});
const base='http://localhost:8087';
function wav(){const b=Buffer.alloc(44+32000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
async function context(){const c=await browser.newContext();await c.route(base+'/',r=>r.fulfill({contentType:'text/html',body:html}));await c.route('**/presets',r=>r.fulfill({json:[]}));return c;}
async function library(page,store='songs'){return page.evaluate(store=>new Promise((resolve,reject)=>{const r=indexedDB.open('yue2-songs');r.onsuccess=()=>{const db=r.result,q=db.transaction(store).objectStore(store).getAll();q.onsuccess=()=>{resolve(q.result.map(x=>({id:x.id,name:x.name,audioSize:x.audio?.size,submitted:x.submitted})));db.close();};q.onerror=()=>reject(q.error);};r.onerror=()=>reject(r.error);}),store);}
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error(label);}
try{
 for(const mode of ['quota','malformed']){
  const c=await context(),page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(mode=>{if(mode==='quota'){const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='yue2')throw new DOMException('Quota failure','QuotaExceededError');return original.call(this,k,v);};}else localStorage.setItem('yue2',JSON.stringify({request:{style:42}}));},mode);
  await page.goto(base);await page.getByRole('heading',{name:'Create your song'}).waitFor();await page.locator('.storage-warning').waitFor();assert.deepEqual(errors,[]);await c.close();
 }
 const c=await context(),a=await c.newPage(),b=await c.newPage();let submissions=0,done=false,releaseArt;
 const artGate=new Promise(r=>releaseArt=r);let artRequested=false;
 const errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 await c.route('**/synth',async r=>{submissions++;return r.fulfill({json:{id:r.request().headers()['x-yue2-job-id']}});});
 const payload=Buffer.concat([Buffer.from('--fixture\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify({style:'Audit',output_format:'mp3',lm_seed:1,seed:1,abc_sampling:{},semantic_sampling:{}})+'\r\n--fixture\r\nContent-Type: audio/wav\r\n\r\n'),wav(),Buffer.from('\r\n--fixture--\r\n')]);
 await c.route('**/job?*',r=>r.request().url().includes('result=1')?r.fulfill({contentType:'multipart/mixed; boundary=fixture',body:payload}):r.fulfill({json:{status:done?'done':'running',durable:true}}));
 await c.route('**/comfy/object_info',r=>r.fulfill({json:{UnetLoaderGGUF:{input:{required:{unet_name:[['qwen-image-2.1-Q4_K_M.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_int8.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae.safetensors']]}}},TextEncodeQwenImage21:{},EmptyLatentImage:{},KSampler:{},VAEDecode:{},SaveImage:{},LoadImage:{}}}));
 await c.route('**/comfy/queue',r=>r.fulfill({json:{queue_running:[],queue_pending:[]}}));
 await c.route('**/comfy/prompt',r=>{artRequested=true;return r.fulfill({json:{prompt_id:'audit-art'}});});
 await c.route('**/comfy/history/*',async r=>{await artGate;return r.fulfill({json:{'audit-art':{outputs:{'8':{images:[{filename:'audit.png'}]}}}}});});
 await c.route('**/comfy/view?*',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')}));
 await c.route('**/render-video',r=>r.fulfill({status:503,json:{error:'Fixture forbids real rendering'}}));
 await a.goto(base);await a.getByRole('heading',{name:'Create your song'}).waitFor();await b.goto(base);await b.getByRole('heading',{name:'Create your song'}).waitFor();await a.waitForTimeout(300);
 await a.getByLabel('Output format',{exact:true}).selectOption('mp4');
 await a.getByRole('button',{name:'Generate track',exact:true}).click();await until(()=>submissions===1,'submission');
 assert.equal((await library(a,'pending')).length,1,'recovery persisted');
 await b.getByRole('button',{name:'Generate track',exact:true}).click();await b.getByRole('status').filter({hasText:'Another tab'}).waitFor();assert.equal(submissions,1,'duplicate submit blocked');
 done=true;await until(()=>artRequested,'art submission');
 assert.ok((await library(a))[0]?.audioSize>0,'audio saved before artwork completes');
 await b.getByRole('button',{name:/^Library/}).click();await b.locator('.song-list .card').waitFor();
 // A failed save must not toggle the heart or produce an unhandled exception.
 await b.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Quota test','QuotaExceededError');};});
 const favourite=b.locator('.song-list .fav-btn');await favourite.click();await b.getByRole('status').filter({hasText:'Quota test'}).waitFor();assert.equal(await favourite.getAttribute('aria-pressed'),'false');
 await b.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});
 await b.getByRole('button',{name:'Track actions'}).click();await b.getByRole('menuitem',{name:'Delete this track',exact:true}).click();await b.getByRole('button',{name:'OK',exact:true}).click();
 await until(async()=>!(await library(b)).length,'delete');releaseArt();
 await until(async()=>!(await library(a,'pending')).length,'completion');assert.equal((await library(a)).length,0,'late completion must not resurrect deleted track');
 assert.deepEqual(errors,[]);await c.close();
 console.log('PASS: storage failure and malformed settings remain usable; recovery precedes submit; two tabs submit once; audio saves before artwork; failed favourite stays unchanged; late completion cannot resurrect deleted tracks.');
}finally{await browser.close();}
