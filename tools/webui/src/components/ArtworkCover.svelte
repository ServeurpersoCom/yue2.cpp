<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { Expand, X, Download } from '@lucide/svelte';
	let { artwork, title }: { artwork: Blob; title: string } = $props();
	let url = $state('');
	let failed = $state(false);
	let open = $state(false);
	let closing = $state(false);
	let trigger: HTMLButtonElement;
	let dialog: HTMLDialogElement;
	let largeImage = $state<HTMLImageElement>();
	let motion: Animation | undefined;
	let previousOverflow: string | undefined;
	const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	$effect(() => {
		const next = URL.createObjectURL(artwork);
		url = next; failed = false;
		return () => URL.revokeObjectURL(next);
	});
	function restoreScroll() {
		if (previousOverflow !== undefined) document.documentElement.style.overflow = previousOverflow;
		previousOverflow = undefined;
	}
	onDestroy(() => { motion?.cancel(); dialog?.close(); restoreScroll(); });

	function thumbnailTransform() {
		if (!largeImage) return 'none';
		const from = trigger.getBoundingClientRect();
		const to = largeImage.getBoundingClientRect();
		return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / Math.max(1, to.width)}, ${from.height / Math.max(1, to.height)})`;
	}
	async function show() {
		if (open || failed) return;
		open = true;
		dialog.showModal();
		previousOverflow = document.documentElement.style.overflow;
		document.documentElement.style.overflow = 'hidden';
		await tick();
		if (!largeImage) return;
		try { await largeImage.decode(); } catch { /* Image error shows the fallback below. */ }
		if (!open || closing || reducedMotion() || failed) return;
		motion = largeImage.animate([
			{ transform: thumbnailTransform(), borderRadius: '12px', opacity: .85 },
			{ transform: 'none', borderRadius: '16px', opacity: 1 }
		], { duration: 430, easing: 'cubic-bezier(.22,1,.36,1)' });
	}
	async function close() {
		if (!open || closing) return;
		closing = true;
		motion?.cancel();
		if (!reducedMotion() && !failed && largeImage) {
			motion = largeImage.animate([
				{ transform: 'none', borderRadius: '16px', opacity: 1 },
				{ transform: thumbnailTransform(), borderRadius: '12px', opacity: .6 }
			], { duration: 280, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
			await motion.finished.catch(() => {});
		}
		dialog.close();
	}
	function didClose() {
		motion?.cancel();
		open = false; closing = false;
		restoreScroll();
		trigger?.focus({ preventScroll: true });
	}
	function download() {
		const link = document.createElement('a');
		const extension = artwork.type === 'image/jpeg' ? 'jpg' : artwork.type === 'image/webp' ? 'webp' : 'png';
		link.href = url;
		link.download = `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '') || 'track'}-artwork.${extension}`;
		link.click();
	}
</script>

<button type="button" class="art-cover" bind:this={trigger} onclick={show} aria-label={`Expand artwork for ${title}`} aria-haspopup="dialog" disabled={failed}>
	{#if url && !failed}<img src={url} alt={`Artwork for ${title}`} onerror={() => { failed = true; }} />{:else}<span class="fallback">Artwork unavailable</span>{/if}
	{#if !failed}<span class="expand-hint" aria-hidden="true"><Expand size={16} /></span>{/if}
</button>

<dialog class="art-dialog" class:closing bind:this={dialog} aria-label={`Artwork for ${title}`} oncancel={(event) => { event.preventDefault(); void close(); }} onclose={didClose} onclick={(event) => { if (event.target === dialog) void close(); }}>
	<div class="art-panel">
		<div class="art-header"><div><span class="art-eyebrow">TRACK ARTWORK</span><h2>{title}</h2></div><button type="button" class="art-close" aria-label="Close artwork" onclick={close}><X size={22} /></button></div>
		{#if url}<img class="large-art" bind:this={largeImage} src={url} alt={`Full artwork for ${title}`} onerror={() => { failed = true; }} />{/if}
		<div class="art-footer"><span>Escape or click outside to close</span><button type="button" onclick={download}><Download size={15} /> Save artwork</button></div>
	</div>
</dialog>

<style>
	.art-cover { width: 116px; aspect-ratio: 1; border: 1px solid var(--border-strong); border-radius: 13px; padding: 0; overflow: hidden; position: relative; background: var(--bg-card-2); cursor: zoom-in; display: block; box-shadow: 0 8px 20px #0003; }
	.art-cover img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .35s cubic-bezier(.22,1,.36,1); }
	.art-cover:hover img { transform: scale(1.04); }
	.expand-hint { position: absolute; right: 7px; bottom: 7px; display: grid; place-items: center; width: 27px; height: 27px; background: #0009; border-radius: 8px; color: #fff; opacity: .65; transition: opacity .2s; }
	.art-cover:hover .expand-hint, .art-cover:focus-visible .expand-hint { opacity: 1; }
	.fallback { color: var(--fg-dim); font-size: .7rem; padding: .5rem; }
	.art-dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 24px; border: 0; background: transparent; color: var(--fg); overflow: auto; }
	.art-dialog[open] { display: grid; place-items: center; }
	.art-dialog::backdrop { background: #05060ce6; backdrop-filter: blur(16px); animation: shade-in .3s ease both; }
	.art-panel { width: fit-content; max-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 16px; }
	.art-header, .art-footer { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
	.art-header h2 { font-size: clamp(1rem, 2vw, 1.5rem); font-weight: 600; line-height: 1.3; margin-top: 5px; overflow-wrap: anywhere; }
	.art-eyebrow { color: var(--accent); font-size: .6rem; letter-spacing: .18em; }
	.large-art { display: block; width: auto; height: auto; max-width: min(84vw, 1000px); max-height: calc(100dvh - 200px); object-fit: contain; border-radius: 16px; box-shadow: 0 24px 90px #0008; transform-origin: top left; }
	.art-close, .art-footer button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--bg-card-2); color: var(--fg); border: 1px solid var(--border-strong); border-radius: 12px; padding: 11px; cursor: pointer; flex-shrink: 0; }
	.art-footer { color: var(--fg-dim); font-size: .72rem; }
	.art-close:hover, .art-footer button:hover { border-color: var(--accent); }
	.art-dialog.closing .art-header, .art-dialog.closing .art-footer { opacity: 0; transition: opacity .12s; }
	@keyframes shade-in { from { opacity: 0; } to { opacity: 1; } }
	@media (max-width: 600px) { .art-cover { width: 80px; } .art-dialog { padding: 16px; } .large-art { max-width: calc(100vw - 32px); max-height: calc(100dvh - 190px); } .art-footer > span { max-width: 125px; font-size: .65rem; } }
	@media (prefers-reduced-motion: reduce) { .art-cover img, .expand-hint { transition: none; } .art-dialog::backdrop { animation: none; } }
</style>
