import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(specifier,context,next){
 if(specifier.endsWith('.js') && context.parentURL?.includes('/src/lib/')) {
  const url=new URL(specifier.replace(/\.js$/,'.ts'),context.parentURL);
  if(existsSync(fileURLToPath(url))) return {url:url.href,shortCircuit:true};
 }
 return next(specifier,context);
}});
const {validRequest,validSong}=await import('../src/lib/validation.ts');
const {validatePresets}=await import('../src/lib/saved-presets.ts');
const {exportLibrary,importLibrary}=await import('../src/lib/backup.ts');
test('request validation rejects malformed persisted fields and retains numeric legacy values',()=>{
 assert.throws(()=>validRequest({style:42}),/style/);
 assert.throws(()=>validRequest({abc_sampling:[]}),/sampling/);
 assert.throws(()=>validRequest({duration:'infinity'}),/duration/);
 assert.equal(validRequest({style:'Jazz',duration:'120'}).duration,120);
 assert.equal(validRequest({}).style,'');
});
test('backup songs require valid UI fields and draft metadata',()=>{
 const song={name:'Track',style:'Jazz',format:'mp3',duration:10,created:1,seed:0,request:{},audio:new Blob(['audio'],{type:'audio/mpeg'})};
 assert.equal(validSong(song).request.style,'');
 assert.throws(()=>validSong({...song,format:undefined}),/format/);
 assert.throws(()=>validSong({...song,youtubeDraft:{title:42}}),/draft/);
 assert.throws(()=>validSong({...song,musicStyles:[{}]}),/musicStyles/);
});
test('preset schema rejects invalid names, weights and duplicate names',()=>{
 const p={name:'My blend',kind:'music',data:{ids:['jazz'],weights:{jazz:50}}};
 assert.equal(validatePresets([p]).length,1);
 assert.throws(()=>validatePresets([{...p,name:'../escape'}]),/Invalid/);
 assert.throws(()=>validatePresets([{...p,data:{ids:[],weights:{jazz:NaN}}}]),/Invalid/);
 assert.throws(()=>validatePresets([p,{...p,name:'MY BLEND'}]),/Duplicate/);
});
test('version 2 backup includes disk presets and current settings; corrupt request fails before restore',async()=>{
 const originalFetch=globalThis.fetch, originalStorage=globalThis.localStorage;
 const presets=[{name:'Jazz',kind:'music',data:{ids:['jazz'],weights:{jazz:100}}}];
 let corrupt=false;
 globalThis.localStorage={getItem:key=>key==='yue2'?JSON.stringify({request:{style:corrupt?42:'Jazz'}}):key==='yue2-theme'?'mint':null};
 globalThis.fetch=async()=>new Response(JSON.stringify(presets),{headers:{'Content-Type':'application/json'}});
 try {
  const song={name:'Track',style:'Jazz',format:'mp3',duration:10,created:1,seed:0,request:{style:'Jazz'},audio:new Blob(['audio'],{type:'audio/mpeg'})};
  const restored=await importLibrary(await exportLibrary([song]));
  assert.deepEqual(restored.presets,presets);
  assert.equal(restored.settings['yue2-theme'],'mint');
  assert.equal(await restored.songs[0].audio.text(),'audio');
  corrupt=true;
  await assert.rejects(importLibrary(await exportLibrary([song])),/style/);
 } finally {globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
