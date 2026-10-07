<script lang="ts">
	import { untrack } from 'svelte';
	import Dialog from './Dialog.svelte';
	import type { Song } from '../lib/types.js';
	import { updateSong } from '../lib/db.js';
	import { downloadYouTubeFile, type YouTubeDraft } from '../lib/youtube.js';
	let { open = $bindable(false), song }: { open: boolean; song: Song } = $props();
	let draft = $state<YouTubeDraft>({ version: 1, title: '', description: '', tags: '', audience: 'review', playlist: '', endScreen: '', visibility: 'private' });
	let message = $state('');
	let busy = $state(false);
    let agent = $state({status:'offline',message:'',studioUrl:''});
    let resumeUrl = $state(''), newUpload = $state(false);
    async function status(){try{const response=await fetch('youtube/status');if(response.ok)agent=await response.json();}catch{}}
    $effect(()=>{if(!open)return;void status();const timer=setInterval(status,2000);return ()=>clearInterval(timer);});
    async function launch(){if(!song.video)return;await save();if(!song.youtubeDraft || JSON.stringify(song.youtubeDraft)!==JSON.stringify($state.snapshot(draft)))return;const form=new FormData();form.append('draft',JSON.stringify($state.snapshot(draft)));form.append('video',song.video,'video.mp4');if(song.artwork)form.append('thumbnail',song.artwork,'cover.png');form.append('resumeUrl',resumeUrl);form.append('newUpload',String(newUpload));try{const response=await fetch('youtube/launch',{method:'POST',body:form});if(!response.ok)throw new Error(await response.text());message='Agent opening. Watch the status below.';await status();}catch(error){message=String(error);}}
    async function control(action:string){try{const response=await fetch('youtube/'+action,{method:'POST'});if(!response.ok)throw new Error(await response.text());await status();}catch(error){message=String(error);}}

	$effect(() => {
		if (open) {
			untrack(() => {
			draft = { version: 1, title: song.name.slice(0, 100), description: song.request.lyrics ?? '', tags: '', audience: 'review', playlist: '', endScreen: '', visibility: 'private', ...song.youtubeDraft };
			message = '';
			});
		}
	});
	async function save(download = false) {
		if (busy) return;
		if (!draft.title.trim() || draft.title.length > 100 || draft.description.length > 5000 || /[<>]/.test(draft.title + draft.description)) {
			message = 'Use a title of 1–100 characters and a description up to 5,000 characters, without angle brackets.'; return;
		}
		busy = true;
		try {
			const saved = $state.snapshot(draft);
			if (song.id == null) throw new Error('Save the track before saving its YouTube draft.');
			await updateSong(song.id, {youtubeDraft:saved});
			song.youtubeDraft = saved;
			if (download) downloadYouTubeFile(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }), `youtube-${song.id ?? song.created}.json`);
			message = download ? 'Draft saved and downloaded. Download the MP4 below, then run the YouTube agent.' : 'Draft saved.';
		} catch (error) { message = error instanceof Error ? error.message : String(error); }
		finally { busy = false; }
	}
</script>

<Dialog bind:open title="Prepare for YouTube">
	{#snippet body()}
		<div class="fields">
			<label>Title<input bind:value={draft.title} maxlength="100" /></label>
			<label>Description<textarea bind:value={draft.description} maxlength="5000" rows="4"></textarea></label>
			<label>Tags (comma separated)<input bind:value={draft.tags} /></label>
			<label>Audience<select bind:value={draft.audience}><option value="review">Choose in Studio</option><option value="kids">Made for kids</option><option value="general">Not made for kids</option></select></label>
			<label>Playlist<input bind:value={draft.playlist} placeholder="Optional playlist name" /></label>
			<label>End screen instructions<textarea bind:value={draft.endScreen} rows="2" placeholder="Example: subscribe + latest video in the last 20 seconds"></textarea></label>
			<label>Intended visibility<select bind:value={draft.visibility}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
			<p>The browser agent fills upload details, then pauses for playlist, end screen, checks and visibility review in Studio. You make the final publish decision there.</p>
			{#if song.video}<button onclick={() => downloadYouTubeFile(song.video!, `youtube-${song.id ?? song.created}.mp4`)}>Download MP4</button>{:else}<p>Use “Export video (MP4)” on this song first.</p>{/if}
			{#if song.artwork}<button onclick={() => downloadYouTubeFile(song.artwork!, `youtube-${song.id ?? song.created}.${song.artwork!.type.includes('png') ? 'png' : song.artwork!.type.includes('webp') ? 'webp' : 'jpg'}`)}>Download artwork</button>{/if}
			<section aria-label="YouTube agent"><h3>HipHop Circuit</h3><p>Choose the playlist in the Studio window. The agent never clicks Publish.</p>
            <label>Resume existing Studio video URL<input bind:value={resumeUrl} placeholder="https://studio.youtube.com/video/…/edit" /></label>
            <label><input type="checkbox" bind:checked={newUpload}/> I checked existing drafts and want a new upload</label>
            <button disabled={!song.video||busy} onclick={launch}>{resumeUrl?'Resume existing upload':'Open YouTube agent'}</button>
            <p role="status">{agent.status}: {agent.message}</p>
            {#if agent.status==='confirm-channel'}<button onclick={()=>control('continue')}>Confirm HipHop Circuit &amp; upload</button>{/if}
            {#if agent.studioUrl}<a href={agent.studioUrl} target="_blank" rel="noreferrer">Open existing Studio draft</a>{/if}
            {#if !['offline','idle'].includes(agent.status)}<button onclick={()=>control('stop')}>Close agent browser</button>{/if}
            </section>
			{#if message}<p role="status">{message}</p>{/if}
		</div>
	{/snippet}
	{#snippet actions(close)}
		<button onclick={close}>Close</button>
		<button disabled={busy} aria-busy={busy} onclick={() => save()}>{busy ? 'Saving…' : 'Save draft'}</button>
		<button disabled={busy} onclick={() => save(true)}>Download draft</button>
	{/snippet}
</Dialog>

<style>
	.fields { display: grid; gap: .6rem; max-height: 65vh; overflow-y: auto; }
	label { display: grid; gap: .2rem; }
	input, textarea, select { width: 100%; box-sizing: border-box; background: var(--bg-card); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: .4rem; }
	button { background: var(--bg-btn); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: .5rem; cursor: pointer; }
	p { margin: .2rem 0; }
</style>
