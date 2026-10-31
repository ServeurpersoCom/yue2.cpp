<script lang="ts">
 import { Play, Pause, SkipBack, SkipForward, Volume2, Volume1, VolumeX, LoaderCircle } from '@lucide/svelte';
 import CassetteCarousel from './CassetteCarousel.svelte';
 import ReactiveSpeaker from './ReactiveSpeaker.svelte';
 import { app } from '../lib/state.svelte.js';
 import { player, resume, pause, seek, toggleTrack, selectTrack, setVolume } from '../lib/player.svelte.js';
 let lastVolume = .5;
 $effect(() => { setVolume(app.volume); });
 function mute() { if (app.volume > 0) { lastVolume = app.volume; app.volume = 0; } else app.volume = lastVolume || .5; }
 function play() { if (player.playing || player.loading) pause(); else if (player.song) void resume(); else if (app.songs[0]) toggleTrack(app.songs[0]); }
 function skip(direction: number) {
  if (!app.songs.length) return;
  const index = app.songs.findIndex(song => song.id === player.song?.id);
  selectTrack(app.songs[(index + direction + app.songs.length) % app.songs.length]); seek(0); void resume();
 }
 function format(value: number) { const seconds = Math.floor(value || 0); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`; }
 // Arrow keys move 5 s (Shift for 30 s), Page Up/Down 30 s; Home and End stay native.
 function seekKey(event: KeyboardEvent) {
  const big = 30, small = event.shiftKey ? big : 5;
  const steps: Record<string, number> = { ArrowLeft: -small, ArrowDown: -small, ArrowRight: small, ArrowUp: small, PageDown: -big, PageUp: big };
  if (!(event.key in steps) || !player.duration) return;
  event.preventDefault(); seek(player.time + steps[event.key]);
 }
 let busy = $derived(player.playing || player.loading);
 let shown = $derived(player.song ?? app.songs[0] ?? null);
 let progress = $derived(player.duration ? Math.min(1, player.time / player.duration) : 0);
 let buffered = $derived(player.duration ? Math.min(1, Math.max(player.buffered, player.time) / player.duration) : 0);
 let title = $derived(shown?.name || 'No track yet');
 let meta = $derived(player.error || (player.loading ? 'Loading…' : shown ? (shown.albumTitle ? `${shown.style || 'Custom sound'}, from ${shown.albumTitle}` : shown.style || 'Custom sound') : 'Generate a song to play it here'));
</script>

<!-- One hi-fi deck: speaker | cassette + console | volume fader + speaker.
     The speakers are the existing analyser-driven cabinets; the right one is the mute button. -->
<section class="global-player" class:playing={player.playing} class:muted={!app.volume} class:empty={!shown} aria-label="Global music player">
 <div class="hifi-speaker hifi-left" aria-hidden="true"><ReactiveSpeaker /></div>
 <div class="deck-face">
  <div class="deck-tapes"><CassetteCarousel /></div>
  <div class="deck-console">
   <div class="deck-head">
    <div class="deck-transport">
     <button class="deck-btn" type="button" onclick={() => skip(-1)} disabled={app.songs.length < 2} aria-label="Previous track"><SkipBack size={20} fill="currentColor" /></button>
     <button class="deck-btn main-play" type="button" onclick={play} disabled={!player.song && !app.songs.length} aria-label={busy ? 'Pause playback' : 'Play playback'}>
      {#if player.loading}<LoaderCircle size={24} class="deck-spin" />{:else if player.playing}<Pause size={24} fill="currentColor" />{:else}<Play size={24} fill="currentColor" class="deck-play-glyph" />{/if}
     </button>
     <button class="deck-btn" type="button" onclick={() => skip(1)} disabled={app.songs.length < 2} aria-label="Next track"><SkipForward size={20} fill="currentColor" /></button>
    </div>
    <div class="deck-track">
     <p class="deck-title" title={title}>{title}</p>
     <p class="deck-meta" class:error={!!player.error} role="status" title={meta}>{meta}</p>
    </div>
   </div>
   <div class="deck-seek">
    <span class="deck-time" aria-hidden="true">{format(player.time)}</span>
    <input class="deck-range deck-scrub" type="range" min="0" max={player.duration || 1} step="0.1" value={player.time}
     style={`--fill:${(progress * 100).toFixed(2)}%;--buffer:${(buffered * 100).toFixed(2)}%`}
     oninput={event => seek(Number(event.currentTarget.value))} onkeydown={seekKey} disabled={!player.duration}
     aria-label="Playback position" aria-valuetext={`${format(player.time)} of ${format(player.duration)}`} />
    <span class="deck-time" aria-hidden="true">{format(player.duration)}</span>
   </div>
  </div>
 </div>
 <div class="deck-volume">
  <input class="deck-level" type="range" min="0" max="1" step="0.01" bind:value={app.volume}
   style={`--fill:${(app.volume * 100).toFixed(0)}%`} aria-label="Playback volume" aria-valuetext={`${Math.round(app.volume * 100)}%`} title={`Volume ${Math.round(app.volume * 100)}%`} />
  <button class="deck-mute" type="button" onclick={mute} aria-label={app.volume ? 'Mute playback' : 'Unmute playback'} title={app.volume ? 'Mute' : 'Unmute'}>
   <span class="hifi-speaker hifi-right" aria-hidden="true"><ReactiveSpeaker /></span>
   <span class="mute-glyph" aria-hidden="true">{#if !app.volume}<VolumeX size={20} />{:else if app.volume < .5}<Volume1 size={20} />{:else}<Volume2 size={20} />{/if}</span>
  </button>
 </div>
</section>

<style>
 .global-player{--spk-scale:.66;--spk-w:66px;--spk-h:92px;--tapes-w:220px;display:flex;align-items:center;justify-content:center;gap:12px;flex:1 1 760px;min-width:0;max-width:1080px;color:var(--fg)}
 /* speakers: the full cabinet artwork, scaled as one piece so screws, port and badge survive */
 .hifi-speaker{display:block;flex:none;width:var(--spk-w);height:var(--spk-h);position:relative}
 .hifi-speaker :global(.speaker-cabinet){position:absolute;left:0;top:0;transform:scale(var(--spk-scale));transform-origin:0 0}
 /* the deck faceplate ties cassette and controls into one unit */
 .deck-face{flex:1;min-width:0;display:flex;align-items:center;gap:14px;padding:6px 14px 6px 8px;border:1px solid var(--border);border-radius:16px;background:color-mix(in srgb,var(--fg) 4%,transparent)}
 .deck-tapes{flex:none;width:var(--tapes-w);min-width:0}
 .deck-tapes :global(.cassette-carousel){--cassette-w:112px;--cassette-h:71px;--cassette-step:92px}
 .deck-console{flex:1;min-width:0;display:grid;gap:0}
 .deck-head{display:flex;align-items:center;gap:12px;min-width:0}
 .deck-transport{display:flex;align-items:center;gap:4px;flex:none}
 .deck-btn{display:grid;place-items:center;width:44px;height:44px;min-width:44px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--fg);cursor:pointer;flex:none;transition:background-color 150ms ease-out,color 150ms ease-out,transform 150ms ease-out}
 .deck-btn:hover:enabled{background:color-mix(in srgb,var(--fg) 12%,transparent)}
 .deck-btn:active:enabled{transform:scale(.94)}
 .deck-btn:disabled{opacity:.4;cursor:not-allowed}
 .main-play{width:56px;height:56px;background:var(--accent);color:var(--deck-on-accent,var(--bg));box-shadow:0 2px 0 color-mix(in srgb,var(--accent) 55%,#000)}
 .main-play:hover:enabled{background:color-mix(in srgb,var(--accent) 86%,var(--fg))}
 .main-play :global(.deck-play-glyph){margin-left:3px}
 .main-play :global(.deck-spin){animation:deck-spin 900ms linear infinite}
 @keyframes deck-spin{to{transform:rotate(360deg)}}
 .deck-track{flex:1;min-width:0;display:grid;gap:2px}
 .deck-title,.deck-meta{margin:0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .deck-title{font:600 16px/20px var(--theme-heading,inherit);letter-spacing:-.01em;color:var(--fg)}
 .empty .deck-title{color:var(--fg-dim)}
 .deck-meta{font-size:13px;line-height:18px;color:var(--fg-dim)}
 .deck-meta.error{color:var(--error,#f87171)}
 .deck-seek{display:flex;align-items:center;gap:10px;min-width:0;margin:-4px 0 -10px}
 .deck-time{flex:none;min-width:34px;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--fg-dim)}
 .deck-seek .deck-time:last-child{text-align:right}
 /* seek: a 6px rail (played, buffered, rest) inside a 44px tall hit area */
 .deck-range{--rail:color-mix(in srgb,var(--fg) 15%,transparent);--buffered:color-mix(in srgb,var(--fg) 42%,transparent);appearance:none;-webkit-appearance:none;flex:1;min-width:0;height:44px;min-height:44px;margin:0;padding:0;background:transparent;cursor:pointer}
 .deck-range:disabled{cursor:not-allowed;opacity:.55}
 .deck-range::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--accent) var(--fill),var(--buffered) var(--fill) var(--buffer),var(--rail) var(--buffer))}
 .deck-range::-moz-range-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--accent) var(--fill),var(--buffered) var(--fill) var(--buffer),var(--rail) var(--buffer))}
 .deck-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-5px;border-radius:50%;background:var(--fg);border:3px solid var(--accent);box-shadow:0 1px 3px #0006;transition:transform 150ms ease-out}
 .deck-range::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:var(--fg);border:3px solid var(--accent);box-shadow:0 1px 3px #0006}
 .deck-range:hover:enabled::-webkit-slider-thumb,.deck-range:focus-visible::-webkit-slider-thumb{transform:scale(1.15)}
 .deck-range:disabled::-webkit-slider-thumb{visibility:hidden}
 /* volume: one fader beside the right speaker; the speaker itself mutes */
 .deck-volume{display:flex;align-items:center;gap:2px;flex:none}
 .deck-level{writing-mode:vertical-lr;direction:rtl;width:44px;height:84px;margin:0;padding:0;accent-color:var(--accent);cursor:pointer;background:transparent}
 .deck-mute{position:relative;display:grid;place-items:center;padding:0;border:0;border-radius:12px;background:transparent;color:var(--fg);cursor:pointer;transition:opacity 150ms ease-out,filter 150ms ease-out}
 .deck-mute:hover .hifi-speaker{filter:brightness(1.12)}
 .mute-glyph{position:absolute;right:-6px;bottom:-6px;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--bg-panel);color:var(--fg);border:1px solid var(--border-strong);box-shadow:0 1px 3px #0005}
 .mute-glyph :global(svg){width:15px;height:15px}
 .muted .hifi-speaker{filter:saturate(.4) brightness(.7)}
 .muted .mute-glyph{color:var(--error,#f87171)}
 @media(max-width:1180px){
  .global-player{--spk-scale:.52;--spk-w:52px;--spk-h:73px;--tapes-w:128px;gap:10px}
  .deck-face{gap:10px;padding:6px 10px 6px 6px}
  .deck-tapes :global(.cassette-carousel){--cassette-w:104px;--cassette-h:66px;--cassette-step:120px}
  .deck-level{height:72px}
 }
 /* tablets: no room for cabinets, so the deck keeps the cassette and a plain mute + fader */
 @media(max-width:1023px){
  .hifi-left{display:none}
  .deck-mute .hifi-speaker{display:none}
  .deck-mute{width:44px;height:44px;border-radius:50%}
  .deck-mute:hover{background:color-mix(in srgb,var(--fg) 12%,transparent)}
  .mute-glyph{position:static;width:auto;height:auto;border:0;background:none;box-shadow:none}
  .mute-glyph :global(svg){width:20px;height:20px}
  .deck-level{writing-mode:horizontal-tb;direction:ltr;width:76px;height:44px}
  .deck-face{border:0;background:none;padding:0}
 }
 @media(max-width:680px){
  .global-player{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:auto auto 44px;grid-template-areas:'tape title transport' 'tape meta transport' 'seek seek volume';align-items:center;gap:0 10px;flex:1 1 100%;max-width:none}
  .deck-face,.deck-console,.deck-head{display:contents}
  .deck-tapes{grid-area:tape;width:76px}
  .deck-tapes :global(.cassette-carousel){--cassette-w:72px;--cassette-h:46px;--cassette-step:96px;mask-image:none}
  .deck-tapes :global(.cassette:not(.chosen)){visibility:hidden}
  .deck-track{display:contents}
  .deck-title{grid-area:title;align-self:end;font-size:15px}
  .deck-meta{grid-area:meta;align-self:start;font-size:12px;line-height:16px}
  .deck-transport{grid-area:transport;gap:0}
  .main-play{width:48px;height:48px}
  .deck-seek{grid-area:seek;margin:0}
  .deck-volume{grid-area:volume}
  .deck-level{display:none}
 }
 @media(prefers-reduced-motion:reduce){.deck-btn,.deck-mute,.deck-range::-webkit-slider-thumb{transition:none}.main-play :global(.deck-spin){animation:none}}
</style>
