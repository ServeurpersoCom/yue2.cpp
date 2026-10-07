import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { discoverLyricModels, writeLyrics } from '../src/lib/ollama.ts';
import { angleInfluence, clampInfluence, cleanMix, freeformMusicPrompt, musicPrompt } from '../src/lib/style-mix.ts';
import { validateArtwork, MAX_ARTWORK_BYTES } from '../src/lib/artwork.ts';
import { automaticProfile, applyAutomaticSettings, hasManualSettings } from '../src/lib/auto-settings.ts';

test('automatic settings follow active music weights and preserve replay identity', () => {
  const rhythmic = automaticProfile(['modern_trap'], { modern_trap: 100 }, '');
  const harmonic = automaticProfile(['jazz_noir'], { jazz_noir: 100 }, '');
  assert.equal(rhythmic.scoreTemperature, .65);
  assert.equal(harmonic.scoreTemperature, .75);
  const blended = automaticProfile(['modern_trap','jazz_noir'], {modern_trap:50,jazz_noir:50}, '');
  assert.equal(blended.scoreTemperature, .7);
  assert.equal(automaticProfile(['modern_trap','jazz_noir'], {modern_trap:0,jazz_noir:100}, '').scoreTemperature,.75);
  assert.equal(automaticProfile(['modern_trap'], {modern_trap:0}, 'trap').scoreTemperature,.7);
  const request = {style:'Trap',abc_sampling:{temperature:1.1},semantic_sampling:{},abc:'score',semantic_tokens:'1,2,3',lm_seed:42,seed:8,duration:0,output_format:'wav24',lm_batch_size:2};
  const result = applyAutomaticSettings(request, rhythmic);
  for(const field of ['abc','semantic_tokens','lm_seed','seed','duration','output_format','lm_batch_size']) assert.equal(result[field],request[field]);
  assert.equal(result.abc_sampling.temperature,.65);
  assert.equal(request.abc_sampling.temperature,1.1,'source request is not mutated');
  assert.equal(result.semantic_sampling.temperature,1,'codec sampler stays at model default');
  assert.equal(result.mp3_bitrate,320);
  assert.equal(hasManualSettings(request),true);
  assert.equal(hasManualSettings({style:'',abc_sampling:{},semantic_sampling:{}}),false);
});

test('artwork rejects unsupported, empty, oversized and undecodable uploads', async () => {
  await assert.rejects(validateArtwork(new Blob(['x'], { type: 'image/svg+xml' })), /PNG, JPEG or WebP/);
  await assert.rejects(validateArtwork(new Blob([], { type: 'image/png' })), /20 MB/);
  await assert.rejects(validateArtwork(new Blob([new Uint8Array(MAX_ARTWORK_BYTES + 1)], { type: 'image/png' })), /20 MB/);
  const original = globalThis.createImageBitmap;
  try {
    globalThis.createImageBitmap = async () => { throw new Error('Invalid image'); };
    await assert.rejects(validateArtwork(new Blob(['x'], { type: 'image/png' })), /could not be decoded/);
    let closed = 0;
    globalThis.createImageBitmap = async () => ({ width: 800, height: 800, close: () => { closed++; } });
    await validateArtwork(new Blob(['x'], { type: 'image/png' }));
    assert.equal(closed, 1);
    globalThis.createImageBitmap = async () => ({ width: 9000, height: 9000, close: () => { closed++; } });
    await assert.rejects(validateArtwork(new Blob(['x'], { type: 'image/png' })), /64 megapixels/);
    assert.equal(closed, 2);
  } finally { globalThis.createImageBitmap = original; }
});

test('mixer sanitizes persisted state and permits exact zero and hundred', () => {
  assert.equal(clampInfluence(0), 0);
  assert.equal(clampInfluence(100), 100);
  assert.equal(clampInfluence(NaN), 50);
  assert.equal(clampInfluence(1000), 100);
  assert.deepEqual(cleanMix(['a', 'a', '', 'missing'], { a: 0 }, ['a']), { ids: ['a'], weights: { a: 0 } });
});

test('music prompt sends direct style strengths, descriptions, and excludes zero styles', () => {
  const descriptions = { a: 'Warm acoustic strings.', b: 'Metallic percussion.' };
  const names = [['a', 'Acoustic'], ['b', 'Industrial']];
  const one = musicPrompt(['a', 'b'], { a: 50, b: 0 }, descriptions, names);
  assert.match(one, /Acoustic \(50\/100 strength\): Warm acoustic strings\./);
  assert.doesNotMatch(one, /Industrial/);
  assert.equal(musicPrompt([], { a: 50 }, descriptions, names), '');
  const mix = musicPrompt(['a', 'b'], { a: 25, b: 75 }, descriptions, names);
  assert.match(mix, /Acoustic \(25\/100 strength\)/);
  assert.match(mix, /Industrial \(75\/100 strength\)/);
  assert.doesNotMatch(musicPrompt(['b'], { a: 50, b: 50 }, descriptions, names), /Acoustic/);
});

test('freeform music strength changes the exact style instructions sent with generation', () => {
  assert.match(freeformMusicPrompt('Bar-heavy punchline craft', 35), /35\/100 strength/);
  assert.match(freeformMusicPrompt('Bar-heavy punchline craft', 35), /Bar-heavy punchline craft/);
  assert.equal(freeformMusicPrompt('Bar-heavy punchline craft', 0), '');
  assert.equal(freeformMusicPrompt('   ', 100), '');
});

test('circular input uses clockwise angle from twelve oclock', () => {
  assert.equal(angleInfluence(0, -1), 0);
  assert.equal(angleInfluence(1, 0), 25);
  assert.equal(angleInfluence(0, 1), 50);
  assert.equal(angleInfluence(-1, 0), 75);
});

test('all lyric files parse without accidental null fields', () => {
  const root = new URL('../../../lyric_styles/', import.meta.url);
  const files = readdirSync(root).filter(f => f.endsWith('.yaml'));
  assert.equal(files.length, 11);
  function validate(value, path) {
    assert.notEqual(value, null, path);
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) validate(child, `${path}.${key}`);
    }
  }
  for (const file of files) validate(parse(readFileSync(new URL(file, root), 'utf8')), file);
});

test('discovery orders installed models by size; generation uses selected model', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ models: [{ name: 'large', size: 20 }, { name: 'small', size: 10 }] });
    assert.equal((await discoverLyricModels())[0].name, 'small');
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'small');
      assert.equal(body.keep_alive, 0);
      assert.equal(body.think, false);
      return Response.json({ response: '  [Verse]\nA specific scene  ' });
    };
    assert.equal(await writeLyrics('small', 'topic', new AbortController().signal), '[Verse]\nA specific scene');
    globalThis.fetch = async () => Response.json({ error: 'model unavailable' }, { status: 404 });
    await assert.rejects(writeLyrics('missing', 'topic', new AbortController().signal), /model unavailable/);
    globalThis.fetch = async () => Response.json({ response: '' });
    await assert.rejects(writeLyrics('small', 'topic', new AbortController().signal), /Existing lyrics preserved/);
  } finally { globalThis.fetch = original; }
});
