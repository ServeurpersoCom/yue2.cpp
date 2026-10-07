<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import DialogButton from './DialogButton.svelte';

	let {
		open = $bindable(false),
		title,
		body,
		actions,
		onConfirm
	}: {
		open: boolean;
		title: string;
		body?: Snippet;
		actions?: Snippet<[() => void]>;
		onConfirm?: () => void;
	} = $props();

	let root = $state<HTMLDivElement>();
	const titleId = $props.id();

	function cancel() {
		open = false;
	}

	function confirm() {
		open = false;
		onConfirm?.();
	}

	// Same outside-click pattern as Menu.svelte. Listeners attach only while
	// open so closed dialogs cost nothing globally. Escape always cancels.
	// Enter confirms only when the default Cancel/OK footer is in use; with a
	// custom actions snippet the user picks an explicit button.
	$effect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		let cancelled = false;
		const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
		void tick().then(() => { if (!cancelled) (focusable()[0] ?? root)?.focus(); });
		const onMouseDown = (e: MouseEvent) => {
			if (!root?.contains(e.target as Node)) cancel();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); cancel(); }
			else if (e.key === 'Enter' && !actions && e.target instanceof HTMLInputElement && !e.isComposing) { e.preventDefault(); confirm(); }
			else if (e.key === 'Tab') {
				const choices = focusable();
				const first = choices[0];
				const last = choices[choices.length - 1];
				if (!first) { e.preventDefault(); root?.focus(); }
				else if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) { e.preventDefault(); last.focus(); }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		};
		document.addEventListener('mousedown', onMouseDown);
		document.addEventListener('keydown', onKey);
		return () => {
			cancelled = true;
			document.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('keydown', onKey);
			if (previous?.isConnected) previous.focus();
		};
	});
</script>

{#if open}
	<div class="dialog-overlay">
		<div class="dialog" bind:this={root} role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1">
			<div class="dialog-title" id={titleId}>{title}</div>
			{#if body}
				<div class="dialog-body">{@render body()}</div>
			{/if}
			<div class="dialog-footer">
				{#if actions}
					{@render actions(cancel)}
				{:else}
					<DialogButton onclick={cancel}>Cancel</DialogButton>
					<DialogButton onclick={confirm} primary>OK</DialogButton>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(4, 5, 8, 0.66);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		animation: overlay-in 0.15s ease-out;
	}
	.dialog {
		background: var(--bg-card-2);
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		box-shadow: var(--shadow);
		padding: 1.1rem;
		min-width: 17rem;
		max-width: min(92vw, 28rem);
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		animation: dialog-in 0.18s ease-out;
	}
	.dialog-title {
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--fg);
	}
	.dialog-body {
		font-size: 0.83rem;
		line-height: 1.55;
		color: var(--fg-dim);
	}
	.dialog-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	@keyframes overlay-in {
		from {
			opacity: 0;
		}
	}
	@keyframes dialog-in {
		from {
			opacity: 0;
			transform: translateY(0.6rem) scale(0.98);
		}
	}
</style>
