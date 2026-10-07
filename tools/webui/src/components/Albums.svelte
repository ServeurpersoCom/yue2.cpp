<script lang="ts">
 import {albumControl} from '../lib/album-control.svelte.js';
 import {onMount} from 'svelte';
 import {app,toast} from '../lib/state.svelte.js';
 import {listAlbums,saveAlbum} from '../lib/album-db.js';
 import {trackFromLyrics} from '../lib/album-plan.js';
 import {runAlbum} from '../lib/album-runner.js';
 import {withStudioLock} from '../lib/coordination.js';
 import {applyProducer} from '../lib/producer.js';
 import {buildSparse} from '../lib/fields.js';
 import {getAllSongs,updateSong} from '../lib/db.js';
 import {createZip,exportLibrary} from '../lib/backup.js';
 import type {Album} from '../lib/album-types.js';
 let albums=$state<Album[]>([]),title=$state(''),visual=$state('Cinematic urban illustration, warm neon, rich texture'),video=$state(true),artwork=$state(true);
 let busy=$derived(!!albumControl.active);
 let files:HTMLInputElement;
 async function refresh(){albums=await listAlbums();}
 onMount(()=>{void refresh().catch(e=>toast(String(e)));});
 async function create(event:Event){const input=event.currentTarget as HTMLInputElement,selected=[...(input.files??[])];input.value='';if(!selected.length)return;
  try{if(!title.trim())throw new Error('Give the album a title first.');if(selected.length>30)throw new Error('Use up to 30 lyric files per album.');
   const tracks=await Promise.all(selected.map(async file=>trackFromLyrics(file.name,await file.text())));
   await saveAlbum({id:crypto.randomUUID(),version:1,title:title.trim(),created:Date.now(),updated:Date.now(),request:applyProducer(buildSparse($state.snapshot(app.request)),$state.snapshot(app.producer)),visualStyle:visual,artwork,video,seed:crypto.getRandomValues(new Uint32Array(1))[0]%2147483647,tracks,status:'draft',stage:'Ready to generate'});await refresh();
  }catch(e){toast(String(e));}
 }
 async function start(album:Album){if(busy)return;albumControl.active=album.id;albumControl.pause=false;try{const result=await withStudioLock(()=>runAlbum($state.snapshot(album),()=>albumControl.pause,()=>{void refresh();}));if(!result.acquired)toast('Another Studio operation is running.');app.songs=(await getAllSongs()).reverse();}catch(e){toast(String(e));}finally{albumControl.active='';await refresh();}}
 async function retry(album:Album,index:number,stage:'audio'|'artwork'|'video'){const copy=$state.snapshot(album),track=copy.tracks[index];if(stage==='audio'&&!track.songId)track.jobId=undefined;if(stage==='artwork'){track.artJobId=undefined;track.artDone=false;track.videoDone=false;if(track.songId)await updateSong(track.songId,{artworkJobId:undefined});if(!copy.cover)copy.coverJobId=undefined;}if(stage==='video'){track.videoJobId=undefined;track.videoDone=false;}await saveAlbum(copy);await start(copy);}
 async function download(album:Album){try{const songs=(await getAllSongs()).filter(s=>s.albumId===album.id).sort((a,b)=>(a.trackNumber??0)-(b.trackNumber??0));const snapshot=$state.snapshot(album);const {cover,...plan}=snapshot;const entries=[{name:'album.json',blob:new Blob([JSON.stringify(plan,null,2)],{type:'application/json'})},{name:'library-backup.zip',blob:await exportLibrary(songs,[$state.snapshot(album)])}];if(cover)entries.push({name:'master-cover.png',blob:cover});for(const song of songs){const stem=String(song.trackNumber??0).padStart(2,'0')+'-'+song.name.replace(/[\\/:*?"<>|]/g,'');entries.push({name:stem+'.'+(song.audio.type.includes('mpeg')?'mp3':'wav'),blob:song.audio});if(song.video)entries.push({name:stem+'.mp4',blob:song.video});}
  const url=URL.createObjectURL(await createZip(entries)),a=document.createElement('a');a.href=url;a.download=album.title.replace(/[\\/:*?"<>|]/g,'')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){toast(String(e));}}
</script>
<section id="albums" class="albums">
 <h2>Albums</h2><p>Import one lyric file per track. Uses the current sound and voice plan. Audio is saved as MP3. Progress is saved after every stage.</p>
 <label>Album title<input bind:value={title} maxlength="150" /></label>
 <label>Shared visual direction<textarea bind:value={visual} rows="2"></textarea></label>
 <label><input type="checkbox" bind:checked={artwork}/> Generate master cover and referenced track artwork</label>
 <label><input type="checkbox" bind:checked={video}/> Export MP4 for each track</label>
 <button disabled={busy||!title.trim()} onclick={()=>files.click()}>Create album from lyric files</button><input hidden type="file" accept=".txt,.md" multiple bind:this={files} onchange={create}/>
 {#if busy}<button onclick={()=>{albumControl.pause=true;toast('Album will pause after the current stage is safely saved.');}}>Pause after current stage</button>{/if}
 {#each albums as album (album.id)}<article><h3>{album.title}</h3><p role="status">{album.stage} · {album.tracks.filter(t=>t.songId).length}/{album.tracks.length} audio tracks saved</p>{#if album.error}<p role="alert">{album.error}</p>{/if}
 <button disabled={busy||album.status==='complete'} onclick={()=>start(album)}>{album.status==='draft'?'Generate album':'Resume album'}</button><button disabled={busy} onclick={()=>download(album)}>Export album ZIP</button>
 <ol>{#each album.tracks as track,index}<li><strong>{track.title}</strong> · {track.songId?'Audio saved':'Audio pending'}{album.artwork||album.video?` · Artwork ${track.artDone?'saved':'pending'}`:''}{album.video?` · Video ${track.videoDone?'saved':'pending'}`:''}
 {#if album.error}<button disabled={busy||!!track.songId} onclick={()=>retry(album,index,'audio')}>Retry audio</button><button disabled={busy} onclick={()=>retry(album,index,'artwork')}>Retry artwork</button><button disabled={busy} onclick={()=>retry(album,index,'video')}>Retry video</button>{/if}</li>{/each}</ol></article>{/each}
</section>
<style>.albums{display:grid;gap:.7rem;padding:1rem;background:var(--bg-card);border:1px solid var(--border-strong);border-radius:var(--radius);margin-bottom:1rem}label{display:grid;gap:.3rem}input,textarea,button{padding:.6rem;border:1px solid var(--border);border-radius:8px;background:var(--bg-input);color:var(--fg)}article{padding:1rem;border:1px solid var(--border);border-radius:12px;background:var(--bg-card-2)}li{padding:.5rem}p{color:var(--fg-dim)}button{cursor:pointer}button:disabled{opacity:.5}</style>
