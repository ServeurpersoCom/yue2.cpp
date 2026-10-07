<script lang="ts">
	import {
		Play,
		Square,
		Pencil,
		Download,
		Trash2,
		Heart,
		Type,
		TriangleAlert,
		Music,
		ImagePlus,
		Sparkles,
		Clapperboard,
		Ellipsis,
		LoaderCircle
	} from '@lucide/svelte';
	import { withStudioLock } from '../lib/coordination.js';
	import { app, setRequest, startRemix, toast } from '../lib/state.svelte.js';
	import { canRemix } from '../lib/remix.js';
	import { transcribeSubmit, pollJob, jobResultTranscribe, balanceVocalLevel, renderVideo } from '../lib/api.js';
	import { deleteSong, deleteSongs, updateSong } from '../lib/db.js';
	import type { Song } from '../lib/types.js';
	import Waveform from './Waveform.svelte';
	import Menu, { type MenuItem } from './Menu.svelte';
	import Dialog from './Dialog.svelte';
	import YouTubeDialog from './YouTubeDialog.svelte';
	import ArtworkCover from './ArtworkCover.svelte';
	import VideoArtwork from './VideoArtwork.svelte';
	import { validateArtwork } from '../lib/artwork.js';
	import { generateTrackArtwork, trackArtworkPrompt } from '../lib/track-artwork.js';
	import { checkArtwork, submitArtwork, artworkResult, uploadReference } from '../lib/comfy-art.js';
	import { JOB_POLL_MS } from '../lib/config.js';
	import { MUSIC_STYLE_BY_ID } from '../lib/style-profiles.js';
	import { LYRIC_STYLE_BY_ID } from '../lib/lyric-styles.js';

	let { song }: { song: Song } = $props();

	let playing = $state(false);
	let youtubeOpen = $state(false);
	let activeVersion = $state<'mastered' | 'original' | 'vocal-adjusted'>('mastered');
	let activeAudio = $derived(activeVersion === 'original' ? (song.vocalOriginalAudio ?? song.originalAudio ?? song.audio) : song.audio);
	let time = $state(0);
	let dur = $state(0);
	let artworkInput: HTMLInputElement;
	let artworkBusy = $state(false);
	let vocalDialogOpen = $state(false);
	let vocalBusy = $state(false);
	let vocalGain = $state(3);
	let vocalError = $state('');
	let artDialogOpen = $state(false);
	let artBusy = $state(false);
	let artPrompt = $state('');
	let artSeed = $state(0);
	let artUseReference = $state(false);
	let artError = $state('');
	let mediaController: AbortController | undefined;
	async function owned(work: () => Promise<void>) { try { const result = await withStudioLock(work); if (!result.acquired) toast('Another Studio operation is running. Finish or cancel it first.'); } catch(error) {toast(String(error));} }
	let artAborted = false;
	// Closing the dialog (Escape, outside click) aborts the poll loop; the
	// ComfyUI job itself keeps running server-side and is simply ignored.
	$effect(() => {
		if (!artDialogOpen && artBusy) { artAborted = true; mediaController?.abort(); }
	});
	$effect(() => {
		if (song.vocalOriginalAudio && activeVersion === 'mastered') activeVersion = 'vocal-adjusted';
	});
	async function attachArtwork(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || artworkBusy) return;
		artworkBusy = true;
		try {
			await validateArtwork(file);
			await persist({artwork:file});
			toast('Artwork saved to this track.', 3000, true);
		} catch (error) { toast(error instanceof Error ? error.message : 'Could not save artwork.'); }
		finally { artworkBusy = false; }
	}
	async function persist(patch: Partial<Song>, revision?: number) {
		if (song.id == null) throw new Error('Save this track before editing it.');
		const saved = await updateSong(song.id, patch, revision);
		Object.assign(song, saved);
	}

	// style profiles blended at generation, resolved to display names.
	// Unknown ids (removed packs) fall back to the raw id. Empty on older
	// records, imports and remixes, which show the style prompt instead.
	let styleChips = $derived(
		(song.musicStyles ?? []).map((entry) => ({
			id: entry.id,
			weight: entry.weight,
			name: MUSIC_STYLE_BY_ID[entry.id]?.name ?? entry.id
		}))
	);
	let lyricChips = $derived(
		(song.lyricStyles ?? []).map((entry) => ({
			id: entry.id,
			weight: entry.weight,
			name: LYRIC_STYLE_BY_ID[entry.id] ?? entry.id
		}))
	);

	// deterministic cover hue from the song id, so each track is recognizable
	let hue = $derived(((song.id ?? song.created ?? 0) * 47) % 360);
	let thumbStyle = $derived(
		`background: linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 50) % 360} 70% 26%)`
	);

	function toggle() {
		playing = !playing;
	}

	function chooseVersion(version: 'mastered' | 'original' | 'vocal-adjusted') {
		if (version === activeVersion) return;
		playing = false;
		time = 0;
		activeVersion = version;
	}

	function load() {
		app.name = song.name;
		setRequest({ ...song.request });
	}

	function downloadAudio() {
		downloadBlob(song.audio, '');
	}

	function downloadVideo() {
		if (song.video) downloadBlob(song.video, '');
	}

	let videoBusy = $state(false);
	// On-demand 16:9 MP4 over the currently selected mix, using the track's
	// artwork or the card-style fallback cover. Saved onto the song so the
	// library, backups and the MP4 delivery download all share it.
	async function exportVideo() {
		if (videoBusy || artBusy || artworkBusy) return;
		videoBusy = true;
		mediaController = new AbortController();
		try {
			if (!song.artwork) toast('Creating artwork for the MP4…', 6000, true);
			const artworkRevision = song.mediaRevision ?? 0;
			const cover = song.artwork ?? (await generateTrackArtwork(song,undefined,undefined,mediaController.signal));
			if (!song.artwork) await persist({artwork:cover,artworkJobId:undefined},artworkRevision);
			const revision = song.mediaRevision ?? 0, version = activeVersion, source = activeAudio;
			const video = await renderVideo(source, cover, mediaController.signal, song.videoJobId, async id => { await persist({videoJobId:id}); });
			const completedVideoId=song.videoJobId;
			await persist({video,format:'mp4',videoVersion:version,videoJobId:undefined},revision);
			if(completedVideoId)void fetch(`job?id=${completedVideoId}&ack=1`,{method:'POST'}).catch(()=>{});
			toast('Video ready.', 4000, true);
		} catch (error) {
			toast('Video export failed: ' + (error instanceof Error ? error.message : String(error)));
		} finally {
			videoBusy = false;
		}
	}

	function downloadOriginal() {
		if (song.originalAudio) downloadBlob(song.originalAudio, '-original');
	}

	function downloadBeforeVocalAdjustment() {
		if (song.vocalOriginalAudio) downloadBlob(song.vocalOriginalAudio, '-before-vocal-adjustment');
	}

	async function applyVocalBalance(autoGain = false) {
		if (vocalBusy) return;
		vocalBusy = true;
		vocalError = '';
		try {
			const revision=song.mediaRevision??0;
			mediaController=new AbortController();
			const source = song.vocalOriginalAudio ?? song.audio;
			const result = await balanceVocalLevel(source, autoGain ? null : vocalGain,mediaController.signal);
			await persist({vocalOriginalAudio:source,audio:result.audio,format:'wav32'},revision);
			if(result.jobId)void fetch(`job?id=${result.jobId}&ack=1`,{method:'POST'}).catch(()=>{});
			vocalGain = result.gainDb;
			activeVersion = 'vocal-adjusted';
			playing = false;
			vocalDialogOpen = false;
			toast(`${autoGain ? 'Auto suggested' : 'Vocal gain'} ${vocalGain >= 0 ? '+' : ''}${vocalGain} dB.`, 4000, true);
		} catch (error) {
			vocalError = error instanceof Error ? error.message : String(error);
		} finally {
			vocalBusy = false;
		}
	}

	function downloadBlob(blob: Blob, suffix: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const safe = song.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '') || 'song';
		const ext = blob.type.includes('mp4') || blob.type.includes('video') ? 'mp4' : blob.type.includes('mpeg') ? 'mp3' : 'wav';
		a.download = `${safe}${suffix}.${ext}`;
		a.click();
		URL.revokeObjectURL(url);
	}

	let confirmDeleteOpen = $state(false);
	let confirmDeleteNonFavOpen = $state(false);
	let renameOpen = $state(false);
	let renameValue = $state('');

	async function toggleFavorite() {
		if (song.id == null) return;
		try { await persist({favorite:!song.favorite}); }
		catch (error) { toast(error instanceof Error ? error.message : 'Could not save favourite.'); }
	}

	function openRename() {
		renameValue = song.name;
		renameOpen = true;
	}

	async function doRename() {
		if (song.id == null) return;
		const v = renameValue.trim();
		if (!v || v === song.name) return;
		try { await persist({name:v}); }
		catch (error) { toast(error instanceof Error ? error.message : 'Could not rename track.'); }
	}

	async function doRemove() {
		if (song.id == null) return;
		try { await deleteSong(song.id); const idx = app.songs.findIndex((s) => s.id === song.id); if (idx >= 0) app.songs.splice(idx, 1); }
		catch (error) { toast(error instanceof Error ? error.message : 'Could not delete track.'); }
	}

	// Deletes every non-favorite track in the list, regardless of which
	// card the menu was opened from. The current card is included in the
	// purge if it is not flagged favorite.
	async function doRemoveNonFavorites() {
		const victims = app.songs.filter((s) => !s.favorite);
		try { await deleteSongs(victims.flatMap(s => s.id == null ? [] : [s.id])); app.songs = app.songs.filter(s => !victims.includes(s)); }
		catch (error) { toast(error instanceof Error ? error.message : 'Could not delete tracks.'); }
	}

	// MM:SS:XX (hundredths) for current position
	function fmtPos(s: number): string {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		const cs = Math.floor((s * 100) % 100);
		return (
			String(m).padStart(2, '0') +
			':' +
			String(sec).padStart(2, '0') +
			':' +
			String(cs).padStart(2, '0')
		);
	}

	// MM:SS for total duration
	function fmtDur(s: number): string {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
	}

	// AI artwork: prefill the prompt from the song's style blend and roll a
	// fresh seed. The current cover becomes an optional image reference.
	function openArtworkGenerator() {
		artPrompt = trackArtworkPrompt(song);
		artSeed = crypto.getRandomValues(new Uint32Array(1))[0];
		artUseReference = false;
		artError = '';
		artDialogOpen = true;
	}

	// Generate path: check ComfyUI readiness, optionally upload the current
	// cover as a reference, submit the Qwen 2.1 graph and poll until the
	// image lands, then save it as this track's artwork.
	async function generateArtwork() {
		if (artBusy) return;
		const prompt = artPrompt.trim() || trackArtworkPrompt(song);
		if (!prompt) {
			artError = 'Describe the artwork first.';
			return;
		}
		artDialogOpen = true;
		artBusy = true;
		artAborted = false;
		artError = '';
		try {
			const revision = song.mediaRevision ?? 0;
			mediaController = new AbortController();
			const image = await generateTrackArtwork(song,undefined,undefined,mediaController.signal,{prompt,seed:artSeed,reference:artUseReference ? song.artwork : undefined});
			await persist({artwork:image,artworkJobId:undefined},revision);
			artDialogOpen = false;
			toast('Artwork generated.',4000,true);
		} catch (error) {
			artError = error instanceof Error ? error.message : String(error);
		} finally {
			artBusy = false;
		}
	}

	// transcribe audio: send the recording to /transcribe and keep the score
	// it heard on the card and in the form. Only the card that was analyzed
	// changes; the lyrics, the style and the mode stay yours.
	let transcribeBusy = $state(false);
	async function transcribe(melodyOnly: boolean) {
		if (transcribeBusy) return;
		transcribeBusy = true;
		try {
			const jobId = await transcribeSubmit(song.audio, melodyOnly);
			await pollJob(jobId);
			const result = await jobResultTranscribe(jobId);
			const score = result.abc ?? '';
			await persist({score, request:{...song.request,abc:score}});
			app.request.abc = song.score;
			toast('Transcribed: ' + song.name, 4000, true);
		} catch (e) {
			toast('Transcription failed: ' + (e instanceof Error ? e.message : String(e)));
		} finally { transcribeBusy = false; }
	}

	// Single action menu: one entry per user intent.
	// Destructive entries open a confirm dialog.
	const actionItems: MenuItem[] = $derived([
		{ icon: Pencil, label: 'Edit prompt', onSelect: load },
		{ icon: Type, label: 'Rename song', onSelect: openRename },
		{ icon: Download, label: 'Download audio', onSelect: downloadAudio },
		...(song.video ? [{ icon: Download, label: 'Download video', onSelect: downloadVideo }] : []),
		{ icon: Clapperboard, label: videoBusy ? 'Exporting video…' : 'Export video (MP4)', disabled: videoBusy || artBusy || artworkBusy, onSelect: () => owned(exportVideo) },
		{ icon: Clapperboard, label: 'Prepare for YouTube', onSelect: () => { youtubeOpen = true; } },
		...(song.originalAudio ? [{ icon: Download, label: 'Download original take', onSelect: downloadOriginal }] : []),
		...(song.vocalOriginalAudio ? [{ icon: Download, label: 'Download before vocal adjustment', onSelect: downloadBeforeVocalAdjustment }] : []),
		{ icon: Music, label: 'Adjust vocal level', onSelect: () => { vocalGain = 3; vocalError = ''; vocalDialogOpen = true; } },
		{ icon: ImagePlus, label: artworkBusy ? 'Saving artwork…' : song.artwork ? 'Replace artwork' : 'Add artwork', disabled: artworkBusy || artBusy || videoBusy, onSelect: () => artworkInput.click() },
		{ icon: Sparkles, label: artBusy ? 'Generating artwork…' : 'Generate artwork', disabled: artBusy || artworkBusy || videoBusy, onSelect: openArtworkGenerator },
		{ icon: Music, label: transcribeBusy ? 'Transcribing…' : 'Transcribe score', disabled: transcribeBusy, onSelect: () => owned(() => transcribe(false)) },
		{ icon: Music, label: 'Transcribe melody', disabled: transcribeBusy, onSelect: () => owned(() => transcribe(true)) },
		{ icon: Trash2, label: 'Delete this track', onSelect: () => (confirmDeleteOpen = true) },
		{
			icon: TriangleAlert,
			label: 'Delete non-favorites',
			onSelect: () => (confirmDeleteNonFavOpen = true)
		}
	]);
