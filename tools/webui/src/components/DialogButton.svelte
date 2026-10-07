<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		onclick,
		children,
		primary = false
	}: {
		onclick: (e: MouseEvent) => void;
		children: Snippet;
		primary?: boolean;
	} = $props();
</script>

<button type="button" {onclick} class:primary>{@render children()}</button>

<style>
	button {
		background: var(--bg-btn);
		border: 1px solid var(--border);
		cursor: pointer;
		padding: 0.45rem 1rem;
		color: var(--fg);
		font-size: 0.82rem;
		font-weight: 600;
		border-radius: 9px;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	button:hover {
		background: var(--bg-btn-hover);
		border-color: var(--border-strong);
	}
	button.primary {
		background: var(--accent-grad);
		border: none;
		color: #fff;
		box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
	}
	button.primary:hover {
		filter: brightness(1.1);
	}
</style>
