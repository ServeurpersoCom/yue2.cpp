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
		Ellipsis
	} from '@lucide/svelte';
	import { app, setRequest, startRemix, toast } from '../lib/state.svelte.js';
	import { canRemix } from '../lib/remix.js';
	import { transcribeSubmit, pollJob, jobResultTranscribe, balanceVocalLevel } from '../lib/api.js';
	import { deleteSong, putSong } from '../lib/db.js';
	import type { Song } from '../lib/types.js';
	import Waveform from './Waveform.svelte';
	import Menu, { type MenuItem } from './Menu.svelte';
	import Dialog from './Dialog.svelte';
	import ArtworkCover from './ArtworkCover.svelte';
	import { validateArtwork } from '../lib/artwork.js';

	let { song }: { song: Song } = $props();

	let playing = $state(false);
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
			await putSong({ ...$state.snapshot(song), artwork: file });
			song.artwork = file;
			toast('Artwork saved to this track.', 3000, true);
		} catch (error) { toast(error instanceof Error ? error.message : 'Could not save artwork.'); }
		finally { artworkBusy = false; }
	}

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
			const source = song.vocalOriginalAudio ?? song.audio;
			const result = await balanceVocalLevel(source, autoGain ? null : vocalGain);
			song.vocalOriginalAudio = source;
			song.audio = result.audio;
			song.format = 'wav32';
			vocalGain = result.gainDb;
			activeVersion = 'vocal-adjusted';
			playing = false;
			if (song.id != null) await putSong($state.snapshot(song));
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
		const ext = blob.type.includes('mpeg') ? 'mp3' : 'wav';
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
		song.favorite = !song.favorite;
		await putSong($state.snapshot(song));
	}

	function openRename() {
		renameValue = song.name;
		renameOpen = true;
	}

	async function doRename() {
		if (song.id == null) return;
		const v = renameValue.trim();
		if (!v || v === song.name) return;
		song.name = v;
		await putSong($state.snapshot(song));
	}

	async function doRemove() {
		if (song.id == null) return;
		await deleteSong(song.id);
		const idx = app.songs.findIndex((s) => s.id === song.id);
		if (idx >= 0) app.songs.splice(idx, 1);
	}

	// Deletes every non-favorite track in the list, regardless of which
	// card the menu was opened from. The current card is included in the
	// purge if it is not flagged favorite.
	async function doRemoveNonFavorites() {
		const victims = app.songs.filter((s) => !s.favorite);
		for (const s of victims) {
			if (s.id == null) continue;
			await deleteSong(s.id);
		}
		app.songs = app.songs.filter((s) => s.favorite);
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

	// transcribe audio: send the recording to /transcribe and keep the score
	// it heard on the card and in the form. Only the card that was analyzed
	// changes; the lyrics, the style and the mode stay yours.
	async function transcribe(melodyOnly: boolean) {
		try {
			const jobId = await transcribeSubmit(song.audio, melodyOnly);
			await pollJob(jobId);
			const result = await jobResultTranscribe(jobId);
			song.score = result.abc ?? '';
			song.request = { ...song.request, abc: song.score };
			if (song.id != null) await putSong($state.snapshot(song));
			app.request.abc = song.score;
			toast('Transcribed: ' + song.name, 4000, true);
		} catch (e) {
			toast('Transcription failed: ' + (e instanceof Error ? e.message : String(e)));
		}
	}

	// Single action menu: one entry per user intent.
	// Destructive entries open a confirm dialog.
	const actionItems: MenuItem[] = $derived([
		{ icon: Pencil, label: 'Edit prompt', onSelect: load },
		{ icon: Type, label: 'Rename song', onSelect: openRename },
		{ icon: Download, label: 'Download audio', onSelect: downloadAudio },
		...(song.originalAudio ? [{ icon: Download, label: 'Download original take', onSelect: downloadOriginal }] : []),
		...(song.vocalOriginalAudio ? [{ icon: Download, label: 'Download before vocal adjustment', onSelect: downloadBeforeVocalAdjustment }] : []),
		{ icon: Music, label: 'Adjust vocal level', onSelect: () => { vocalGain = 3; vocalError = ''; vocalDialogOpen = true; } },
		{ icon: ImagePlus, label: song.artwork ? 'Replace artwork' : 'Add artwork', disabled: artworkBusy, onSelect: () => artworkInput.click() },
		{ icon: Music, label: 'Transcribe score', onSelect: () => transcribe(false) },
		{ icon: Music, label: 'Transcribe melody', onSelect: () => transcribe(true) },
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
	<div class="track-media" class:with-artwork={!!song.artwork}>
	{#if song.artwork}<ArtworkCover artwork={song.artwork} title={song.name} />{/if}
	<div class="thumb" style={thumbStyle}>
		<button class="play-btn" onclick={toggle} title={playing ? 'Stop' : 'Play'} aria-label={`${playing ? 'Stop' : 'Play'} ${song.name}`}>
			{#if playing}
				<Square size={17} fill="currentColor" />
			{:else}
				<Play size={17} fill="currentColor" />
			{/if}
		</button>
	</div>
	</div>
	<div class="body">
		<div class="card-header">
			<span class="card-name" title={song.name}>{song.name}</span>
			<button type="button" class="remix-track-button" disabled={!canRemix(song)} onclick={() => startRemix(song)} aria-label={`Remix ${song.name}`} title={canRemix(song) ? 'Remix with the original seed' : 'Requires a generated track with saved seeds and audio codes'}>Remix</button>
			<button
				class="icon-btn"
				class:active={song.favorite}
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
			<span class="format-badge">{song.format.toUpperCase()}</span>
			{#if song.style}
				<span class="style-tag" title={song.style}>{song.style}</span>
			{/if}
			<span class="timecode">{fmtPos(time)} / {fmtDur(dur)}</span>
		</div>
	</div>
</div>

<Dialog bind:open={confirmDeleteOpen} title="Delete this track?" onConfirm={doRemove} />

<Dialog
	bind:open={confirmDeleteNonFavOpen}
	title="Delete non-favorites?"
	onConfirm={doRemoveNonFavorites}
/>

<Dialog bind:open={renameOpen} title="Rename song" onConfirm={doRename}>
	{#snippet body()}
		<input type="text" class="rename-input" bind:value={renameValue} />
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
		<button class="dialog-action" onclick={() => applyVocalBalance(true)} disabled={vocalBusy}>{vocalBusy ? 'Separating vocals…' : 'Auto level'}</button>
		<button class="dialog-action primary" onclick={() => applyVocalBalance()} disabled={vocalBusy}>Apply {vocalGain >= 0 ? '+' : ''}{vocalGain} dB</button>
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
	.timecode {
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
