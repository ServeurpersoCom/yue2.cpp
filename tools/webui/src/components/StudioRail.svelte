<script lang="ts">
	import { AudioLines, Headphones, Library, Play, Pause, Settings2, Sparkles, Download, Heart, Maximize2 } from '@lucide/svelte';
	import { app, startRemix, toast } from '../lib/state.svelte.js';
	import { canRemix } from '../lib/remix.js';
	import { putSong } from '../lib/db.js';
	import Waveform from './Waveform.svelte';
	import LogCard from './LogCard.svelte';
	import type { Song } from '../lib/types.js';
	let { onOpenLibrary, showGenerated = true }: {
		onOpenLibrary: () => void;
		showGenerated?: boolean;
	} = $props();
	let selectedId = $state<number | undefined>(undefined);
	let playing = $state(false);
	let time = $state(0);
	let duration = $state(0);
	let previewElement = $state<HTMLElement>();
	async function fullscreen() {
		try { if (document.fullscreenElement) await document.exitFullscreen(); else await previewElement?.requestFullscreen(); }
		catch { toast('Full screen is unavailable in this browser.'); }
	}
	async function favorite(song: Song) {
		const updated = { ...song, favorite: !song.favorite };
		try { await putSong($state.snapshot(updated)); song.favorite = updated.favorite; }
		catch { toast('Could not save this favourite.'); }
	}
	function download(song: Song) {
		const url = URL.createObjectURL(song.audio);
		const link = document.createElement('a');
		link.href = url; link.download = `${song.name.replace(/[<>:"/\\|?*]/g, '_') || 'track'}.${song.format.startsWith('wav') ? 'wav' : 'mp3'}`;
		link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
	}
	let selectedSong = $derived(app.songs.find(song => song.id === selectedId) ?? app.songs[0]);
	let recentSongs = $derived(app.songs.slice(0, 3));
	function selectSong(song: Song) {
		if (selectedId === song.id) return;
		playing = false;
		time = 0;
		selectedId = song.id;
	}
	function formatTime(value: number) {
		const seconds = Math.floor(value || 0);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}
	let masteringLabel = $derived(({ off: 'Off', streaming: 'Streaming · −14 LUFS', broadcast: 'Broadcast · −23 LUFS' } as Record<string, string>)[app.request.mastering_profile || 'off'] || 'Off');
</script>

