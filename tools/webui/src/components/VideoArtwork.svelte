<script lang="ts">
	import ArtworkCover from './ArtworkCover.svelte';
	let { video, title }: { video: Blob; title: string } = $props();
	let artwork = $state<Blob>();
	let failed = $state(false);
	$effect(() => {
		const url = URL.createObjectURL(video);
		const player = document.createElement('video');
		let cancelled = false;
		artwork = undefined;
		failed = false;
		player.muted = true;
		player.preload = 'auto';
		const timer = setTimeout(() => { if (!cancelled && !artwork) failed = true; }, 15000);
		player.onerror = () => { clearTimeout(timer); if (!cancelled) failed = true; };
		player.onloadeddata = () => {
			if (cancelled) return;
			try {
				const canvas = document.createElement('canvas');
				const scale = Math.min(1, 1920 / player.videoWidth);
				canvas.width = Math.round(player.videoWidth * scale);
				canvas.height = Math.round(player.videoHeight * scale);
				const context = canvas.getContext('2d');
				if (!context || !canvas.width || !canvas.height) throw new Error('No frame');
				context.drawImage(player, 0, 0, canvas.width, canvas.height);
				canvas.toBlob(blob => {
					clearTimeout(timer);
					if (cancelled) return;
					if (blob) { artwork = blob; failed = false; } else failed = true;
				}, 'image/png');
			} catch { clearTimeout(timer); failed = true; }
		};
		player.src = url;
		return () => {
			cancelled = true;
			clearTimeout(timer);
			player.onloadeddata = null;
			player.onerror = null;
			player.removeAttribute('src');
			player.load();
			URL.revokeObjectURL(url);
		};
	});
</script>

{#if artwork}
	<ArtworkCover {artwork} {title} />
{:else}
	<div class="cover-status" role="status">{failed ? 'Cover unavailable' : 'Loading cover…'}</div>
{/if}

<style>
	.cover-status { width:116px; aspect-ratio:1; display:grid; place-items:center; text-align:center; padding:8px; border:1px solid var(--border); border-radius:13px; color:var(--fg-dim); font-size:.7rem; }
	@media(max-width:600px) { .cover-status { width:80px; } }
</style>
