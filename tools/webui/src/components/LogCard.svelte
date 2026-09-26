<script lang="ts">
	import { app } from '../lib/state.svelte.js';
	import { SSE_RECONNECT_MS, LOG_MAX_LINES } from '../lib/config.js';
	import { ChevronDown, ChevronRight, Terminal } from '@lucide/svelte';

	let lines = $state<string[]>([]);
	let connected = $state(false);

	$effect(() => {
		let es: EventSource | null = null;
		let timer = 0;

		function connect() {
			es = new EventSource('logs');
			es.onopen = () => { connected = true; };
			es.onmessage = (e: MessageEvent) => {
				lines.push(e.data);
				if (lines.length > LOG_MAX_LINES) lines.splice(0, lines.length - LOG_MAX_LINES);
			};
			es.onerror = () => {
				connected = false;
				es?.close();
				es = null;
				lines.push('[Client] Server unavailable');
				if (lines.length > LOG_MAX_LINES) lines.splice(0, lines.length - LOG_MAX_LINES);
				timer = setTimeout(connect, SSE_RECONNECT_MS) as unknown as number;
			};
		}

		connect();
		return () => {
			clearTimeout(timer);
			es?.close();
		};
	});
</script>

<div class="card">
	<button class="card-header" aria-expanded={app.logsOpen} onclick={() => (app.logsOpen = !app.logsOpen)}>
		{#if app.logsOpen}
			<ChevronDown size={14} />
		{:else}
			<ChevronRight size={14} />
		{/if}
		<Terminal size={13} />
		<span class="card-label">Studio activity</span>
		<span class="live-dot" class:disconnected={!connected} title={connected ? 'Connected to server logs' : 'Connecting to server logs'}></span>
	</button>
	{#if app.logsOpen}
		<pre class="log-body">{lines.join('\n')}</pre>
	{/if}
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-card);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	.card-header {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.55rem 0.8rem;
		background: var(--bg-card-2);
		border: none;
		border-bottom: 1px solid transparent;
		cursor: pointer;
		color: var(--fg-dim);
		font-size: 0.76rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		text-align: left;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.card-header:hover {
		color: var(--fg);
		background: var(--bg-btn);
	}
	.live-dot {
		margin-left: auto;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--ok);
		box-shadow: 0 0 8px var(--ok);
		animation: blink 2.4s ease-in-out infinite;
	}
	.live-dot.disconnected { background: var(--fg-faint); box-shadow: none; animation: none; }
	.log-body {
		margin: 0;
		padding: 0.6rem 0.8rem;
		max-height: 12rem;
		overflow: auto;
		font-family: ui-monospace, 'Cascadia Mono', monospace;
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--fg-dim);
		background: var(--bg-input);
		white-space: pre;
	}
	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
</style>
