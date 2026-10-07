import { chromium } from '../tools/youtube-agent/node_modules/playwright/index.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('build/ui-review',{recursive:true});
const browser = await chromium.launch({...(process.env.CI ? {} : {channel:'msedge'}),headless:true});
try {
 const page = await browser.newPage({viewport:{width:1536,height:1024}});
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 let presets=[], rejected=0;
 await page.route('**/*',async route=>{
  const request=route.request(), url=new URL(request.url());
  if(url.origin==='http://localhost:8087' && url.pathname==='/') return route.fulfill({contentType:'text/html',body:await readFile('tools/webui/dist/index.html')});
  if(url.pathname==='/presets') {
   if(request.method()==='POST') {
    const p=request.postDataJSON(); await new Promise(resolve=>setTimeout(resolve,250));
    presets=presets.filter(x=>!(x.name===p.name && x.kind===p.kind));
    if(p.operation!=='delete') presets.push({name:p.name,kind:p.kind,data:p.data});
   }
   return route.fulfill({json:presets});
  }
  if(request.method()==='POST') { rejected++; await new Promise(resolve=>setTimeout(resolve,600)); return route.fulfill({status:503,json:{error:'Interaction review: simulated unavailable service'}}); }
  if(url.pathname==='/jobs')return route.fulfill({json:[]});
  if(url.pathname==='/api/tags')return route.fulfill({json:{models:[]}});
  return route.fulfill({json:{status:'ok',defaults:{},sample_rate:48000,context:24576}});
 });
 await page.goto('http://localhost:8087');
 await page.getByRole('heading',{name:'Create your song'}).waitFor();
 // Seed only the disposable browser's library with a silent, valid WAV and cover.
 await page.evaluate(async()=>{
  const buffer=new ArrayBuffer(44+16000*2*12), view=new DataView(buffer);
  const str=(offset,s)=>[...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  str(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,buffer.byteLength-44,true);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#7744cc';ctx.fillRect(0,0,64,64);
  const artwork=await new Promise(resolve=>canvas.toBlob(resolve));
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('yue2-songs');r.onupgradeneeded=()=>r.result.createObjectStore('songs',{keyPath:'id',autoIncrement:true});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('songs','readwrite');tx.objectStore('songs').put({id:1,name:'Interaction review track',created:1,duration:12,format:'wav',style:'Jazz Rap',seed:1,score:'',artwork,audio:new Blob([buffer],{type:'audio/wav'}),request:{style:'Jazz Rap',abc_sampling:{},semantic_sampling:{}}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 });
 await page.reload();
 await page.getByRole('heading',{name:'Create your song'}).waitFor();
 await page.getByRole('button',{name:'Manage saved presets'}).click();
 await page.getByRole('button',{name:'Edit style blends'}).click();
 const blends=page.locator('#music-workbench .favourites');
 await blends.getByPlaceholder('Name your preset').fill('Review preset');
 await blends.getByRole('button',{name:'Save new',exact:true}).click();
 await blends.getByRole('status').waitFor();
 assert.ok(await blends.getByRole('button',{name:'Load',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Load music preset Review preset'}).waitFor();
 await blends.getByRole('button',{name:'Load',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Loaded preset:'}).waitFor();
 await page.getByRole('button',{name:/^Library/}).click();
 const card=page.locator('.song-list > .card').first(), trigger=card.getByRole('button',{name:'Track actions'});
 await trigger.focus(); await page.keyboard.press('ArrowDown');
 assert.equal(await page.locator(':focus').innerText(),'Edit prompt');
 await page.keyboard.press('End'); assert.equal(await page.locator(':focus').innerText(),'Delete non-favorites');
 await page.keyboard.press('Home'); assert.equal(await page.locator(':focus').innerText(),'Edit prompt');
 await page.keyboard.press('Escape'); assert.ok(await trigger.evaluate(el=>el===document.activeElement));
 await page.screenshot({path:'build/ui-review/interaction-library.png'});
 await trigger.click();await page.getByRole('menuitem',{name:'Rename song',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Rename song'});
 await dialog.waitFor(); assert.ok(await dialog.getByLabel('Song name').evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Shift+Tab'); assert.equal(await page.locator(':focus').innerText(),'OK');
 await page.keyboard.press('Tab'); assert.ok(await dialog.getByLabel('Song name').evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Escape'); assert.ok(await trigger.evaluate(el=>el===document.activeElement));
 await card.getByRole('button',{name:'Favourite Interaction review track'}).click();
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Favourite Interaction review track"]')?.getAttribute('aria-pressed')==='true');
 const wave=card.getByRole('slider',{name:'Seek in Interaction review track'});
 await wave.focus();await page.keyboard.press('ArrowRight');assert.equal(await wave.getAttribute('aria-valuenow'),'5');
 await page.keyboard.press('Home');assert.equal(await wave.getAttribute('aria-valuenow'),'0');
 await page.keyboard.press('Space');await page.waitForTimeout(100);assert.equal(await card.locator('.play-btn').getAttribute('aria-pressed'),'true');await page.keyboard.press('Space');
 await card.getByRole('button',{name:'Expand artwork for Interaction review track'}).click();
 await page.getByRole('dialog',{name:'Artwork for Interaction review track'}).waitFor();
 await page.keyboard.press('Escape');await page.waitForTimeout(350);
 await trigger.click();await page.getByRole('menuitem',{name:'Transcribe score',exact:true}).click();
 await card.getByRole('status').filter({hasText:'Transcribing audio'}).waitFor();
 await trigger.click();assert.ok(await page.getByRole('menuitem',{name:'Transcribe melody'}).isDisabled());await page.keyboard.press('Escape');
 await page.getByRole('status').filter({hasText:'Transcription failed'}).waitFor();
 await trigger.click();await page.getByRole('menuitem',{name:'Prepare for YouTube'}).click();
 await page.getByLabel('Description',{exact:true}).fill('Line one');await page.keyboard.press('Enter');assert.equal(await page.getByRole('dialog',{name:'Prepare for YouTube'}).count(),1);
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft saved.'}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
 // Exercise library operations against the disposable fixture.
 await trigger.click();await page.getByRole('menuitem',{name:'Rename song',exact:true}).click();
 await page.getByLabel('Song name').fill('Renamed review track');await page.getByRole('button',{name:'OK',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.card-name')?.textContent==='Renamed review track');
 await trigger.click();
 const audioDownload=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Download audio',exact:true}).click();await audioDownload;
 const backupDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Backup',exact:true}).click();const backup=await backupDownload;
 page.on('dialog',dialog=>dialog.accept());await page.getByLabel('Choose a YuE2 library backup').setInputFiles(await backup.path());
 await page.waitForTimeout(1200);await page.getByRole('heading',{name:'Create your song'}).waitFor();
 const audit=[];
 // Hover and keyboard focus every visible control, including all expanded panels.
 await page.getByRole('button',{name:'Create',exact:true}).click();
 await page.locator('.style-tile').first().click();
 assert.equal(await page.locator('.style-tile').first().getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Manual control',exact:true}).click();
 await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
 const temperature=page.locator('#score-sampling').getByRole('slider',{name:'Temperature slider'});
 await temperature.focus(); await page.keyboard.press('ArrowRight');
 assert.ok(await page.locator('#score-sampling').getByRole('spinbutton',{name:'Temperature',exact:true}).inputValue());
 await page.keyboard.press('Tab');
 const controls=page.locator('button:visible, a:visible, summary:visible, input:visible, select:visible, textarea:visible, [role="slider"]:visible');
 const count=await controls.count();
 for(let i=0;i<count;i++) {
  const c=controls.nth(i); if(!await c.isVisible()) continue;
  const item=await c.evaluate(el=>({tag:el.tagName,name:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim().slice(0,80)||el.closest('label')?.textContent?.trim().slice(0,80),disabled:el.matches(':disabled')}));
  if(!item.disabled) { await c.focus(); item.focus=await c.evaluate(el=>getComputedStyle(el).outlineStyle); assert.notEqual(item.focus,'none',`Missing keyboard focus: ${item.name}`); }
  audit.push(item);
 }
 await writeFile('build/ui-review/control-inventory.json',JSON.stringify(audit,null,2));
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.generate-btn').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await page.locator('.generate-btn').hover();assert.equal(await page.locator('.generate-btn').evaluate(el=>getComputedStyle(el).transform),'none');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Phone overflow');
 assert.deepEqual(errors,[]);
 console.log(`PASS: ${audit.length} controls inventoried/focused; preset busy/load, menu arrows/Home/End/Escape, dialog focus/trap/restore, favourite, waveform seek/play, artwork, transcription busy/error, YouTube save, rename, audio download, backup/restore, reduced motion, phone width. ${rejected} server mutation mocked.`);
} finally {await browser.close();}
