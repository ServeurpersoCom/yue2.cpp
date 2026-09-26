<script lang="ts">
	let { showLog = true }: { showLog?: boolean } = $props();
	import { Search, Star, ArrowUpRight, Download, Upload } from '@lucide/svelte';
	import { app, toast } from '../lib/state.svelte.js';
	import { exportLibrary, importLibrary } from '../lib/backup.js';
	import { getAllSongs, replaceAllSongs } from '../lib/db.js';
	import SongCard from './SongCard.svelte';
	import LogCard from './LogCard.svelte';
	let query = $state('');
	let favouritesOnly = $state(false);
	let takeGroup = $state('');
	const takeGroups = $derived([...new Map(app.songs.filter(song => song.takeGroup).map(song => [song.takeGroup!, song.name.replace(/ · Take \d+.*$/, '')])).entries()]);
	let backupBusy = $state(false);
	let backupInput: HTMLInputElement;
	let filtered = $derived(app.songs.filter(song => (!takeGroup || song.takeGroup === takeGroup) && (!favouritesOnly || song.favorite) && `${song.name} ${song.style}`.toLowerCase().includes(query.trim().toLowerCase())));
	const backupSettings = ['yue2', 'yue2-music-blend-favourites-v1', 'yue2-lyric-blend-favourites-v1', 'yue2-music-styles'];
	async function exportBackup() {
		if (backupBusy || app.songs.length === 0) return;
		backupBusy = true;
		try {
			const blob = await exportLibrary(app.songs);
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `yue2-library-${new Date().toISOString().slice(0, 10)}.zip`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			toast('Library backup downloaded.', 4000, true);
		} catch (error) { toast(error instanceof Error ? error.message : 'Could not create library backup.'); }
		finally { backupBusy = false; }
	}
	async function restoreBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || backupBusy) return;
		backupBusy = true;
		try {
			const backup = await importLibrary(file);
			const accepted = window.confirm(`Restore ${backup.songs.length} tracks from this backup? This replaces your current ${app.songs.length} tracks.`);
			if (!accepted) return;
			await replaceAllSongs(backup.songs);
			let settingsRestored = true;
			try {
				for (const key of backupSettings) {
					if (Object.hasOwn(backup.settings, key)) localStorage.setItem(key, backup.settings[key]);
				}
			} catch { settingsRestored = false; }
			app.songs = await getAllSongs();
			toast(settingsRestored ? 'Library restored. Reloading saved settings…' : 'Tracks restored, but browser settings could not be restored.', 3500, settingsRestored);
			setTimeout(() => location.reload(), 700);
		} catch (error) { toast(error instanceof Error ? error.message : 'Could not restore library backup.'); }
		finally { backupBusy = false; }
	}
</script>

