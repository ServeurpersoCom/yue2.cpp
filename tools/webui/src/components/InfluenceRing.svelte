<script lang="ts">
	import { angleInfluence, clampInfluence } from '../lib/style-mix.js';
	let { name, value, color, thumbnail, onchange }: { name: string; value: number; color: string; thumbnail?: string; onchange: (value: number) => void } = $props();
	let dialStyle = $derived(`--color:${color};--fill:${value}%;--thumbnail:${thumbnail ? `url("${thumbnail}")` : 'none'}`);
	let dragging = false;
	function move(event: PointerEvent) {
		if (!dragging) return;
		const box = event.currentTarget as HTMLElement;
		const rect = box.getBoundingClientRect();
		onchange(angleInfluence(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2));
	}
	function key(event: KeyboardEvent) {
		const changes: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
		if (event.key in changes || event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			onchange(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : clampInfluence(value + changes[event.key]));
		}
	}
</script>

<div class="dial" role="slider" tabindex="0" aria-label={`${name} influence`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={value} aria-valuetext={`${value}% relative influence`} style={dialStyle}
	onpointerdown={(event) => { dragging = true; event.currentTarget.setPointerCapture(event.pointerId); move(event); }}
	onpointermove={move} onpointerup={() => { dragging = false; }} onpointercancel={() => { dragging = false; }} onlostpointercapture={() => { dragging = false; }} onkeydown={key}>
	<span>{value}%</span>
</div>
<label class="exact">Influence <input aria-label={`${name} exact influence`} type="number" min="0" max="100" value={value} oninput={(event) => onchange(clampInfluence(Number(event.currentTarget.value), value))} />%</label>

<style>
	.dial { width: 90px; height: 90px; border-radius: 50%; background: conic-gradient(var(--color) var(--fill), #ffffff18 0); display: grid; place-items: center; touch-action: none; cursor: pointer; margin: .4rem auto; }
	.dial span { background-color: var(--bg, #16161e); background-image: linear-gradient(#06161599,#06161599),var(--thumbnail,none); background-position:center; background-size:cover; border:1px solid #ffffff20; border-radius:50%; width:70px; height:70px; display:grid; place-items:center; font-weight:700; color:#f2fffb; text-shadow:0 1px 3px #000; pointer-events:none; }
	.dial:focus-visible { outline: 3px solid var(--color); outline-offset: 4px; }
	.exact { display: flex; gap: .25rem; align-items: center; font-size: .7rem; }
	.exact input { width: 3.7rem; padding: .25rem; }
</style>
