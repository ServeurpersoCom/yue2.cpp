<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from '../lib/state.svelte.js';
	type Snapshot = { ids: string[]; weights: Record<string, number>; prompt?: string };
	type Favourite = { name: string; data: Snapshot };
	let { kind, current, onload }: { kind: 'music' | 'lyric'; current: Snapshot; onload: (data: Snapshot) => void } = $props();
	let entries = $state<Favourite[]>([]);
	let selected = $state('');
	let name = $state('');
	const storageKey = () => `yue2-${kind}-blend-favourites-v1`;
	onMount(() => {
		try {
			const raw = localStorage.getItem(storageKey());
			if (raw) {
				const saved = JSON.parse(raw);
				if (!Array.isArray(saved)) throw new Error('Invalid favourites file');
				entries = saved.filter((item: Favourite) => typeof item?.name === 'string' && item?.data && Array.isArray(item.data.ids));
			} else if (kind === 'music') {
				// Keep legacy storage untouched; import only explicitly saved music text.
				const legacy = JSON.parse(localStorage.getItem('yue2-music-styles') || '[]');
				if (Array.isArray(legacy)) entries = legacy.filter(item => typeof item?.name === 'string' && typeof item?.value === 'string')
					.map(item => ({ name: item.name, data: { ids: [], weights: {}, prompt: item.value } }));
			}
		} catch { toast(`Could not load saved ${kind} blends. Existing storage left untouched.`); }
	});
	function commit(next: Favourite[]) {
		try { localStorage.setItem(storageKey(), JSON.stringify(next)); entries = next; return true; }
		catch { toast('Could not save favourites: browser storage unavailable.'); return false; }
	}
	function save(rename = false) {
		const clean = name.trim();
		if (!clean) { toast('Enter a name for the blend.'); return; }
		if (entries.some(item => item.name.toLowerCase() === clean.toLowerCase() && (!rename || item.name !== selected))) {
			toast('That name already exists. Choose another name or use Update.'); return;
		}
		const existing = entries.find(item => item.name === selected);
		const data = rename ? existing?.data : JSON.parse(JSON.stringify(current));
		if (!data) return;
		const next = rename ? entries.map(item => item.name === selected ? { name: clean, data } : item) : [...entries, { name: clean, data }];
		if (commit(next)) selected = clean;
	}
</script>

<details class="favourites">
	<summary>Saved {kind} blends · {entries.length}</summary>
	<div class="controls">
		<select aria-label={`Saved ${kind} blends`} bind:value={selected} onchange={(event) => { name = event.currentTarget.value; }}>
			<option value="">Choose a saved blend</option>
			{#each entries as entry}<option value={entry.name}>{entry.name}</option>{/each}
		</select>
		<button type="button" disabled={!selected} onclick={() => { const entry = entries.find(item => item.name === selected); if (entry) onload(JSON.parse(JSON.stringify(entry.data))); }}>Load</button>
		<input aria-label={`${kind} blend name`} placeholder="Blend name" bind:value={name} maxlength="100" />
		<button type="button" onclick={() => save()}>Save new</button>
		<button type="button" disabled={!selected} onclick={() => { if (confirm(`Replace saved blend "${selected}" with the current settings?`)) commit(entries.map(item => item.name === selected ? { ...item, data: JSON.parse(JSON.stringify(current)) } : item)); }}>Update</button>
		<button type="button" disabled={!selected} onclick={() => save(true)}>Rename</button>
		<button type="button" disabled={!selected} onclick={() => { if (confirm(`Delete saved blend "${selected}"?`) && commit(entries.filter(item => item.name !== selected))) { selected = ''; name = ''; } }}>Delete</button>
	</div>
</details>

<style>
	.favourites { margin-top: .6rem; padding: .6rem; border: 1px solid var(--border); border-radius: .6rem; }
	summary { cursor: pointer; font-size: .8rem; }
	.controls { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .6rem; }
	select, input { flex: 1 1 140px; min-width: 0; }
	button { padding: .35rem .6rem; }
</style>