<div class="song-list">
	{#if takeGroups.length}<label class="take-comparison">Compare takes <select aria-label="Compare takes" bind:value={takeGroup}><option value="">All tracks</option>{#each takeGroups as [id, name]}<option value={id}>{name} · {app.songs.filter(song => song.takeGroup === id).length} takes</option>{/each}</select><small>Audition the saved takes below and star your favourite. Compare hook, diction, delivery and ending.</small></label>{/if}
	<div class="library-tools">
		<label class="search"><Search size={15} /><input aria-label="Search tracks" type="search" placeholder="Find a track or a sound…" bind:value={query} /></label>
		<button class:active={favouritesOnly} aria-pressed={favouritesOnly} onclick={() => { favouritesOnly = !favouritesOnly; }} title="Show favourite tracks"><Star size={14} /> Favourites</button>
		<button disabled={backupBusy || app.songs.length === 0} onclick={exportBackup} title="Download a backup of your tracks and settings"><Download size={14} /> Backup</button>
		<button disabled={backupBusy} onclick={() => backupInput?.click()} title="Replace this library from a YuE2 backup"><Upload size={14} /> Restore</button>
		<input bind:this={backupInput} class="file-input" type="file" accept=".zip,application/zip" aria-label="Choose a YuE2 library backup" onchange={restoreBackup} />
	</div>
	{#if app.songs.length === 0}
		<div class="empty">
			<div class="record-scene" aria-hidden="true"><div class="record-sleeve"></div><div class="record"><span></span></div><span class="record-tag">SIDE A / YOUR NEXT IDEA</span></div>
			<p class="empty-kicker">A BLANK CANVAS. ENDLESS POSSIBILITIES.</p>
			<p class="empty-title">Your sound belongs here.</p>
			<p class="empty-sub">
				Start with a feeling, a few words, or a sound you can't get out of your head. Your generated tracks will appear in this collection.
			</p>
			<a class="start-link" href="#music-workbench">Shape your first track <ArrowUpRight size={15} /></a>
		</div>
	{:else if filtered.length === 0}
		<div class="no-results"><Search size={22} /><p>No tracks match this view.</p><button onclick={() => { query = ''; favouritesOnly = false; takeGroup = ''; }}>Show all tracks</button></div>
	{/if}
	{#each filtered as song (song.id)}
		<SongCard {song} />
	{/each}
	{#if showLog}<LogCard />{/if}
</div>

<style>
	.take-comparison { display:grid; gap:.5rem; padding:1rem; border:1px solid var(--border); border-radius:12px; font-size:.8rem; }
	.take-comparison select { max-width:100%; padding:.5rem; background:var(--bg-card); color:var(--fg); border:1px solid var(--border); }
	.take-comparison small { color:var(--fg-dim); }
	.song-list {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
		padding: 2.5rem 1.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 65%), var(--bg-card);
	}
	.empty-title {
		font-size: clamp(1.25rem, 2vw, 1.75rem);
		font-weight: 600;
		letter-spacing: -.035em;
	}
	.empty-sub {
		font-size: 0.8rem;
		color: var(--fg-dim);
		max-width: 26rem;
		line-height: 1.55;
	}
	.library-tools { display: flex; gap: .6rem; align-items: center; margin-bottom: .25rem; }
	.search { flex: 1; display: flex; align-items: center; gap: .5rem; color: var(--fg-dim); min-width: 0; padding: 0 .75rem; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-card); }
	.search input { width: 100%; border: 0 !important; background: transparent !important; padding: .8rem .2rem !important; font-size: .8rem; }
	.library-tools button, .no-results button { display: inline-flex; align-items: center; gap: .4rem; color: var(--fg-dim); background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: .8rem; cursor: pointer; font-size: .72rem; }
	.library-tools button.active { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg-card)); }
	.library-tools button:disabled { opacity: .5; cursor: not-allowed; }
	.file-input { display: none; }
	.no-results { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem 1rem; color: var(--fg-dim); }
	.record-scene { width: 245px; height: 190px; position: relative; margin: .5rem 0 1.3rem; }
	.record-sleeve { position: absolute; width: 150px; height: 150px; left: 20px; top: 8px; border-radius: 8px; transform: rotate(-9deg); background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 45%, var(--bg-card)), var(--bg-card) 65%); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); box-shadow: 0 15px 30px #0004; }
	.record { display: grid; place-items: center; width: 150px; height: 150px; position: absolute; right: 10px; top: 20px; border-radius: 50%; background: repeating-radial-gradient(circle, #161720 0 2px, #252630 3px, #11121a 4px); box-shadow: 7px 10px 24px #0006; border: 1px solid #42434f; transform: rotate(20deg); }
	.record span { width: 57px; height: 57px; display: grid; place-items: center; border-radius: 50%; background: var(--accent-grad); }
	.record span::after { content: ''; width: 9px; height: 9px; background: #12121a; border-radius: 50%; }
	.record-tag { position: absolute; bottom: 0; left: 24px; font: 8px ui-monospace, monospace; letter-spacing: .14em; color: var(--fg-faint); }
	.empty-kicker { font-size: .56rem; letter-spacing: .17em; color: var(--accent); font-weight: 600; margin-bottom: .4rem; }
	.start-link { display: inline-flex; align-items: center; gap: .7rem; text-decoration: none; color: var(--fg); font-size: .77rem; border: 1px solid var(--border-strong); border-radius: 999px; padding: .65rem 1rem; margin-top: 1rem; background: var(--bg-card-2); }
	.start-link:hover { border-color: var(--accent); }
	@media (max-width: 450px) { .library-tools { flex-wrap: wrap; } .search { flex-basis: 100%; } }
</style>
