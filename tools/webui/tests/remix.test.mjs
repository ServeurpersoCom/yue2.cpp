import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRemix, remixRequest } from '../src/lib/remix.ts';

const request = { style:'Jazz Rap', lyrics:'Original lyrics', abc:'X:1\nK:C\nCDEF|', semantic_tokens:'1,2,3', lm_seed:42, seed:9, duration:60, abc_sampling:{temperature:.7}, semantic_sampling:{temperature:1,top_p:.95}, steps:32 };
test('remix eligibility requires saved audio codes and both original seeds', () => {
  assert.equal(canRemix({request}),true);
  assert.equal(canRemix({request:{...request,semantic_tokens:''}}),false);
  assert.equal(canRemix({request:{...request,lm_seed:-1}}),false);
  assert.equal(canRemix({request:{...request,seed:undefined}}),false);
});
test('zero variation preserves performance; positive variation keeps source identity and changes sampling', () => {
  const zero = remixRequest(request,0);
  assert.equal(zero.semantic_tokens,request.semantic_tokens);
  assert.deepEqual(zero.semantic_sampling,request.semantic_sampling);
  for (const amount of [1,25,75,100]) {
    const result=remixRequest(request,amount);
    for (const key of ['style','lyrics','abc','lm_seed','seed','duration','steps']) assert.equal(result[key],request[key]);
    assert.equal(result.semantic_tokens,undefined);
    assert.equal(result.semantic_sampling.temperature,1+amount*.005);
    assert.equal(result.semantic_sampling.top_p,.95);
    assert.deepEqual(result,remixRequest(request,amount),'same amount yields same request');
    assert.equal(result.lm_batch_size,1); assert.equal(result.synth_batch_size,1);
  }
  assert.equal(request.semantic_tokens,'1,2,3');assert.equal(request.semantic_sampling.temperature,1);
  assert.equal(remixRequest(request,NaN).semantic_tokens,'1,2,3');
  assert.equal(remixRequest(request,200).semantic_sampling.temperature,1.5);
});