</script>

<div class="card" class:is-playing={playing}>
	<input type="file" accept="image/png,image/jpeg,image/webp" bind:this={artworkInput} onchange={attachArtwork} hidden aria-label={`Artwork file for ${song.name}`} />
	<div class="track-media" class:with-artwork={!!(song.artwork || song.video)}>
	{#if song.artwork}<ArtworkCover artwork={song.artwork} title={song.name} />{:else if song.video}<VideoArtwork video={song.video} title={song.name} />{/if}
	<div class="thumb" style={thumbStyle}>
		<button class="play-btn" onclick={toggle} aria-pressed={playing} title={playing ? 'Stop' : 'Play'} aria-label={`${playing ? 'Stop' : 'Play'} ${song.name}`}>
			{#if playing}
				<Square size={17} fill="currentColor" />
			{:else}
				<Play size={17} fill="currentColor" />
			{/if}
		</button>
	</div>
	<span class="format-badge">{song.format.toUpperCase()}</span>
	</div>
	<div class="body">
        {#if song.videoOutdated}<p role="status">Video needs rebuilding after media changes.</p>{/if}
        {#if song.artworkJobId && !artBusy && !videoBusy}<p role="status">Artwork recovery available. <button onclick={() => owned(generateArtwork)}>Reconnect artwork</button> <button onclick={async () => { await persist({artworkJobId:undefined}); openArtworkGenerator(); }}>Retry artwork</button></p>{/if}
        {#if song.videoJobId && !videoBusy}<button onclick={() => owned(exportVideo)}>Reconnect video</button><button onclick={async()=>{await persist({videoJobId:undefined});await owned(exportVideo);}}>Retry video</button>{/if}
        {#if videoBusy || artBusy || vocalBusy}<button onclick={() => { mediaController?.abort(); toast('Owned video/vocal work cancelled. Artwork polling stopped; its saved prompt can be reconnected.'); }}>{artBusy ? 'Stop waiting for artwork' : 'Cancel processing'}</button>{/if}
		{#if videoBusy || artBusy || artworkBusy || transcribeBusy || vocalBusy}<p class="track-operation" role="status" aria-live="polite"><LoaderCircle size={14} />{videoBusy ? 'Exporting video…' : artBusy ? 'Generating artwork…' : artworkBusy ? 'Saving artwork…' : transcribeBusy ? 'Transcribing audio…' : 'Adjusting vocals…'}</p>{/if}
		<div class="card-header">
			<span class="card-name" title={song.name}>{song.name}</span>
			<button type="button" class="remix-track-button" disabled={!canRemix(song)} onclick={() => startRemix(song)} aria-label={`Remix ${song.name}`} title={canRemix(song) ? 'Remix with the original seed' : 'Requires a generated track with saved seeds and audio codes'}>Remix</button>
			<button
				class="icon-btn fav-btn"
				class:active={song.favorite}
				aria-label={`Favourite ${song.name}`}
				aria-pressed={!!song.favorite}
				onclick={toggleFavorite}
				title={song.favorite ? 'Unfavorite' : 'Favorite'}
			>
				<Heart size={15} fill={song.favorite ? 'currentColor' : 'none'} />
			</button>
			<Menu items={actionItems}>
				{#snippet trigger()}
					<Ellipsis size={16} />
				{/snippet}
			</Menu>
		</div>
		{#if lyricChips.length}
			<div class="style-chips" role="group" aria-label="Lyric styles">
				{#each lyricChips as chip (chip.id)}
					<span class="style-chip lyric" title={`Lyrics · ${chip.name} · ${chip.weight}%`}>{chip.name}</span>
				{/each}
			</div>
		{/if}
		<div class="wave-wrap">
		<Waveform {song} audio={activeAudio} bind:playing bind:time bind:dur />
		</div>
		{#if song.originalAudio || song.vocalOriginalAudio}
			<div class="master-ab" role="group" aria-label="Compare original and mastered audio">
				{#if song.vocalOriginalAudio}
					<button type="button" class:active={activeVersion === 'vocal-adjusted'} aria-pressed={activeVersion === 'vocal-adjusted'} onclick={() => chooseVersion('vocal-adjusted')}>Vocal adjusted</button>
					<button type="button" class:active={activeVersion === 'original'} aria-pressed={activeVersion === 'original'} onclick={() => chooseVersion('original')}>Before vocal adjustment</button>
				{:else}
					<button type="button" class:active={activeVersion === 'mastered'} aria-pressed={activeVersion === 'mastered'} onclick={() => chooseVersion('mastered')}>Mastered</button>
					<button type="button" class:active={activeVersion === 'original'} aria-pressed={activeVersion === 'original'} onclick={() => chooseVersion('original')}>Original</button>
				{/if}
			</div>
		{/if}
		<div class="card-footer">
			{#if styleChips.length}
				<span class="style-chips" role="group" aria-label="Music styles" title={song.style}>
					{#each styleChips as chip (chip.id)}
						<span class="style-chip" title={`Sound · ${chip.name} · ${chip.weight}%`}>{chip.name}</span>
					{/each}
				</span>
			{:else if song.style}
				<span class="style-tag" title={song.style}>{song.style}</span>
			{/if}
			<span class="timecode">{fmtPos(time)} / {fmtDur(dur)}</span>
		</div>
	</div>
</div>

<YouTubeDialog bind:open={youtubeOpen} {song} />
<Dialog bind:open={confirmDeleteOpen} title="Delete this track?" onConfirm={doRemove} />

<Dialog
	bind:open={confirmDeleteNonFavOpen}
	title="Delete non-favorites?"
	onConfirm={doRemoveNonFavorites}
/>

<Dialog bind:open={renameOpen} title="Rename song" onConfirm={doRename}>
	{#snippet body()}
			<input type="text" class="rename-input" aria-label="Song name" bind:value={renameValue} />
	{/snippet}
</Dialog>

	<Dialog bind:open={artDialogOpen} title="Generate artwork">
		{#snippet body()}
			<p>Rendered by ComfyUI (Qwen Image 2.1) at 1024×1024 and saved as this track's cover. Reads the card's style blend into the prompt; edit it freely.</p>
			<label class="art-prompt">Prompt<textarea rows="4" bind:value={artPrompt} disabled={artBusy}></textarea></label>
			<div class="art-row">
				<label>Seed<input type="number" bind:value={artSeed} disabled={artBusy} /></label>
				<button type="button" class="dialog-action" onclick={() => (artSeed = crypto.getRandomValues(new Uint32Array(1))[0])} disabled={artBusy}>Dice</button>
			</div>
			{#if song.artwork}
				<label class="art-reference"><input type="checkbox" bind:checked={artUseReference} disabled={artBusy} /> Guide from the current cover</label>
			{/if}
			{#if artError}<p class="vocal-error">{artError}</p>{/if}
		{/snippet}
		{#snippet actions(cancel)}
			<button class="dialog-action" onclick={cancel} disabled={artBusy}>Cancel</button>
			<button class="dialog-action primary" onclick={() => owned(generateArtwork)} disabled={artBusy}>{artBusy ? 'Rendering…' : 'Generate'}</button>
		{/snippet}
	</Dialog>

	<Dialog bind:open={vocalDialogOpen} title="Adjust vocal level">
	{#snippet body()}
		<p>Auto estimates the balance across active vocal sections and aims for a slightly forward vocal. You can adjust the estimate below. Separation can add artifacts, so compare the result with the original.</p>
		<label class="vocal-gain">Vocal gain <strong>{vocalGain >= 0 ? '+' : ''}{vocalGain} dB</strong>
			<input type="range" min="-6" max="6" step="0.5" bind:value={vocalGain} disabled={vocalBusy} />
		</label>
		{#if vocalError}<p class="vocal-error">{vocalError}</p>{/if}
	{/snippet}
	{#snippet actions(cancel)}
		<button class="dialog-action" onclick={cancel} disabled={vocalBusy}>Cancel</button>
		<button class="dialog-action" onclick={() => owned(() => applyVocalBalance(true))} disabled={vocalBusy}>{vocalBusy ? 'Separating vocals…' : 'Auto level'}</button>
		<button class="dialog-action primary" onclick={() => owned(() => applyVocalBalance())} disabled={vocalBusy}>Apply {vocalGain >= 0 ? '+' : ''}{vocalGain} dB</button>
	{/snippet}
</Dialog>

<style>
	.track-media { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; gap: 8px; }
	.track-media.with-artwork .thumb { width: 100%; height: 32px; background: var(--bg-card-2) !important; border: 1px solid var(--border); border-radius: 8px; }
	.track-media.with-artwork .play-btn { width: 100%; height: 100%; border-radius: 7px; background: transparent; }
	.card {
		display: flex;
		gap: 0.85rem;
		padding: 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-card);
		box-shadow: var(--shadow);
		transition: border-color 0.2s;
	}
	.card.is-playing {
		border-color: rgba(139, 92, 246, 0.55);
		box-shadow:
			var(--shadow),
			0 0 0 1px rgba(139, 92, 246, 0.35),
			0 0 28px rgba(139, 92, 246, 0.18);
	}
	.master-ab { display:flex; gap:.25rem; width:max-content; padding:.2rem; border:1px solid var(--border); border-radius:999px; background:var(--bg-input); }
	.master-ab button { border:0; border-radius:999px; padding:.25rem .65rem; color:var(--fg-dim); background:transparent; font-size:.68rem; cursor:pointer; }
	.master-ab button.active { color:var(--fg); background:var(--bg-btn-hover); box-shadow:inset 0 0 0 1px var(--border-strong); }
	.art-prompt { display:grid; gap:.4rem; }
	.art-prompt textarea { width:100%; box-sizing:border-box; resize:vertical; background:var(--bg-input); border:1px solid var(--border); border-radius:8px; padding:.55rem .65rem; color:var(--fg); font-size:.83rem; font-family:inherit; }
	.art-prompt textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(139,92,246,.22); }
	.art-row { display:flex; gap:.5rem; align-items:end; }
	.art-row label { display:grid; gap:.4rem; flex:1; }
	.art-row input { width:100%; box-sizing:border-box; background:var(--bg-input); border:1px solid var(--border); border-radius:8px; padding:.5rem .65rem; color:var(--fg); font-size:.83rem; }
	.art-reference { display:flex; gap:.5rem; align-items:center; cursor:pointer; }
	.vocal-gain { display:grid; grid-template-columns:1fr auto; gap:.45rem; align-items:center; }
	.vocal-gain input { grid-column:1 / -1; width:100%; accent-color:var(--accent); }
	.vocal-error { color:var(--danger, #f87171); overflow-wrap:anywhere; }
	.dialog-action { border:1px solid var(--border-strong); border-radius:.45rem; padding:.45rem .8rem; background:var(--bg-btn); color:var(--fg); cursor:pointer; }
	.dialog-action.primary { background:var(--accent); color:#10121a; }
	.dialog-action:disabled { opacity:.55; cursor:wait; }
	.thumb {
		position: relative;
		flex-shrink: 0;
		width: 3.4rem;
		height: 3.4rem;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.thumb::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.45));
		pointer-events: none;
	}
	.play-btn {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 50%;
		border: none;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		cursor: pointer;
		backdrop-filter: blur(4px);
		transition:
			transform 0.12s,
			background 0.15s;
	}
	.play-btn:hover {
		background: rgba(0, 0, 0, 0.75);
		transform: scale(1.07);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.card-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.card-name {
		font-size: 0.88rem;
		font-weight: 650;
		letter-spacing: 0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}
	.icon-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 7px;
		color: var(--fg-faint);
		display: flex;
		align-items: center;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.icon-btn:hover {
		color: var(--fg);
		background: var(--bg-btn);
	}
	.icon-btn.active {
		color: #f472b6;
	}
	.wave-wrap {
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.35rem 0.45rem 0.25rem;
		--waveform-h: 72px;
	}
	.card-footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.format-badge {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		font-family: ui-monospace, monospace;
		padding: 0.14rem 0.42rem;
		border-radius: 6px;
		background: var(--accent-grad);
		color: #fff;
		flex-shrink: 0;
	}
	.style-tag {
		font-size: 0.7rem;
		color: var(--fg-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}
	.style-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}
	.style-chip {
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex-shrink: 1;
	}
	.style-chip.lyric {
		color: var(--fg-dim);
		border-color: var(--border-strong);
		background: transparent;
		font-weight: 500;
	}
	.timecode {
		margin-left: auto;
		font-size: 0.72rem;
		font-family: ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		color: var(--fg-dim);
		white-space: nowrap;
	}
	.rename-input {
		width: 100%;
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.65rem;
		color: var(--fg);
		font-size: 0.85rem;
	}
	.rename-input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.22);
	}
</style>
