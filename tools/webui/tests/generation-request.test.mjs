import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareGeneration } from '../src/lib/generation-request.ts';

test('fresh songs omit persisted score/codes and redraw both seeds on every request', t => {
  let seed = 500;
  t.mock.method(globalThis.crypto, 'getRandomValues', array => { array[0] = seed++; return array; });
  const saved = { style: 'UK Drill', lyrics: 'Keep these lyrics', abc: 'old composition', semantic_tokens: '1,2,3', lm_seed: 42, seed: 9, duration: 90, mastering_profile: 'streaming', abc_sampling: {}, semantic_sampling: {} };
  const first = prepareGeneration(saved, true);
  const second = prepareGeneration({ ...saved, style: 'Jazz Rap' }, true);
  for (const request of [first, second]) {
    assert.ok(!('abc' in request)); assert.ok(!('semantic_tokens' in request));
    assert.equal(request.lyrics, saved.lyrics); assert.equal(request.duration, 90);
    assert.equal(request.mastering_profile, 'streaming');
  }
  assert.equal(first.style, 'UK Drill'); assert.equal(second.style, 'Jazz Rap');
  assert.deepEqual([first.lm_seed, first.seed, second.lm_seed, second.seed], [500,501,502,503]);
  assert.equal(saved.abc, 'old composition'); assert.equal(saved.semantic_tokens, '1,2,3');
  assert.deepEqual(prepareGeneration(saved, false), saved, 'explicit reuse preserves replay data');
});
