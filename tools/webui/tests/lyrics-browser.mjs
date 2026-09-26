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
  const lyricCalls=[];
  ws.addEventListener('message',async event=>{
    const msg=JSON.parse(event.data);if(msg.method!=='Fetch.requestPaused')return;
    const {requestId,request}=msg.params;
    let data;
    if(request.method==='OPTIONS')data={};
    else if(request.url.endsWith('/api/tags'))data={models:[{name:'lyric-test',size:100}]};
    else {lyricCalls.push(JSON.parse(request.postData));data={response:'[Verse]\nA fresh test verse with a rhythmic rhyme.'};}
    await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'content-type'},{name:'Access-Control-Allow-Methods',value:'GET, POST, OPTIONS'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
  });
  await send('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:11434/*'}]});
  await send('Page.reload');await delay(1000);
  await evaluate("document.querySelector('#lyrics-editor').open=true");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Primary lyric style\"] optgroup').children.length"),30);
  await evaluate("{const input=document.querySelector('#lyrics-editor > .lyrics-content > .field textarea');input.value='My existing lyrics';input.dispatchEvent(new Event('input',{bubbles:true}))}");
  const select=async id=>{await evaluate(`{const input=document.querySelector('[aria-label="Primary lyric style"]');input.value=${JSON.stringify(id)};input.dispatchEvent(new Event('change',{bubbles:true}))}`);await delay(80)};
  await select('pack_01_fast_punchy');
  assert.equal(await evaluate("document.querySelector('#lyrics-editor > .lyrics-content > .field textarea').value"),'My existing lyrics');
  assert.ok(await evaluate("document.querySelector('.lyric-profile-selector p').textContent.includes('compact bars')"));
  await evaluate("document.querySelector('.writer-disclosure').open=true;const topic=document.querySelector('#lyric-workbench > textarea');topic.value='Finding your voice';topic.dispatchEvent(new Event('input',{bubbles:true}))");
  await evaluate("document.querySelector('.generate-lyrics').click()");await delay(350);
  assert.equal(lyricCalls.length,1);
  assert.match(lyricCalls[0].prompt,/PRIMARY STYLE.*\n# Fast Punchy/);
  assert.match(lyricCalls[0].prompt,/## Mandatory Writing Rules/);
  assert.match(lyricCalls[0].prompt,/## Style Compliance Check/);
  assert.match(lyricCalls[0].prompt,/Finding your voice/);
  assert.match(lyricCalls[0].prompt,/rewrite|revise/);
  assert.equal(await evaluate("document.querySelector('#lyrics-editor > .lyrics-content > .field textarea').value"),'My existing lyrics','generated draft requires Use these lyrics');
  await select('pack_30_experimental_flow');
  await evaluate("document.querySelector('.generate-lyrics').click()");await delay(350);
  assert.match(lyricCalls.at(-1).prompt,/# Experimental Flow/);
  assert.doesNotMatch(lyricCalls.at(-1).prompt,/# Fast Punchy/);
  await send('Page.reload');await delay(900);
  await evaluate("document.querySelector('#lyrics-editor').open=true");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Primary lyric style\"]').value"),'pack_30_experimental_flow');
  await select('syllable_dense');
  await evaluate("document.querySelector('.writer-disclosure').open=true;document.querySelector('.generate-lyrics').click()");await delay(350);
  assert.match(lyricCalls.at(-1).prompt,/technical_rules/,'legacy engine remains usable');
  await select('pack_02_syllable_dense');
  await evaluate("document.querySelector('.writer-disclosure').open=false");
  for(const [width,height,name] of [[1440,1000,'lyrics-desktop'],[390,844,'lyrics-mobile']]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    await evaluate("document.querySelector('#lyrics-editor').scrollIntoView({block:'start',behavior:'instant'})");await delay(150);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'),name+' overflow');
    const capture=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(capture.data,'base64'));
  }
  await evaluate("document.querySelector('.generate-btn').click()");await delay(300);
  assert.doesNotMatch(submitted.at(-1).style,/Mandatory Writing Rules|Syllable Dense/,'lyric profiles do not pollute music style');
  assert.deepEqual(errors,[]);
  console.log('PASS: 30 profiles visible, style-specific full instructions sent to lyric model, draft review, existing lyrics preserved, persistence, legacy compatibility, music/lyric separation, desktop/mobile.');
} finally {
  if(ws?.readyState===WebSocket.OPEN){try{await send('Browser.close')}catch{}ws.close()}
  browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
