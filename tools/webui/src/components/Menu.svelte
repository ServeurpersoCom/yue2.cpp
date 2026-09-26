<script lang="ts" module>
	import type { Component } from 'svelte';

	// Public contract: one entry per row in the dropdown. Callers build the
	// array with $derived so disabled flags stay reactive to upstream state.
	// icon is any component that accepts a numeric size prop (Lucide icons
	// match this shape without binding us to @lucide/svelte here).
	export interface MenuItem {
		label: string;
		onSelect: () => void;
		disabled?: boolean;
		icon?: Component<{ size?: number }>;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		trigger,
		items,
		disabled = false
	}: { trigger: Snippet; items: MenuItem[]; disabled?: boolean } = $props();

	let open = $state(false);
	let root: HTMLDivElement;

	function toggle() {
		open = !open;
	}

	function select(item: MenuItem) {
		if (item.disabled) return;
		open = false;
		item.onSelect();
	}

	// Close on click outside and on Escape. Listeners attach only while the
	// menu is open so idle cards add zero global event cost. mousedown wins
	// over click: it fires before the item's onclick, but the check lives
	// inside root.contains so clicking an item still lets its handler run.
	$effect(() => {
		if (!open) return;
		const onDocMouseDown = (e: MouseEvent) => {
			if (!root.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		document.addEventListener('mousedown', onDocMouseDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDocMouseDown);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="menu" bind:this={root}>
	<button type="button" class="menu-trigger" class:open {disabled} onclick={toggle}>
		{@render trigger()}
	</button>
	{#if open}
		<div class="menu-items">
			{#each items as item}
				{@const Icon = item.icon}
				<button
					type="button"
					class="menu-item"
					class:danger={item.label.toLowerCase().startsWith('delete')}
					disabled={item.disabled}
					onclick={() => select(item)}
				>
					{#if Icon}<Icon size={14} />{/if}
					{item.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.menu {
		position: relative;
		display: inline-block;
	}
	.menu-trigger {
		background: none;
		border: 1px solid transparent;
		border-radius: 7px;
		cursor: pointer;
		padding: 0.3rem;
		color: var(--fg-faint);
		display: flex;
		align-items: center;
		transition:
			color 0.15s,
			background 0.15s,
			border-color 0.15s;
	}
	.menu-trigger:hover,
	.menu-trigger.open {
		color: var(--fg);
		background: var(--bg-btn);
		border-color: var(--border);
	}
	.menu-items {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		background: var(--bg-card-2);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow);
		border-radius: 10px;
		padding: 0.3rem;
		display: flex;
		flex-direction: column;
		min-width: 11rem;
		z-index: 20;
		animation: menu-in 0.12s ease-out;
	}
	.menu-item {
		background: none;
		border: none;
		border-radius: 7px;
		cursor: pointer;
		padding: 0.45rem 0.6rem;
		color: var(--fg);
		text-align: left;
		font-size: 0.8rem;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		transition: background 0.12s;
	}
	.menu-item:hover:not(:disabled) {
		background: var(--bg-btn-hover);
	}
	.menu-item:disabled {
		color: var(--fg-faint);
		cursor: default;
	}
	.menu-item.danger {
		color: var(--error);
	}
	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
