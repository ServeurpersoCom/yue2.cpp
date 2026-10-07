<script lang="ts">
	import { app } from '../lib/state.svelte.js';
	import { activity, logTone } from '../lib/activity.svelte.js';
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
        let stopped=false, hadServerJob=false;
        const poll=async()=>{try {const response=await fetch('jobs',{signal:AbortSignal.timeout(5000)});if(!response.ok)return;const jobs=await response.json();if(stopped)return;
            if(jobs.length){hadServerJob=true;const job=jobs[0];activity.running=true;activity.stage=job.stage;activity.detail=`Job ${job.id.slice(0,8)} · ${jobs.length-1} waiting · ${job.elapsed}s in stage`;activity.percent=job.total?100*job.done/job.total:null;activity.eta=job.done>0?job.elapsed/job.done*(job.total-job.done):null;}
            else if(!activity.running || (hadServerJob && !['Creating artwork','Rendering MP4'].includes(activity.stage))){hadServerJob=false;activity.running=false;activity.stage='Ready';activity.detail='No server jobs queued';activity.percent=null;activity.eta=null;}
        }catch{/* logs show the connection state */}};
        void poll();const polling=setInterval(poll,1500);
        return () => {
			stopped=true;clearInterval(polling);
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
	<div class="progress-panel" aria-label="Generation progress">
		<div class="progress-heading"><strong>{connected ? activity.stage : 'Reconnecting…'}</strong><span>{activity.running && connected && activity.percent !== null ? `${Math.floor(activity.percent)}%` : activity.running ? 'Working' : 'Idle'}</span></div>
		{#if activity.running && connected && activity.percent === null}<progress aria-label={activity.stage}></progress>{:else}<progress aria-label={activity.stage} max="100" value={activity.running && connected ? activity.percent ?? 0 : 0}></progress>{/if}
		<div class="progress-detail"><span>{connected ? activity.detail || 'Start a track to see its progress' : 'Waiting for the server connection'}</span><strong>{activity.running && connected && activity.eta !== null ? `Stage ETA ≈ ${Math.floor(Math.ceil(activity.eta) / 60)}:${String(Math.ceil(activity.eta) % 60).padStart(2, '0')}` : activity.running ? 'ETA: unavailable' : 'ETA: —'}</strong></div>
	</div>
	{#if app.logsOpen}
		<div class="log-legend"><span class="compose">Compose</span><span class="render">Render</span><span class="audio">Audio</span><span class="success">Complete</span><span class="error">Error</span></div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable logs need keyboard access.) -->
		<div class="log-body" role="region" aria-label="Server activity log" tabindex="0">{#each lines as line}<div class={`log-line ${logTone(line)}`}>{line}</div>{/each}</div>
	{/if}
</div>

<style>
	.progress-panel { padding:.8rem; display:grid; gap:.5rem; background:var(--bg-card-2); border-top:1px solid var(--border); }
	.progress-heading,.progress-detail {display:flex;justify-content:space-between;gap:.6rem;align-items:center;}
	.progress-heading {font-size:.78rem;color:var(--fg);}
	.progress-heading > span {color:var(--accent);font-variant-numeric:tabular-nums;}
	.progress-detail {font-size:.66rem;color:var(--fg-dim);align-items:flex-start;}
	.progress-detail strong {white-space:nowrap;font-weight:500;}
	progress {appearance:none;width:100%;height:8px;border:0;border-radius:9px;overflow:hidden;background:var(--bg-input);accent-color:#35d7b6;}
	progress::-webkit-progress-bar {background:var(--bg-input);border-radius:9px;}
	progress::-webkit-progress-value {background:linear-gradient(90deg,#9476f5,#4cc6ed,#36d9b4);border-radius:9px;transition:width .3s;}
	progress:indeterminate {background:linear-gradient(90deg,var(--bg-input),#9074da,var(--bg-input));background-size:200% 100%;animation:working 2s linear infinite;}
	progress:indeterminate::-webkit-progress-bar {background:transparent;}
	.log-legend {display:flex;flex-wrap:wrap;gap:.7rem;padding:.45rem .8rem;background:#101522;font-size:.62rem;}
	.log-line {padding:.2rem .4rem;border-left:2px solid currentColor;margin:.15rem 0;background:#ffffff03;}
	.info {color:#a9c7e8;} .compose {color:#c3a5ff;} .render {color:#71cfff;} .audio {color:#ffd18a;} .success {color:#64dfad;} .warning {color:#ffbb6c;} .error {color:#ff8f9d;}
	@keyframes working {to {background-position:-200% 0;}}
	@media(prefers-reduced-motion:reduce){progress:indeterminate {animation:none;}}
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
		color: #a9c7e8;
		background: #0a101b;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
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