<aside class="studio-rail">
	{#if showGenerated}
		<section bind:this={previewElement} class="rail-card preview-card" aria-label="Track preview">
			<div class="rail-card-heading"><div><p class="rail-kicker">LISTEN BACK</p><h2><Headphones size={16} /> Preview</h2></div><button type="button" class="preview-expand" onclick={fullscreen} aria-label="Full screen preview"><Maximize2 size={13}/> Full screen</button></div>
			{#if selectedSong}
				<div class="preview-track-title"><strong>{selectedSong.name}</strong><span>{selectedSong.style || 'Custom sound'} · {formatTime(duration || selectedSong.duration)}</span></div>
				<div class="preview-player">
					<button class="preview-play" type="button" aria-label={playing ? 'Pause preview' : 'Play preview'} onclick={() => playing = !playing}>{#if playing}<Pause size={18} fill="currentColor" />{:else}<Play size={18} fill="currentColor" />{/if}</button>
					<div class="preview-wave"><Waveform song={selectedSong} bind:playing bind:time bind:dur={duration} /></div>
				</div>
				<div class="preview-time"><span>{formatTime(time)}</span><span>{formatTime(duration)}</span></div>
			{:else}
				<div class="preview-empty"><AudioLines size={42} /><span>Ready when you are.<small>Generate a track to hear your sound.</small></span></div>
			{/if}
		</section>

		<section class="rail-card output-card">
			<div class="rail-card-heading"><h2><Sparkles size={16} /> Output</h2></div>
			<div class="monitor-controls"><label class="monitor-volume"><span class="volume-dial" style={`--level:${app.volume * 270}deg`}><strong>{Math.round(app.volume * 100)}<small>%</small></strong></span><span>Monitor volume</span><input aria-label="Monitor volume" type="range" min="0" max="1" step="0.01" bind:value={app.volume}/></label><div class="delivery-controls"><label>Format<select aria-label="Output format" bind:value={app.format}><option value="mp3">MP3</option><option value="wav16">WAV · 16 bit</option><option value="wav24">WAV · 24 bit</option><option value="wav32">WAV · 32 bit</option></select></label><label>Mastering<select aria-label="Output mastering" bind:value={app.request.mastering_profile}><option value="off">Off</option><option value="streaming">Streaming</option><option value="broadcast">Broadcast</option></select></label></div></div>
			<div class="output-summary"><div><span>DELIVERY</span><strong>{app.format.toUpperCase()}</strong></div><div><span>MASTERING</span><strong>{masteringLabel}</strong></div></div>
		</section>

		<section class="rail-card generated-card">
			<div class="rail-card-heading"><div><h2><Library size={16} /> Generated tracks</h2><span class="rail-count">{app.songs.length} saved</span></div><button class="text-link" type="button" onclick={onOpenLibrary}>View all →</button></div>
			{#if recentSongs.length}
				<div class="recent-list">
					{#each recentSongs as song (song.id)}
						<div class="recent-track" class:selected={selectedSong?.id === song.id}>
						<button class="recent-select" type="button" aria-label={`${selectedSong?.id === song.id && playing ? 'Pause' : 'Play'} ${song.name}`} onclick={() => { if (selectedSong?.id === song.id) playing = !playing; else { selectSong(song); playing = true; } }}>
							<span class="recent-play">{#if selectedSong?.id === song.id && playing}<Pause size={15} fill="currentColor" />{:else}<Play size={15} fill="currentColor" />{/if}</span>
							<span class="recent-info"><strong>{song.name}</strong><small>{song.style || 'Custom sound'} · {formatTime(song.duration)}</small></span>
							<span class="mini-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
						</button><button class="remix-track-button" type="button" disabled={!canRemix(song)} onclick={() => startRemix(song)} aria-label={`Remix ${song.name}`} title={canRemix(song) ? 'Remix with the original seed' : 'Requires saved generation data'}>Remix</button><button class="track-action" class:hearted={song.favorite} type="button" aria-label={`Favourite ${song.name}`} aria-pressed={!!song.favorite} onclick={() => favorite(song)}><Heart size={15} fill={song.favorite ? 'currentColor' : 'none'}/></button><button class="track-action" type="button" aria-label={`Download ${song.name}`} onclick={() => download(song)}><Download size={15}/></button></div>
					{/each}
				</div>
			{:else}<p class="rail-empty">Generated music is saved in your local library.</p>{/if}
		</section>
	{/if}

	<section class="rail-card activity-card"><LogCard /></section>
	<section class="rail-card settings-card" id="settings">
		<div class="rail-card-heading"><h2><Settings2 size={16} /> Studio settings</h2></div>
		<div class="rail-setting server-setting"><span>Generation server</span><strong class:offline={!app.props}>{app.props ? 'Connected · 127.0.0.1' : 'Offline · start with music'}</strong></div>
	</section>
</aside>

<style>
	.preview-expand {display:flex;align-items:center;gap:6px;padding:7px 8px;border:1px solid var(--border);border-radius:7px;background:var(--bg-input);color:var(--fg-dim);font-size:10px;cursor:pointer}
	.preview-empty small {display:block;font-size:10px;color:var(--fg-faint);margin-top:5px}
	.preview-card:fullscreen {display:flex;flex-direction:column;justify-content:center;padding:8vw;background:var(--bg);border:0;border-radius:0}
	.preview-card:fullscreen .preview-wave {height:180px}
	.preview-card:fullscreen .preview-wave :global(canvas) {height:180px}
	.monitor-controls {display:grid;grid-template-columns:110px minmax(0,1fr);gap:18px;align-items:center;margin-bottom:12px}
	.monitor-volume {display:flex;flex-direction:column;align-items:center;gap:7px;color:var(--fg-dim);font-size:9px}
	.monitor-volume input {width:85px;accent-color:var(--accent)}
	.volume-dial {display:grid;place-items:center;width:76px;height:76px;border:1px solid var(--border);border-radius:50%;background:conic-gradient(from 225deg,var(--accent) 0deg var(--level),var(--bg-btn) var(--level) 270deg,transparent 270deg);box-shadow:inset 0 0 0 5px var(--bg-input)}
	.volume-dial strong {display:grid;place-content:center;width:56px;height:56px;border-radius:50%;background:radial-gradient(circle at 35% 25%,var(--bg-btn-hover),var(--bg));box-shadow:0 3px 9px #0006;font:17px ui-monospace,monospace;color:var(--fg);text-align:center}
	.volume-dial small {font-size:8px;color:var(--fg-dim)}
	.delivery-controls {display:flex;flex-direction:column;gap:9px}
	.delivery-controls label {display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--fg-dim)}
	.delivery-controls select {width:100%;font-size:11px!important;padding:6px 8px!important}
	.recent-select {display:flex;align-items:center;gap:9px;flex:1;min-width:0;border:0;padding:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
	.track-action {display:grid;place-items:center;flex-shrink:0;width:23px;height:30px;background:transparent;border:0;color:var(--fg-dim);cursor:pointer}
	.track-action:hover,.track-action.hearted {color:var(--accent)}
	.studio-rail { display:flex; flex-direction:column; gap:10px; min-width:0; }
	.rail-card { min-width:0; padding:14px; border:1px solid var(--border); border-radius:14px; background:linear-gradient(145deg,color-mix(in srgb,var(--bg-card-2) 38%,var(--bg-panel)),var(--bg-panel)); box-shadow:0 10px 25px #0002; }
	.rail-card-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
	.rail-card-heading > div { display:flex; align-items:center; gap:9px; min-width:0; flex-wrap:wrap; }
	.rail-card-heading h2 { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:650; }
	.rail-card-heading h2 :global(svg) { color:var(--accent); }
	.rail-kicker { width:100%; color:var(--accent); font:8px ui-monospace,monospace; letter-spacing:.14em; }

	.preview-track-title { display:flex; flex-direction:column; gap:4px; margin:0 2px 11px; min-width:0; }
	.preview-track-title strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
	.preview-track-title span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg-dim); font-size:10px; }
	.preview-player { display:flex; align-items:center; gap:11px; border:1px solid var(--border); border-radius:11px; padding:9px 10px; background:color-mix(in srgb,var(--bg) 50%,transparent); }
	.preview-play,.recent-play { display:grid; flex-shrink:0; place-items:center; border:0; color:#04211d; background:var(--accent-grad); border-radius:50%; cursor:pointer; }
	.preview-play { width:38px; height:38px; }
	.preview-wave { flex:1; min-width:0; height:48px; overflow:hidden; }
	.preview-wave :global(.waveform),.preview-wave :global(canvas) { width:100%; height:48px; }
	.preview-time { display:flex; justify-content:space-between; padding:6px 2px 0; color:var(--fg-dim); font:9px ui-monospace,monospace; }
	.preview-empty { display:flex; align-items:center; justify-content:center; gap:10px; min-height:86px; color:var(--fg-dim); font-size:11px; }
	.preview-empty :global(svg) { color:var(--accent); }
	.output-summary { display:grid; grid-template-columns:1fr 1fr; border:1px solid var(--border); background:var(--bg-input); border-radius:10px; overflow:hidden; }
	.output-summary > div { display:flex; flex-direction:column; gap:7px; padding:10px; min-width:0; }
	.output-summary > div + div { border-left:1px solid var(--border); }
	.output-summary span { color:var(--fg-dim); font:8px ui-monospace,monospace; letter-spacing:.1em; }
	.output-summary strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; font-weight:600; }
	.rail-count { padding:3px 6px; border-radius:99px; background:color-mix(in srgb,var(--accent) 10%,var(--bg-card)); color:var(--fg-dim); font-size:9px; }
	.text-link { border:0; background:transparent; color:var(--accent); font-size:10px; cursor:pointer; white-space:nowrap; }
	.recent-list { display:flex; flex-direction:column; gap:6px; }
	.recent-track { display:flex; align-items:center; gap:9px; width:100%; min-width:0; padding:8px; text-align:left; border:1px solid transparent; border-radius:10px; color:var(--fg); background:color-mix(in srgb,var(--bg) 35%,transparent); cursor:pointer; }
	.recent-track:hover,.recent-track.selected { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,var(--bg-card)); }
	.recent-play { width:30px; height:30px; background:var(--bg-btn); color:var(--fg); }
	.recent-track.selected .recent-play { background:var(--accent-grad); color:#04211d; }
	.recent-info { display:flex; flex:1; flex-direction:column; min-width:0; gap:3px; }
	.recent-info strong,.recent-info small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.recent-info strong { font-size:10px; font-weight:600; }
	.recent-info small { font-size:9px; color:var(--fg-dim); }
	.mini-wave { height:18px; display:flex; align-items:center; gap:2px; }
	.mini-wave i { display:block; width:2px; height:var(--h,10px); border-radius:4px; background:linear-gradient(var(--accent),color-mix(in srgb,var(--accent) 35%,var(--accent-2))); }
	.mini-wave i:nth-child(3n) { --h:15px }.mini-wave i:nth-child(3n + 1) { --h:7px }.mini-wave i:nth-child(4n) { --h:12px }
	.rail-empty { color:var(--fg-dim); padding:5px 2px; font-size:10px; line-height:1.55; }
	.activity-card { padding:0; overflow:hidden; }.activity-card :global(.card) { border:0; border-radius:0; box-shadow:none; }
	.activity-card :global(.card-header) { min-height:43px; padding:10px 13px; background:transparent; font-size:10px; }
	.activity-card :global(.log-body) { max-height:170px; font-size:9px; }
	.settings-card { scroll-margin-top:78px; }
	.rail-setting { display:flex; flex-direction:column; gap:7px; margin-top:10px; color:var(--fg-dim); font-size:10px; }
	.server-setting strong { color:var(--accent); font-size:10px; font-weight:550; }.server-setting strong.offline { color:var(--fg-dim); }
	@media (max-width:900px) { .studio-rail { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; }.activity-card,.settings-card { grid-column:1/-1; } }
	@media (max-width:560px) { .studio-rail { display:flex; }.rail-card { padding:12px; } }
</style>
