<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from '../lib/state.svelte.js';
	import { listPresets, writePreset, renamePreset } from '../lib/saved-presets.js';
	type Snapshot = { ids: string[]; weights: Record<string, number>; prompt?: string };
	type Favourite = { name: string; data: Snapshot };
	let { kind, current, onload }: { kind: 'music' | 'lyric'; current: Snapshot; onload: (data: Snapshot) => void } = $props();
	let entries = $state<Favourite[]>([]);
	let selected = $state('');
	let name = $state('');
	const storageKey = () => `yue2-${kind}-blend-favourites-v1`;
	let saving = $state(false);
	onMount(() => {
		function loadFromSidebar(event: Event) {
			const detail = (event as CustomEvent).detail;
			if (detail?.kind === kind && Array.isArray(detail?.data?.ids)) {
				onload(structuredClone(detail.data));
				selected = detail.name;
				name = detail.name;
				toast(`Loaded ${kind} preset: ${detail.name}`, 3000, true);
			}
		}
		window.addEventListener('yue2-load-blend', loadFromSidebar);
		async function read() { try {
			entries = (await listPresets()).filter(entry => entry.kind === kind);
			const raw = localStorage.getItem(storageKey());
			let legacyEntries: Favourite[] = [];
			if (raw) {
				const saved = JSON.parse(raw);
				if (!Array.isArray(saved)) throw new Error('Invalid favourites file');
				legacyEntries = saved.filter((item: Favourite) => typeof item?.name === 'string' && item?.data && Array.isArray(item.data.ids));
			} else if (kind === 'music') {
				// Keep legacy storage untouched; import only explicitly saved music text.
				const legacy = JSON.parse(localStorage.getItem('yue2-music-styles') || '[]');
				if (Array.isArray(legacy)) legacyEntries = legacy.filter(item => typeof item?.name === 'string' && typeof item?.value === 'string')
					.map(item => ({ name: item.name, data: { ids: [], weights: {}, prompt: item.value } }));
			}
			// Copy old browser saves into the folder once, keeping their original data.
			if (!localStorage.getItem(`${storageKey()}-folder-migrated`)) {
				for (const entry of legacyEntries) if (!entries.some(saved => saved.name.toLowerCase() === entry.name.toLowerCase())) await writePreset({ ...entry, kind });
				localStorage.setItem(`${storageKey()}-folder-migrated`, '1');
				entries = (await listPresets()).filter(entry => entry.kind === kind);
			}
		} catch (error) { toast(error instanceof Error ? error.message : `Could not load saved ${kind} presets.`); } }
		void read();
		const refresh = async () => { entries = (await listPresets()).filter(p=>p.kind===kind); };
		const changed = () => { void refresh().catch(error=>toast(String(error))); };
		window.addEventListener('yue2-presets-changed',changed);
		return () => { window.removeEventListener('yue2-load-blend', loadFromSidebar); window.removeEventListener('yue2-presets-changed',changed); };
	});
	async function commit(next: Favourite[]) {
		if (saving) return false;
		saving = true;
		try {
			for (const entry of next) {
				const previous = entries.find(saved => saved.name === entry.name);
				if (JSON.stringify(previous) !== JSON.stringify(entry)) await writePreset({...entry,kind},'save',!!previous);
			}
			for (const entry of entries) if (!next.some(saved => saved.name === entry.name)) await writePreset({...entry,kind},'delete');
			entries = (await listPresets()).filter(entry => entry.kind === kind);
			toast('Saved presets updated in the saved_presets folder.',4000,true);
			return true;
		} catch (error) { toast(error instanceof Error ? error.message : 'Could not save preset.'); entries = (await listPresets().catch(() => entries.map(entry => ({...entry,kind})))).filter(entry => entry.kind === kind); return false; }
		finally {saving=false;}
	}
	async function save(rename = false) {
		const clean = name.trim();
		if (!clean) { toast('Enter a name for the blend.'); return; }
		if (entries.some(item => item.name.toLowerCase() === clean.toLowerCase() && (!rename || item.name !== selected))) {
			toast('That name already exists. Choose another name or use Update.'); return;
		}
		const existing = entries.find(item => item.name === selected);
		const data = rename ? existing?.data : JSON.parse(JSON.stringify(current));
		if (!data) return;
		if (rename) { saving=true; try { await renamePreset({name:clean,kind,data},selected); selected=clean; entries=(await listPresets()).filter(p=>p.kind===kind); } catch(error){toast(String(error));} finally{saving=false;} return; }
		const next = rename ? entries.map(item => item.name === selected ? { name: clean, data } : item) : [...entries, { name: clean, data }];
		if (await commit(next)) selected = clean;
	}
</script>

<details class="favourites">
	<summary>Saved {kind} blends · {entries.length}</summary>
	<div class="controls" aria-busy={saving}>
		<select aria-label={`Saved ${kind} blends`} disabled={saving} bind:value={selected} onchange={(event) => { name = event.currentTarget.value; }}>
			<option value="">Choose a saved blend</option>
			{#each entries as entry}<option value={entry.name}>{entry.name}</option>{/each}
		</select>
		<button type="button" disabled={!selected || saving} onclick={() => { const entry = entries.find(item => item.name === selected); if (entry) { onload(JSON.parse(JSON.stringify(entry.data))); toast(`Loaded preset: ${entry.name}`, 3000, true); } }}>Load</button>
		<input aria-label={`${kind} blend name`} disabled={saving} placeholder="Name your preset" bind:value={name} maxlength="100" />
		<button type="button" disabled={saving || !name.trim()} onclick={() => save()}>Save new</button>
		<button type="button" disabled={!selected || saving} onclick={() => { if (confirm(`Replace saved blend "${selected}" with the current settings?`)) commit(entries.map(item => item.name === selected ? { ...item, data: JSON.parse(JSON.stringify(current)) } : item)); }}>Update</button>
		<button type="button" disabled={!selected || saving || !name.trim() || name.trim() === selected} onclick={() => save(true)}>Rename</button>
		<button type="button" disabled={!selected || saving} onclick={async () => { if (confirm(`Delete saved blend "${selected}"?`) && await commit(entries.filter(item => item.name !== selected))) { selected = ''; name = ''; } }}>Delete</button>
	</div>
	{#if saving}<p class="save-status" role="status">Saving preset changes…</p>{/if}
</details>

<style>
	.favourites { margin-top: .6rem; padding: .6rem; border: 1px solid var(--border); border-radius: .6rem; }
	summary { cursor: pointer; font-size: .8rem; }
	.controls { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .6rem; }
	select, input { flex: 1 1 140px; min-width: 0; }
	button { padding: .35rem .6rem; }
	.save-status { color: var(--accent); font-size: .8rem; margin: .5rem 0 0; }
</style>
