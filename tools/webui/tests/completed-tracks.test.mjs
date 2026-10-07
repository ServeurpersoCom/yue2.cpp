import test from 'node:test';
import assert from 'node:assert/strict';
import { completedTracks } from '../src/lib/completed-tracks.ts';

const track = profile => ({ request: { style: '', abc_sampling: {}, semantic_sampling: {}, ...(profile === undefined ? {} : { mastering_profile: profile }) }, audio: new Blob([profile ?? 'dry']) });
test('sparse original and master land as one song with both audio versions', () => {
  for (const profile of ['streaming', 'broadcast']) {
    for (const off of [undefined, 'off']) {
      const dry = track(off), master = track(profile);
      const result = completedTracks([dry, master]);
      assert.equal(result.length, 1);
      assert.equal(result[0].audio, master.audio);
      assert.equal(result[0].originalAudio, dry.audio);
    }
  }
});
test('unmastered batches remain separate songs', () => {
  const tracks = [track(), track()];
  assert.deepEqual(completedTracks(tracks), tracks);
});
test('multiple mastered songs retain their own original audio', () => {
  const a = track(), b = track('streaming'), c = track(), d = track('streaming');
  const result = completedTracks([a, b, c, d]);
  assert.equal(result.length, 2);
  assert.equal(result[0].originalAudio, a.audio);
  assert.equal(result[1].originalAudio, c.audio);
  assert.equal(result[1].audio, d.audio);
});
