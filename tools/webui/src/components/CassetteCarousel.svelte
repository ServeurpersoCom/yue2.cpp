<script lang="ts">
 import { onDestroy, tick } from 'svelte';
 import { app } from '../lib/state.svelte.js';
 import { player, selectTrack, resume } from '../lib/player.svelte.js';
 import type { Song } from '../lib/types.js';
 let current = $derived(Math.max(0, app.songs.findIndex(song => song.id === player.song?.id)));
 let stage: HTMLDivElement | undefined;
 let turning = $state(false), timer: ReturnType<typeof setTimeout>, lastWheel = 0, pointerX = 0, swiped = false;
 let tapes = $derived(app.songs.length ? app.songs : [null]);
 let visibleTapes = $derived(tapes.map((song,index) => ({song,index,distance:offset(index)})).filter(tape => Math.abs(tape.distance) <= 2));
 function offset(index: number) {
  let distance = index - current;
  if (distance > tapes.length / 2) distance -= tapes.length;
  if (distance < -tapes.length / 2) distance += tapes.length;
  return distance;
 }
 function choose(song: Song | null) {
  if (!song) return;
  selectTrack(song); void resume();
 }
 function turn(direction: number) {
  if (app.songs.length < 2) return;
  choose(app.songs[(current + direction + app.songs.length) % app.songs.length]);
 }
 $effect(() => { current; turning = true; clearTimeout(timer); timer = setTimeout(() => turning = false, 650); });
 onDestroy(() => clearTimeout(timer));
 function wheel(event: WheelEvent) {
  if (app.songs.length < 2) return;
  event.preventDefault();
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (Math.abs(delta) < 8 || performance.now() - lastWheel < 450) return;
  lastWheel = performance.now(); turn(delta > 0 ? 1 : -1);
 }
 function key(event: KeyboardEvent) {
  if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
  event.preventDefault(); turn(event.key === 'ArrowRight' ? 1 : -1);
  // keep keyboard focus on the cassette that is now in the slot
  void tick().then(() => stage?.querySelector<HTMLButtonElement>('.cassette.chosen')?.focus());
 }
 function tiles(seed: number) {
  return Array.from({length:80}, (_,i) => ({x:13+(i%16)*9,y:12+Math.floor(i/16)*8,hue:(seed*47+(i*37)%130)%360,on:((i*17+seed*13)%7)<4}));
 }
</script>

<div class="cassette-carousel" class:turning role="group" aria-label="Cassette track carousel" aria-roledescription="carousel" onwheel={wheel}>
 <div class="carousel-stage" bind:this={stage} onpointerdown={event => { pointerX = event.clientX; swiped = false; }} onpointerup={event => { if (Math.abs(event.clientX-pointerX)>30) { swiped = true; turn(event.clientX<pointerX?1:-1); } }} role="presentation">
  {#each visibleTapes as {song,index,distance} (song?.id ?? index)}
   <button class="cassette" class:chosen={distance===0} class:spinning={(distance===0 && player.playing) || turning} style={`--offset:${distance};--scale:${1-Math.abs(distance)*.12};--angle:${distance*-34}deg;z-index:${10-Math.abs(distance)};opacity:${Math.abs(distance)>2?0:1-Math.abs(distance)*.25}`} aria-label={song ? `Play cassette ${song.name}` : 'No tracks saved'} onkeydown={key} aria-current={distance===0?'true':undefined} tabindex={distance===0?0:-1} disabled={!song} onclick={event => { if (!swiped || event.detail===0) choose(song); swiped = false; }} title={song?.name || 'Your next record'}>
    <svg viewBox="0 0 170 108" aria-hidden="true">
     <rect x="2" y="2" width="166" height="104" rx="10" fill="#101115" stroke="#7d818a" stroke-width="2"/>
     <rect x="7" y="7" width="156" height="76" rx="5" fill="#242630" stroke="#545762"/>
     {#each tiles(song?.id ?? index+1) as tile}{#if tile.on}<rect x={tile.x} y={tile.y} width="8" height="7" fill={`hsl(${tile.hue} 60% 62%)`} opacity=".85"/>{/if}{/each}
     <path d="M36 87H134L145 105H25Z" fill="#191b21" stroke="#5d5f69"/>
     <path d="M42 94H128M39 98H131M35 102H135" stroke="#555762" stroke-width="1"/>
     <rect x="30" y="30" width="110" height="39" rx="19" fill="#121318" stroke="#929198" stroke-width="2"/>
     <rect x="71" y="39" width="28" height="21" rx="3" fill="#585854" stroke="#151515"/>
     {#each [76,81,86,91,96] as x}<path d={`M${x} 41V58`} stroke="#1b1b1b" stroke-width="2"/>{/each}
     {#each [49,121] as x}
      <g class="reel"><circle cx={x} cy="49" r="14" fill="#e2dfcc" stroke="#9e9b94"/><circle cx={x} cy="49" r="8" fill="#202026"/>{#each [0,60,120,180,240,300] as angle}<path d={`M${x-2} 36h4v6h-4Z`} fill="#26252a" transform={`rotate(${angle} ${x} 49)`}/>{/each}</g>
     {/each}
     {#each [[9,9],[161,9],[9,98],[161,98]] as [x,y]}<circle cx={x} cy={y} r="2" fill="#b2b5bc"/><path d={`M${x-1} ${y-1}l2 2`} stroke="#35363c"/>{/each}
     <text x="12" y="92" fill="#c4c4cf" font-size="6" font-family="monospace">A</text><text x="158" y="92" text-anchor="end" fill="#a3a3ac" font-size="5" font-family="monospace">YUE / 2</text>
    </svg>
   </button>
  {/each}
 </div>
</div>

<style>
 .cassette-carousel{--cassette-w:94px;--cassette-h:60px;--cassette-step:88px;height:calc(var(--cassette-h) + 4px);min-width:0;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}
 .carousel-stage{height:100%;position:relative;touch-action:pan-y}
 .cassette{position:absolute;left:50%;top:2px;width:var(--cassette-w);height:var(--cassette-h);padding:0;border:0;background:none;cursor:pointer;transform:translateX(calc(-50% + var(--offset)*var(--cassette-step))) perspective(500px) rotateY(var(--angle)) scale(var(--scale));transition:transform .65s cubic-bezier(.22,.8,.2,1),opacity .5s;filter:drop-shadow(0 4px 3px #0009)}
 .cassette svg{width:100%;height:100%;display:block}.cassette:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-radius:5px}.cassette:disabled{cursor:default;opacity:.55!important}
 .reel{transform-box:fill-box;transform-origin:center;animation:reel-spin 1.7s linear infinite;animation-play-state:paused}.spinning .reel{animation-play-state:running}
 @keyframes reel-spin{to{transform:rotate(360deg)}}
 @media(prefers-reduced-motion:reduce){.cassette{transition:none}.reel{animation:none}}
</style>
