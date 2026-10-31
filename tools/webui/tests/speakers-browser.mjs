import { chromium } from '../../youtube-agent/node_modules/playwright/index.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1600,height:1000}});
const html = await readFile(new URL('../dist/index.html',import.meta.url));
await context.route('**/*', r => {
 const path = new URL(r.request().url()).pathname;
 if(path === '/') return r.fulfill({contentType:'text/html',body:html});
 if(path === '/props') return r.fulfill({json:{model:'Speaker test',context:24576,sample_rate:48000,defaults:{style:'Hip hop',abc_sampling:{},semantic_sampling:{}}}});
 return r.fulfill({json:path === '/presets' || path === '/jobs' ? [] : {}});
});
const page = await context.newPage(), errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://localhost:8087');
 await page.getByRole('heading',{name:'Create your song'}).waitFor();
 await page.evaluate(() => new Promise((resolve,reject) => {
  localStorage.setItem('yue2-theme','colorful');
  const r=indexedDB.open('yue2-songs');r.onsuccess=()=>{
   const db=r.result,tx=db.transaction('songs','readwrite');
   const rate=16000,n=rate*12,wav=new ArrayBuffer(44+n*2),v=new DataView(wav);
   const str=(p,s)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));
   str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
   for(let i=0;i<n;i++) v.setInt16(44+i*2,Math.sin(2*Math.PI*80*i/rate)*24000*(.2+.8*(Math.sin(i/rate*12)>0)),true);
   tx.objectStore('songs').put({name:'Speaker bass test',format:'wav',created:Date.now(),style:'Bass pulse',request:{style:'Bass pulse',abc_sampling:{},semantic_sampling:{}},duration:12,audio:new Blob([wav],{type:'audio/wav'}),peaks:new Float32Array(4096)});
   tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
  };r.onerror=()=>reject(r.error);
 }));
 await page.reload();await page.getByRole('button',{name:'Play preview',exact:true}).waitFor();
 // the header deck uses the cassette; the live speaker sits in the Output card
 assert.equal(await page.locator('.speaker-cabinet').count(),1);
 const levels=()=>page.locator('.speaker-cabinet').evaluateAll(nodes=>nodes.map(n=>Number(n.style.getPropertyValue('--excursion'))));
 assert.deepEqual(await levels(),[0]);
 await page.getByRole('button',{name:'Play preview',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.speaker-cabinet')].every(n=>Number(n.style.getPropertyValue('--excursion'))>.05));
 const active=await levels();
 await page.getByLabel('Monitor volume',{exact:true}).fill('0');await page.waitForTimeout(1000);
 assert.ok((await levels()).every(v=>v<.005),'muting stops motion');
 await page.getByLabel('Playback volume',{exact:true}).fill('0.7');await page.waitForTimeout(500);
 assert.ok((await levels()).every(v=>v>.05),'volume restore resumes motion');
 await page.getByRole('button',{name:'Pause preview',exact:true}).click();await page.waitForTimeout(1000);
 assert.deepEqual(await levels(),[0]);
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Play preview',exact:true}).click();await page.waitForTimeout(300);assert.deepEqual(await levels(),[0]);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(300);
 await mkdir(new URL('../../../build/ui-review/',import.meta.url),{recursive:true});
 await page.screenshot({path:new URL('../../../build/ui-review/reactive-speakers.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');
 assert.deepEqual(errors,[]);
 console.log('PASS: live speaker, bass response, mute/volume, pause, reduced motion, mobile layout, no runtime errors.',active);
} finally {await browser.close()}
