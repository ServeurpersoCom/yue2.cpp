<script lang="ts">
	import { app } from '../lib/state.svelte.js';
	import { CircleCheck, CircleAlert } from '@lucide/svelte';
</script>

{#if app.toast}
	<div class="toast" class:ok={app.toastOk} role="status" aria-live="polite" aria-atomic="true">
		{#if app.toastOk}<CircleCheck size={18} />{:else}<CircleAlert size={18} />{/if}
		<span>{app.toast}</span>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.6rem;
		max-width: min(92vw, 32rem);
		background: rgba(20, 24, 35, 0.96);
		backdrop-filter: blur(10px);
		border: 1px solid var(--border-strong);
		color: var(--fg);
		font-size: 0.83rem;
		padding: 0.65rem 1.1rem;
		border-radius: 12px;
		box-shadow: var(--shadow);
		z-index: 9999;
		pointer-events: none;
		animation: toast-in 0.18s ease-out;
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(0.6rem);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}
</style>
