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
  assert.equal(await evaluate("document.querySelectorAll('.style-tile').length"), 103);
  const stripBox = await evaluate("(()=>{const r=document.querySelector('.preset-discovery').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
  const mouseX = stripBox.x + stripBox.width - 25, mouseY = stripBox.y + 35;
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:mouseX,y:mouseY});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:mouseX,y:mouseY,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:mouseX-180,y:mouseY,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:mouseX-180,y:mouseY,button:'left',clickCount:1});
  await delay(100);
  assert.ok(await evaluate("document.querySelector('.preset-discovery').scrollLeft > 100"), 'mouse drag scrolls');
  assert.equal(await evaluate("document.querySelectorAll('.remove-selected-style').length"),0,'drag must not select a style');
  const beforeWheel = await evaluate("document.querySelector('.preset-discovery').scrollLeft");
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:mouseX,y:mouseY,deltaX:0,deltaY:230}); await delay(150);
  assert.ok(await evaluate("document.querySelector('.preset-discovery').scrollLeft") > beforeWheel, 'vertical wheel scrolls styles horizontally');
  await evaluate("document.querySelector('.preset-discovery').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});await delay(100);
  assert.ok(await evaluate("(()=>{const e=document.querySelector('.preset-discovery');return e.scrollLeft + e.clientWidth >= e.scrollWidth-2})()"),'last style reachable');
  await evaluate("document.querySelector('.preset-discovery').scrollLeft=0");
  assert.equal(await evaluate("document.querySelectorAll('.selected-style-slot').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('.empty-style-slot').length"), 3);
  assert.equal(await evaluate("document.querySelector('.brief-column textarea')"), null);
  await evaluate("document.querySelector('.empty-style-slot').click()");
  assert.ok(await evaluate("document.activeElement.classList.contains('style-search')"));
  for (const name of ['Boom Bap', 'Underground Hip-Hop', 'Lo-Fi Hip-Hop', 'Jazz Rap']) {
    await evaluate(`Array.from(document.querySelectorAll('.style-tile')).find(e=>e.querySelector('strong').textContent===${JSON.stringify(name)}).click()`);
    await delay(70);
  }
  assert.equal(await evaluate("document.querySelectorAll('.remove-selected-style').length"), 3);
  await evaluate("document.querySelector('.generate-btn').click()");
  await delay(400);
  assert.equal(submitted.length, 1);
  assert.match(submitted[0].style, /Boom Bap/);
  assert.match(submitted[0].style, /Underground Hip-Hop/);
  assert.match(submitted[0].style, /Lo-Fi Hip-Hop/);
  assert.doesNotMatch(submitted[0].style, /Purpose|Context Guidance|generation brief|Production Priorities/);
  assert.ok(submitted[0].style.length < 3500);
  console.log('Submitted three-style prompt:', submitted[0].style.length, 'characters');
  await evaluate("document.querySelector('.blend-disclosure').open=true;document.querySelector('.music-mixer [role=slider]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");
  await delay(100);
  await evaluate("document.querySelector('.generate-btn').click()");
  await delay(300);
  assert.doesNotMatch(submitted.at(-1).style, /Boom Bap/);
  assert.match(submitted.at(-1).style, /Primary style — Underground/);
  await evaluate("document.querySelector('.remove-selected-style').click()");
  await delay(100);
  assert.equal(await evaluate("document.querySelectorAll('.empty-style-slot').length"), 1);
  await send('Page.reload'); await delay(1000);
  assert.equal(await evaluate("document.querySelectorAll('.remove-selected-style').length"), 2);
  // Simulate the old persisted long prompt and an oversized saved blend.
  await evaluate(`{
    const mix=JSON.parse(localStorage.getItem('yue2-style-mix-v1'));
    mix.musicIds=['003_underground_hip_hop','032_uk_drill','048_soul_hip_hop','022_trap'];
    mix.musicWeights=Object.fromEntries(mix.musicIds.map(id=>[id,50]));
    mix.musicPrompt='Hip-hop generation brief for YuE2. These are full style profiles; legacy boilerplate';
    const state=JSON.parse(localStorage.getItem('yue2'));state.request.style=mix.musicPrompt;
    localStorage.setItem('yue2',JSON.stringify(state));localStorage.setItem('yue2-style-mix-v1',JSON.stringify(mix));
  }`);
  await send('Page.reload'); await delay(1000);
  assert.equal(await evaluate("document.querySelectorAll('.remove-selected-style').length"), 3);
  await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
  assert.doesNotMatch(submitted.at(-1).style,/legacy boilerplate|These are full|Primary style — Trap/);
  assert.match(submitted.at(-1).style,/UK Drill/);
  // Existing browser drafts may contain a completed score, audio codes and fixed seeds.
  await evaluate(`{const state=JSON.parse(localStorage.getItem('yue2'));Object.assign(state.request,{abc:'X:1\\nK:C\\nCDEF|',semantic_tokens:'1,2,3',lm_seed:42,seed:9});localStorage.setItem('yue2',JSON.stringify(state));}`);
  await send('Page.reload');await delay(1000);
  await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
  const freshOne = submitted.at(-1);
  assert.ok(!freshOne.abc && !freshOne.semantic_tokens);
  await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
  assert.notEqual(submitted.at(-1).lm_seed,freshOne.lm_seed);
  assert.notEqual(submitted.at(-1).seed,freshOne.seed);
  assert.ok(!submitted.at(-1).abc && !submitted.at(-1).semantic_tokens);
  await evaluate("document.querySelector('[aria-label=\"New composition each time\"]').click()");
  await delay(100);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"New composition each time\"]').checked"),false);
  await evaluate("window.dispatchEvent(new CustomEvent('yue2-select-style',{detail:'022_trap'}))");await delay(100);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"New composition each time\"]').checked"),true,'changing style exits reuse');
  await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
  assert.match(submitted.at(-1).style,/Primary style.*Trap/);
  assert.ok(!submitted.at(-1).abc && !submitted.at(-1).semantic_tokens);
  for (const [width,height,name] of [[1916,966,'styles-desktop'],[1280,800,'styles-laptop'],[390,844,'styles-mobile']]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    await evaluate("document.querySelector('.center-scroll').scrollTo({top:0,behavior:'instant'})");await delay(150);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), name);
    assert.ok(await evaluate("document.querySelector('.selected-style-slots').scrollWidth <= document.querySelector('.selected-style-slots').clientWidth"),name+' slots overflow');
    const capture=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(capture.data,'base64'));
  }
  await evaluate("document.querySelector('.blend-disclosure').open=true;document.querySelector('.custom-direction').open=true;const input=document.querySelector('.custom-direction textarea');input.value='Warm piano and soft drums';input.dispatchEvent(new Event('input',{bubbles:true}))");await delay(100);
  assert.equal(await evaluate("document.querySelectorAll('.empty-style-slot').length"), 3);
  await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
  assert.match(submitted.at(-1).style,/Warm piano and soft drums/);
  assert.deepEqual(errors, []);
  console.log('PASS: empty/selected slots, maximum three, removal, zero strength, actual generation payload, reload, legacy migration, custom direction, desktop/mobile layout.');
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} ws.close(); }
  browser.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
