import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProducer, applyProducer, delivery, estimatedDuration, lyricGuidance, lyricWarnings } from '../src/lib/producer.ts';
import { prepareGeneration } from '../src/lib/generation-request.ts';

const base = {style:'Soul', lyrics:'[Verse]\nWe carry light into the morning\n[Chorus]\nCarry me home', duration:0, abc_sampling:{}, semantic_sampling:{}};
test('instrumental renders omit words without destroying the source lyrics', () => {
 const result = applyProducer(base, cleanProducer({presence:0}));
 assert.equal(result.lyrics, '');
 assert.match(base.lyrics, /carry light/);
 assert.match(result.style, /Instrumental only/);
 assert.doesNotMatch(result.style, /Requested cast/);
 assert.match(lyricWarnings(cleanProducer({presence:0}), base.lyrics)[0], /preserved/);
});
test('delivery endpoints and voice cast reach music and lyric directions', () => {
 assert.match(delivery(cleanProducer({singing:0})), /no melodic singing/);
 assert.match(delivery(cleanProducer({singing:100})), /no rap/);
 const p = cleanProducer({singing:50,voices:2,voiceLocked:true,voiceProfiles:['Warm low lead','Airy upper lead'],bpm:88});
 const result = applyProducer(base,p);
 const prompt = lyricGuidance(p,base.style,150);
 for (const text of [result.style,prompt]) {
  assert.match(text,/2 distinct vocal voices/);
  assert.match(text,/Voice 2: Airy upper lead/);
  assert.match(text,/88 BPM/);
 }
 assert.match(prompt,/150 seconds/);
 assert.match(prompt,/breathing space/);
 const a=prepareGeneration(result,true),b=prepareGeneration(result,true);
 assert.equal(a.style,b.style,'locked profiles remain stable while takes vary');
 assert.notEqual(a.lm_seed,b.lm_seed);
 assert.notEqual(a.seed,b.seed);
 assert.equal(applyProducer(result,p).style,result.style,'reusing a generated prompt does not duplicate direction');
 const emptyStyle=applyProducer({...base,style:''},p);
 assert.equal(applyProducer(emptyStyle,p).style,emptyStyle.style);
 assert.match(applyProducer(base,{...p,singing:55}).style,/55% melodic singing/);
});
test('duration accounts for tempo, delivery and instrumental space but preserves explicit length', () => {
 const lyrics=Array(16).fill('We carry light into the morning').join('\n');
 const p=cleanProducer();
 assert.ok(estimatedDuration({...p,bpm:60},lyrics)>estimatedDuration({...p,bpm:120},lyrics));
 assert.ok(estimatedDuration({...p,presence:40},lyrics)>estimatedDuration({...p,presence:90},lyrics));
 assert.equal(estimatedDuration(p,lyrics),estimatedDuration(p,'[Verse]\n'+lyrics));
 assert.equal(applyProducer({...base,duration:123},p).duration,123);
 assert.equal(applyProducer(base,{...p,enabled:false}),base);
});
test('persisted controls are bounded and independent', () => {
 const p=cleanProducer({bpm:NaN,voices:99,takes:100,singing:-2,presence:101});
 assert.equal(p.bpm,100);assert.equal(p.voices,4);assert.equal(p.takes,1);assert.equal(p.singing,0);assert.equal(p.presence,100);
 const a=cleanProducer(),b=cleanProducer();a.voiceProfiles[0]='changed';assert.notEqual(a.voiceProfiles[0],b.voiceProfiles[0]);
});
