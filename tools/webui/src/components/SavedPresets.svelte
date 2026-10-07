<script lang="ts">
	import { onMount } from 'svelte';
	import { Music2, Mic2 } from '@lucide/svelte';
	import { MUSIC_STYLE_BY_ID } from '../lib/style-profiles.js';
	import Dialog from './Dialog.svelte';
	import {toast} from '../lib/state.svelte.js';
	import { listPresets, renamePreset, writePreset } from '../lib/saved-presets.js';
	type Preset = import('../lib/saved-presets.js').SavedPreset;
	let { onload, onmanage }: { onload: (preset: Preset) => void; onmanage: () => void } = $props();
	let presets = $state<Preset[]>([]);
	let unavailable = $state(false);
    let managing=$state(false),selected=$state<Preset>(),newName=$state(''),saving=$state(false),confirmDelete=$state(false);
    async function change(remove=false){if(!selected||saving)return;saving=true;try{if(remove)await writePreset(selected,'delete');else await renamePreset({...selected,name:newName.trim()},selected.name);selected=undefined;confirmDelete=false;await refresh();toast(remove?'Preset deleted.':'Preset renamed.',3000,true);}catch(e){toast(String(e));}finally{saving=false;}}
	async function refresh() { try { presets = await listPresets(); unavailable = false; } catch { unavailable = true; } }
	onMount(() => {
		refresh();
		window.addEventListener('yue2-presets-changed', refresh);
		window.addEventListener('storage', refresh);
		return () => { window.removeEventListener('yue2-presets-changed', refresh); window.removeEventListener('storage', refresh); };
	});
</script>

<div class="quick-style-block">
	<p class="sidebar-label">SAVED PRESETS · {presets.length}</p>
	{#each presets as preset}
		{@const style = preset.kind === 'music' ? MUSIC_STYLE_BY_ID[preset.data.ids[0]] : undefined}
		<button class="quick-style" type="button" onclick={() => onload(preset)} aria-label={`Load ${preset.kind} preset ${preset.name}`} title={preset.name}>
			{#if style?.thumbnail}<img class="quick-art" src={style.thumbnail} alt="" />{:else}<span class="preset-icon">{#if preset.kind === 'music'}<Music2 size={22}/>{:else}<Mic2 size={22}/>{/if}</span>{/if}
			<span><strong>{preset.name}</strong><small>{preset.kind === 'studio' ? 'Full Studio setup' : preset.kind === 'music' ? 'Music' : 'Lyrics'} · {preset.data.ids.length ? `${preset.data.ids.length} styles` : 'Custom direction'}</small></span>
		</button>
	{:else}
		<p class="empty">{unavailable ? 'Saved presets could not be read.' : 'No saved presets yet. Save a music or lyric blend to find it here.'}</p>
	{/each}
</div>
<button class="add-style" type="button" onclick={()=>{managing=true;void refresh();}}>Manage saved presets</button>

<Dialog bind:open={managing} title="Manage saved presets">
 {#snippet body()}
 <p>Saved in the saved_presets folder. Select a preset to rename or delete it.</p>
 {#each presets as preset}<button class="manage-row" onclick={()=>{selected=preset;newName=preset.name;confirmDelete=false;}}>{preset.name} · {preset.kind==='studio'?'Full Studio setup':preset.kind}</button>{/each}
 {#if selected}<label>Preset name<input bind:value={newName} maxlength="150" disabled={saving}/></label>
 <button disabled={saving||!newName.trim()} onclick={()=>change()}>Save name</button>
 {#if confirmDelete}<p>Delete “{selected.name}” from saved presets?</p><button disabled={saving} onclick={()=>change(true)}>Confirm delete preset</button>{:else}<button disabled={saving} onclick={()=>{confirmDelete=true;}}>Delete preset</button>{/if}{/if}
 {/snippet}
 {#snippet actions(close)}<button onclick={()=>{close();onmanage();}}>Edit style blends</button><button onclick={close}>Close</button>{/snippet}
</Dialog>
<style>
    .manage-row{display:block;width:100%;text-align:left;margin:.4rem 0;padding:.65rem}label{display:grid;gap:.4rem}input{padding:.6rem;background:var(--bg-input);color:var(--fg);border:1px solid var(--border)}
	.preset-icon {display:grid;place-items:center;width:40px;height:40px;flex-shrink:0;color:var(--accent);}
	.empty {font-size:.75rem;line-height:1.6;color:var(--fg-dim);padding:8px;}
	:global(html[data-theme='studio']) .empty {color:#bec6e7;}
</style>
