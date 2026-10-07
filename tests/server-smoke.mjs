// Read-only API checks against a temporary CPU server, never the user's live port.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value]));
env.GGML_BACKEND = 'CPU';
const child = spawn(process.argv[2] || `${root}build/audit-repair/yue-server.exe`, [
  '--host', '127.0.0.1', '--port', '18087', '--max-seq', '512',
  '--model', 'models/YuE2-3B-Q8_0.gguf', '--vae', 'models/YuE2-Vae-F32.gguf'
], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
let startupError;
child.on('error', error => { startupError = error; });
const base = 'http://127.0.0.1:18087';
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { ready = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Temporary server failed to start: ${logs}`);
  const props = await (await fetch(`${base}/props`)).json();
  assert.equal(props.defaults.mp3_bitrate, 320);
  assert.equal(props.sample_rate, 48000);
  for (const request of [{ steps: 201 }, { duration: 601 }, { duration: -2 }, { cfg_scale: 31 }, { peak_clip: 1000 }, { output_format: 'mp3', mp3_bitrate: 321 }]) {
    const response = await fetch(`${base}/synth`, { method: 'POST', body: JSON.stringify(request) });
    assert.equal(response.status, 400, JSON.stringify(request));
    assert.ok((await response.json()).error);
  }
  const oversized = await fetch(`${base}/synth`, { method: 'POST', body: JSON.stringify({ lyrics: 'a'.repeat(1024 * 1024) }) });
  assert.equal(oversized.status, 413);
  const ui = await (await fetch(`${base}/`, { headers: { 'Accept-Encoding': 'gzip' } })).text();
  assert.ok(ui.includes('Relative') || ui.includes('relative influence'));
  assert.ok(ui.includes('Ollama model'));
  if (process.argv[2]) assert.ok(ui.includes('Lock voice profiles across songs'));
  console.log('PASS: temporary CPU server; 320 kbps/48 kHz defaults; six invalid requests; oversized request; embedded updated UI. No songs generated.');
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
