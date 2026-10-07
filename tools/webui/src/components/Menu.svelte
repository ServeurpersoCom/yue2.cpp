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
	import { tick, type Snippet } from 'svelte';

	let {
		trigger,
		items,
		disabled = false
	}: { trigger: Snippet; items: MenuItem[]; disabled?: boolean } = $props();

	let open = $state(false);
	let root: HTMLDivElement;
	let triggerButton: HTMLButtonElement;
	const id = $props.id();
	let upward = $state(false);
	let availableHeight = $state(480);
	function close(restore = false) {
		open = false;
		if (restore) triggerButton.focus();
	}
	async function show(last = false) {
		const rect = triggerButton.getBoundingClientRect();
		const below = window.innerHeight - rect.bottom - 16;
		const above = rect.top - 16;
		upward = below < 350 && above > below;
		availableHeight = Math.max(100, Math.min(480, upward ? above : below));
		open = true;
		await tick();
		const choices = root.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)');
		choices[last ? choices.length - 1 : 0]?.focus();
	}

	function toggle() {
		if (open) close(true); else void show();
	}

	function select(item: MenuItem) {
		if (item.disabled) return;
		close(true);
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
			if (e.key === 'Escape') { e.preventDefault(); close(true); }
			if (e.key === 'Tab') { close(true); return; }
			if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
			e.preventDefault();
			const choices = Array.from(root.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)'));
			const current = choices.indexOf(document.activeElement as HTMLButtonElement);
			const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
			choices[next]?.focus();
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
	<button type="button" class="menu-trigger" class:open {disabled} bind:this={triggerButton} aria-label="Track actions" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onclick={toggle} onkeydown={(event) => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); void show(event.key === 'ArrowUp'); } }}>
		{@render trigger()}
	</button>
	{#if open}
		<div class="menu-items" class:upward role="menu" id={id} aria-label="Track actions" style:max-height={`${availableHeight}px`}>
			{#each items as item}
				{@const Icon = item.icon}
				<button
					type="button"
					class="menu-item"
					role="menuitem"
					tabindex="-1"
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
	.menu-items.upward { top: auto; bottom: calc(100% + 6px); }
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
