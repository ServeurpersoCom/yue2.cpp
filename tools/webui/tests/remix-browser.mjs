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
  await evaluate(`new Promise((resolve,reject)=>{
    const buffer=new ArrayBuffer(96044),view=new DataView(buffer);
    const text=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i))};
    text(0,'RIFF');view.setUint32(4,96036,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,96000,true);
    const open=indexedDB.open('yue2-songs',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('songs','readwrite');const store=tx.objectStore('songs');store.add({name:'Remix source',format:'wav16',created:Date.now(),style:'Jazz Rap',seed:42,duration:1,score:'X:1',request:{style:'Jazz Rap',abc:'X:1',semantic_tokens:'1,2,3',lm_seed:42,seed:9,duration:20,abc_sampling:{},semantic_sampling:{temperature:1,top_p:.95}},audio:new Blob([buffer],{type:'audio/wav'})});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)};
  })`);
  await send('Page.reload');await delay(1000);
  await evaluate("document.querySelector('[aria-label=\"Remix Remix source\"]').click()");await delay(200);
  assert.ok(await evaluate("!!document.querySelector('.remix-panel')"),'instrumental source with no lyrics opens remix');
  assert.equal(await evaluate("document.querySelector('.generate-btn').textContent.trim()"),'Generate remix');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Remix variation\"]').value"),'25');
  for (const amount of [0,25,75,75]) {
    await evaluate(`{const input=document.querySelector('[aria-label="Remix variation"]');input.value='${amount}';input.dispatchEvent(new Event('input',{bubbles:true}))}`);await delay(50);
    await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
    const request=submitted.at(-1);
    assert.equal(request.lm_seed,42);assert.equal(request.seed,9);assert.equal(request.abc,'X:1');assert.equal(request.style,'Jazz Rap');
    if(amount===0)assert.equal(request.semantic_tokens,'1,2,3');else assert.ok(!request.semantic_tokens);
    assert.equal(request.semantic_sampling.temperature,1+amount*.005);
  }
  assert.deepEqual(submitted.at(-1),submitted.at(-2),'repeat same remix is reproducible at request level');
  await evaluate("Array.from(document.querySelectorAll('.side-nav button')).find(e=>e.textContent.includes('Library')).click()");await delay(200);
  await evaluate("document.querySelector('.library-main [aria-label=\"Remix Remix source\"]').click()");await delay(300);
  assert.ok(await evaluate("!!document.querySelector('.remix-panel')"),'library remix navigates back to Mix & Render');
  for(const [width,height,name] of [[1440,1000,'remix-desktop'],[390,844,'remix-mobile']]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    await evaluate("document.querySelector('.remix-panel').scrollIntoView({block:'center',behavior:'instant'})");await delay(150);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'),name+' overflow');
    const capture=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(capture.data,'base64'));
  }
  await evaluate("Array.from(document.querySelectorAll('.remix-panel button')).find(e=>e.textContent==='Exit remix').click()");await delay(100);
  assert.equal(await evaluate("document.querySelector('.remix-panel')"),null);
  await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
  assert.ok(!submitted.at(-1).abc && !submitted.at(-1).semantic_tokens);
  assert.notEqual(submitted.at(-1).lm_seed,42);
  const source=await evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('yue2-songs',1);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('songs');const get=tx.objectStore('songs').getAll();get.onsuccess=()=>resolve(get.result.map(s=>({name:s.name,request:s.request})));tx.oncomplete=()=>db.close()};open.onerror=()=>reject(open.error)})`);
  assert.equal(source.length,1);assert.equal(source[0].name,'Remix source');assert.equal(source[0].request.semantic_tokens,'1,2,3');assert.equal(source[0].request.semantic_sampling.temperature,1);
  assert.deepEqual(errors,[]);
  console.log('PASS: recent/library Remix buttons, navigation, 0/25/75 variation, same seeds and score, repeatability, original untouched, exit to fresh composition, desktop/mobile.');
} finally {
  if(ws?.readyState===WebSocket.OPEN){try{await send('Browser.close')}catch{}ws.close()}
  browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

