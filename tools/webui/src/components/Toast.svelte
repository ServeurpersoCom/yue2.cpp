<script lang="ts">
	import { app } from '../lib/state.svelte.js';
</script>

{#if app.toast}
	<div class="toast" class:ok={app.toastOk}>
		<span class="dot"></span>
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
	.dot {
		flex-shrink: 0;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--error);
		box-shadow: 0 0 10px var(--error);
	}
	.toast.ok .dot {
		background: var(--ok);
		box-shadow: 0 0 10px var(--ok);
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
