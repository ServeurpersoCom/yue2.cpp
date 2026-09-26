// Isolated browser profile and preview origin: never changes the user's library.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, 'build/ui-review');
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url));
const submitted = [];
const server = http.createServer((req, res) => {
  if (req.url === '/synth') {
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{submitted.push(JSON.parse(body));res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Preview capture only; no generation.'}));});return;
  }
  if (['/props', '/logs', '/health'].includes(req.url)) {
    const upstream = http.get(`http://127.0.0.1:8087${req.url}`, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    res.on('close', () => upstream.destroy());
  } else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); }
});
await new Promise(resolve => server.listen(18788, '127.0.0.1', resolve));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yue2-ui-review-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=19229', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let ws;
let sequence = 0;
const pending = new Map();
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
try {
  let target;
  for (let n = 0; n < 60; n++) {
    try { target = (await (await fetch('http://127.0.0.1:19229/json')).json()).find(item => item.type === 'page'); if (target) break; } catch {}
    await delay(200);
  }
  assert.ok(target, 'Chrome debugging target unavailable');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id); pending.delete(message.id); clearTimeout(task.timer);
      if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:18788' });
  await delay(1800);
  assert.ok(await evaluate(`document.body.innerText.includes('Sound desk')`));
  for (const theme of ['dark', 'cyberpunk', 'colorful', 'mint', 'burnt-orange']) {
    await evaluate(`{const select=document.querySelector('[aria-label="Color theme"]');select.value=${JSON.stringify(theme)};select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await delay(120);
    assert.equal(await evaluate('document.documentElement.dataset.theme'), theme);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${theme} desktop overflow`);
    const capture = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, `studio-${theme}.png`), Buffer.from(capture.data, 'base64'));
  }
  await evaluate(`{const select=document.querySelector('[aria-label="Add music style"]');select.value='dark_industrial';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await delay(100);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Music style prompt and descriptions"]').value.includes('metallic percussion')`));
  assert.ok(await evaluate(`document.querySelector('.music-mixer [role="slider"]').getAttribute('aria-label').includes('Dark Industrial')`));
  await evaluate(`document.querySelector('.music-mixer [role="slider"]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  await delay(60);
  assert.equal(await evaluate(`document.querySelector('.music-mixer [role="slider"]').getAttribute('aria-valuenow')`), '100');
  await evaluate(`document.querySelector('.music-mixer .style-ring-wrap > button').click()`);
  await delay(60);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Music style prompt and descriptions"]').value`), '');
  assert.ok(await evaluate(`!!document.querySelector('.music-mixer .custom-style-ring [role="slider"]')`), 'custom prompt strength ring remains available');
  assert.ok(await evaluate(`Array.from(document.querySelector('[aria-label="Add music style"]').options).some(option => option.value === 'liquid_dnb')`), 'expanded music style catalogue is available');
  assert.ok(await evaluate(`document.querySelector('#duration-auto').closest('.duration-auto') && getComputedStyle(document.querySelector('.duration-switch-track')).width !== '0px'`), 'auto duration uses a visible switch row');
  await evaluate(`document.querySelector('a[href="#render-workbench"]').click()`);
  await delay(100);
  assert.ok(await evaluate(`document.querySelector('#render-workbench').open`));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('window.scrollTo(0,0)');
  await delay(300);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile overflow');
  assert.ok(await evaluate(`document.querySelector('.sculpture-stage canvas').width > 100`));
  const mobile = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'studio-mobile.png'), Buffer.from(mobile.data, 'base64'));
  // Capture actual UI requests locally. Never forward song creation to the live server.
  await evaluate(`{const select=document.querySelector('[aria-label="Add music style"]');select.value='modern_trap';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await delay(100);
  assert.ok(await evaluate(`document.querySelector('.profile-title').textContent.includes('Rhythmic focus')`));
  await evaluate(`document.querySelector('.generate-btn').click()`);
  await delay(300);
  assert.equal(submitted.at(-1).abc_sampling.temperature,.65);
  assert.equal(submitted.at(-1).steps,32);
  assert.equal(submitted.at(-1).mp3_bitrate,320);
  assert.match(submitted.at(-1).style,/Modern Trap/);
  await evaluate(`document.querySelectorAll('.engine-mode button')[1].click()`);
  await delay(60);
  await evaluate(`{const input=document.querySelector('#render-workbench .meta-grid input');input.value='40';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await evaluate(`document.querySelector('.generate-btn').click()`);
  await delay(200);
  assert.equal(submitted.at(-1).steps,40,'manual controls reach the request');
  await evaluate(`document.querySelector('.engine-mode button').click()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('#engine-workbench').scrollIntoView({block:'center',behavior:'instant'})`);
  await delay(150);
  const production = await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'production-desk.png'),Buffer.from(production.data,'base64'));
  // Seed 10-second PCM tones only in this disposable profile. Chrome output is muted.
  await evaluate(`new Promise((resolve,reject)=>{
    const buffer=new ArrayBuffer(1920044), view=new DataView(buffer);
    const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,1920036,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,48000,true);view.setUint32(28,192000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,1920000,true);
    for(let i=0;i<480000;i++){const value=Math.round(Math.sin(i/48000*220*Math.PI*2)*9000);view.setInt16(44+i*4,value,true);view.setInt16(46+i*4,value,true);}
    const open=indexedDB.open('yue2-songs',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('songs','readwrite');const store=tx.objectStore('songs');for(const [name,favorite] of [['Northern Lights',false],['Midnight Echo',true]])store.add({name,favorite,format:'wav16',created:Date.now(),style:'Ambient cinematic',seed:1,duration:.1,score:'',request:{style:'Ambient cinematic',abc_sampling:{},semantic_sampling:{}},audio:new Blob([buffer],{type:'audio/wav'})});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error);};
  })`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:18788' });
  await delay(900);
  assert.equal(await evaluate(`document.querySelector('.engine-indicator').textContent`),'AUTO','production mode persists after reload');
  assert.equal(await evaluate(`document.querySelectorAll('.card-name').length`), 2);
  await evaluate(`window.scrollTo(0,0);document.querySelector('.play-btn').click()`);
  await delay(800);
  assert.ok(await evaluate(`document.querySelector('.audio-sculpture').classList.contains('is-playing')`));
  const measured = await evaluate(`Array.from(document.querySelectorAll('.signal-meters i')).map(el => parseFloat(el.style.transform.replace('scaleX(','')))`);
  assert.ok(measured.some(value => value > .01), 'real PCM playback drives the audio meters: ' + JSON.stringify(measured));
  const live = await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'signal-live.png'),Buffer.from(live.data,'base64'));
  await evaluate(`document.querySelector('[aria-label="Expand visualizer"]').click()`);
  await delay(200);
  assert.ok(await evaluate(`document.querySelector('.signal-dialog').open`));
  await evaluate(`document.querySelectorAll('.signal-dialog .view-modes button')[1].click()`);
  await delay(160);
  const orbit = await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'signal-orbit.png'),Buffer.from(orbit.data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await delay(100);
  assert.equal(await evaluate(`document.querySelector('.signal-dialog').open`),false);
  assert.ok(await evaluate(`document.activeElement.classList.contains('expand-signal')`));
  await evaluate(`document.querySelector('.play-btn').click()`);
  await delay(300);
  assert.ok(await evaluate(`!document.querySelector('.audio-sculpture').classList.contains('is-playing')`));
  await evaluate(`{const input=document.querySelector('[aria-label="Search tracks"]');input.value='Northern';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await delay(80);
  assert.equal(await evaluate(`document.querySelectorAll('.card-name').length`), 1);
  await evaluate(`document.querySelector('.library-tools button').click()`);
  await delay(80);
  assert.ok(await evaluate(`document.body.innerText.includes('No tracks match this view.')`));
  await evaluate(`document.querySelector('.no-results button').click()`);
  await delay(80);
  assert.equal(await evaluate(`document.querySelectorAll('.card-name').length`), 2);
  const populated = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'studio-library.png'), Buffer.from(populated.data, 'base64'));
  // Attach test-only raster artwork through the real upload handler.
  await evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=800;
    const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,800,800);gradient.addColorStop(0,'#162b54');gradient.addColorStop(1,'#e58b43');context.fillStyle=gradient;context.fillRect(0,0,800,800);
    context.strokeStyle='#fce5b0';context.lineWidth=3;for(let i=0;i<9;i++){context.beginPath();context.arc(400,400,70+i*30,0,Math.PI*2);context.stroke();}
    context.fillStyle='#fff';context.font='32px sans-serif';context.fillText('ARTWORK VIEWER TEST',185,725);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'test-cover.png',{type:'image/png'}));
    const input=document.querySelector('input[aria-label^="Artwork file"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  for(let i=0;i<20;i++){if(await evaluate(`!!document.querySelector('.art-cover img')`))break;await delay(100);}
  assert.equal(await evaluate(`document.querySelectorAll('.art-cover').length`),1);
  await send('Page.navigate', { url: 'http://127.0.0.1:18788' });
  await delay(700);
  assert.equal(await evaluate(`document.querySelectorAll('.art-cover').length`),1,'artwork persists after reload');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await evaluate(`document.querySelector('.art-cover').click()`);
  await delay(80);
  assert.ok(await evaluate(`document.querySelector('.large-art').getAnimations().length > 0`),'morph animation runs');
  await delay(450);
  assert.ok(await evaluate(`document.querySelector('.art-dialog').open`));
  assert.equal(await evaluate(`document.documentElement.style.overflow`),'hidden');
  const art = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'artwork-expanded.png'), Buffer.from(art.data, 'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await delay(350);
  assert.equal(await evaluate(`document.querySelector('.art-dialog').open`),false);
  assert.ok(await evaluate(`document.activeElement.classList.contains('art-cover')`),'focus returns to thumbnail');
  assert.equal(await evaluate(`document.documentElement.style.overflow`),'');
  const covers = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'artwork-track.png'), Buffer.from(covers.data, 'base64'));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`document.querySelector('.art-cover').scrollIntoView();document.querySelector('.art-cover').click()`);
  await delay(150);
  assert.equal(await evaluate(`document.querySelector('.large-art').getAnimations().length`),0);
  assert.ok(await evaluate(`document.querySelector('.large-art').getBoundingClientRect().width <= innerWidth`));
  const mobileArt = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'artwork-mobile.png'), Buffer.from(mobileArt.data, 'base64'));
  await evaluate(`document.querySelector('.art-close').click()`);
  await delay(80);
  assert.equal(await evaluate(`document.querySelector('.art-dialog').open`),false);
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),'artwork card mobile overflow');
  assert.deepEqual(errors, []);
  console.log('PASS: themes/mobile; automatic/manual request capture and persistence; real PCM visualizer response and expanded-view focus; artwork persistence, morph and reduced-motion. No runtime exceptions. Screenshots: ' + output);
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} ws.close(); }
  browser.kill();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
