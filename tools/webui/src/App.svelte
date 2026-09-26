<script lang="ts">
	import { Volume2, AudioWaveform, Wifi, WifiOff, House, Music2, Library, SlidersHorizontal, Settings, Mic2, Sparkles } from '@lucide/svelte';
	import './studio.css';
	import './reference-studio.css';
	import { app } from './lib/state.svelte.js';
	import { props } from './lib/api.js';
	import { getAllSongs } from './lib/db.js';
	import { PROPS_POLL_MS } from './lib/config.js';
	import RequestForm from './components/RequestForm.svelte';
	import SongList from './components/SongList.svelte';
	import StudioRail from './components/StudioRail.svelte';
	import Toast from './components/Toast.svelte';
	import { MUSIC_STYLE_BY_ID } from './lib/style-profiles.js';

	type Theme = 'dark' | 'cyberpunk' | 'colorful' | 'mint' | 'burnt-orange';
	type StudioPage = 'create' | 'library';
	function initialTheme(): Theme {
		try { const saved = localStorage.getItem('yue2-theme'); return ['dark', 'cyberpunk', 'colorful', 'mint', 'burnt-orange'].includes(saved || '') ? saved as Theme : 'mint'; }
		catch { return 'mint'; }
	}
	let theme = $state<Theme>(initialTheme());
	let currentPage = $state<StudioPage>('create');
	function setTheme(next: Theme) {
		theme = next;
		try { localStorage.setItem('yue2-theme', next); } catch { /* Theme still works without storage. */ }
		document.documentElement.dataset.theme = next;
	}

	// boot: load songs from IndexedDB
	$effect(() => {
		getAllSongs()
			.then((songs) => (app.songs = songs.reverse()))
			.catch(() => {});
	});

	// poll /props every PROPS_POLL_MS, null on failure (grey badges)
	function pollProps() {
		props()
			.then((h) => (app.props = h))
			.catch(() => (app.props = null));
	}

	$effect(() => {
		pollProps();
		const id = setInterval(pollProps, PROPS_POLL_MS);
		return () => clearInterval(id);
	});

	function onVolume(e: Event) {
		app.volume = Number((e.target as HTMLInputElement).value);
	}
	function focusSection(id: string) {
		currentPage = 'create';
		requestAnimationFrame(() => { const section = document.getElementById(id); if (section instanceof HTMLDetailsElement) section.open = true; section?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
	}
	$effect(() => {
		if (app.remix) focusSection('engine-workbench');
	});
	function selectQuickStyle(id: string) {
		currentPage = 'create';
		requestAnimationFrame(() => {
			window.dispatchEvent(new CustomEvent('yue2-select-style', { detail: id }));
			document.getElementById('music-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}
	const quickStyles = [
		['001_boom_bap', 'Classic drums'], ['003_underground_hip_hop', 'Dusty & raw'],
		['004_lo_fi_hip_hop', 'Warm & hazy'], ['005_jazz_rap', 'Jazz samples'],
		['013_west_coast_hip_hop', 'West Coast'], ['022_trap', '808s & hi-hats'],
		['030_drill', 'Dark & percussive'], ['048_soul_hip_hop', 'Soulful samples']
	] as const;

	// studio theme is dark-only: pin the class, keep app.dark for persistence
	$effect(() => {
		document.documentElement.classList.add('dark');
		document.documentElement.classList.remove('light');
		document.documentElement.dataset.theme = theme;
	});

	function modelShort(p: string | undefined): string {
		if (!p) return '';
		const parts = p.split(/[/\\]/);
		return (parts[parts.length - 1] || '').replace(/\.gguf$/i, '');
	}

	let statusText = $derived(
		app.props
			? `${modelShort(app.props.model)} · ${Math.round(app.props.context / 1024)}k ctx · ${Math.round(app.props.sample_rate / 1000)} kHz`
			: 'server offline'
	);
</script>

<div class="yue2-app">
	<header class="topbar">
		<div class="brand"><span class="brand-mark"><AudioWaveform size={19} /></span><span class="brand-name">YuE2 Studio</span><span class="brand-version">LOCAL STUDIO</span></div>
		<div class="status-pill" class:online={app.props} class:offline={!app.props} title={statusText}>
			{#if app.props}<Wifi size={13} />{:else}<WifiOff size={13} />{/if}<span>{statusText}</span><span class="status-chevron">⌄</span>
		</div>
		<div class="topbar-spacer"></div>
		<div class="volume"><Volume2 size={15} /><input type="range" min="0" max="1" step="0.01" value={app.volume} oninput={onVolume} aria-label="Playback volume" /></div>
		<label class="topbar-theme"><span class="sr-only">Color theme</span><select aria-label="Color theme" value={theme} onchange={e => setTheme(e.currentTarget.value as Theme)}><option value="mint">Mint</option><option value="dark">Dark</option><option value="cyberpunk">Cyberpunk</option><option value="colorful">Colorful</option><option value="burnt-orange">Burnt Orange</option></select></label>
  <a class="settings-shortcut" href="#settings" aria-label="Studio settings"><Settings size={17} /></a>
	</header>

	<div class="studio-frame">
		<aside class="left-sidebar">
			<nav class="side-nav" aria-label="Main navigation">
				<button type="button" onclick={() => { currentPage = 'create'; requestAnimationFrame(() => document.querySelector('.center-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })); }}><House size={17} /> Home</button>
				<button class:active={currentPage === 'create'} type="button" onclick={() => { currentPage = 'create'; }}><Music2 size={17} /> Create</button>
				<button class:active={currentPage === 'library'} type="button" onclick={() => { currentPage = 'library'; }}><Library size={17} /> Library <span class="side-count">{app.songs.length}</span></button>
				<button type="button" onclick={() => focusSection('music-workbench')}><Sparkles size={17} /> Presets</button>
				<button type="button" onclick={() => focusSection('lyrics-editor')}><Mic2 size={17} /> Lyrics</button>
				<button type="button" onclick={() => focusSection('engine-workbench')}><SlidersHorizontal size={17} /> Mix &amp; Render</button>
				<a href="#settings"><Settings size={17} /> Settings</a>
			</nav>
			<div class="quick-style-block">
				<p class="sidebar-label">QUICK STYLES</p>
				{#each quickStyles as [id, subtitle]}
					{@const style = MUSIC_STYLE_BY_ID[id]}
					<button class="quick-style" type="button" onclick={() => selectQuickStyle(id)} aria-label={`Use ${style.name} style`}><img class="quick-art" src={style.thumbnail} alt="" /><span><strong>{style.name}</strong><small>{subtitle}</small></span></button>
				{/each}
			</div>
			<button class="add-style" type="button" onclick={() => focusSection('music-workbench')}>＋ <span>Add a style</span></button>
		</aside>

			<main class="workspace-main" style:display={currentPage === 'create' ? undefined : 'none'}>
				<div class="center-scroll" id="create"><RequestForm /></div>
				<StudioRail onOpenLibrary={() => currentPage = 'library'} />
			</main>
		{#if currentPage === 'library'}
			<div class="library-workspace">
				<main class="library-main">
					<section class="library-page-head"><div><p class="sidebar-label">YOUR LOCAL COLLECTION</p><h1>Library</h1><p>{app.songs.length} track{app.songs.length === 1 ? '' : 's'} saved on this device</p></div><button type="button" onclick={() => currentPage = 'create'}><Music2 size={15} /> Create a track</button></section>
					<SongList showLog={false} />
				</main>
				<div class="library-rail"><StudioRail onOpenLibrary={() => currentPage = 'library'} showGenerated={false} /></div>
			</div>
		{/if}
	</div>
</div>

<Toast />

<style>
	:global(:root) {
		--bg: #08090d;
		--bg-panel: #0e1016;
		--bg-card: #131722;
		--bg-card-2: #181d29;
		--bg-input: #0a0c11;
		--bg-btn: #202636;
		--bg-btn-hover: #2b3550;
		--fg: #eef1f7;
		--fg-dim: #9aa3b8;
		--fg-faint: #5f6b84;
		--border: rgba(148, 163, 184, 0.14);
		--border-strong: rgba(148, 163, 184, 0.28);
		--accent: #8b5cf6;
		--accent-2: #22d3ee;
		--accent-grad: linear-gradient(135deg, #8b5cf6 0%, #6366f1 55%, #22d3ee 130%);
		--focus: #8b5cf6;
		--error: #f87171;
		--ok: #34d399;
		--waveform-dim: #39415a;
		--waveform-play: #8b5cf6;
		--waveform-range: #22d3ee;
		--radius: 18px;
		--shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
		color-scheme: dark;
	}
	:global(:root[data-theme='cyberpunk']) { --bg:#090014; --bg-panel:#12001e; --bg-card:#1b0730; --bg-card-2:#281044; --bg-input:#0d0018; --bg-btn:#32104a; --bg-btn-hover:#4b1768; --fg:#f7edff; --fg-dim:#d39cff; --fg-faint:#8d57ac; --border:rgba(232,121,249,.25); --border-strong:rgba(34,211,238,.6); --accent:#f0abfc; --accent-2:#22d3ee; --accent-grad:linear-gradient(135deg,#f0abfc,#c026d3 55%,#22d3ee); --focus:#22d3ee; --waveform-play:#f0abfc; --waveform-range:#22d3ee; }
	:global(:root[data-theme='colorful']) { --bg:#111827; --bg-panel:#172554; --bg-card:#1e3a5f; --bg-card-2:#264b73; --bg-input:#0f1b33; --bg-btn:#334e82; --bg-btn-hover:#4566a3; --fg:#f8fafc; --fg-dim:#bfdbfe; --fg-faint:#93c5fd; --border:rgba(125,211,252,.25); --border-strong:rgba(251,191,36,.65); --accent:#f472b6; --accent-2:#facc15; --accent-grad:linear-gradient(135deg,#f472b6,#8b5cf6 50%,#22d3ee); --focus:#facc15; --waveform-play:#f472b6; --waveform-range:#22d3ee; }
	:global(:root[data-theme='mint']) { --bg:#061315; --bg-panel:#091b1d; --bg-card:#0d2123; --bg-card-2:#12282a; --bg-input:#061719; --bg-btn:#102729; --bg-btn-hover:#16383a; --fg:#e8f4f1; --fg-dim:#9bb5ae; --fg-faint:#67817b; --border:rgba(73,170,148,.2); --border-strong:rgba(55,204,175,.52); --accent:#25d9b2; --accent-2:#18ad93; --accent-grad:linear-gradient(135deg,#2ce2bd,#18ad93); --focus:#2be1bc; --waveform-play:#25d9b2; --waveform-range:#18ad93; }
	:global(:root[data-theme='burnt-orange']) { --bg:#160b07; --bg-panel:#24100a; --bg-card:#35170d; --bg-card-2:#4a2112; --bg-input:#1d0d08; --bg-btn:#633019; --bg-btn-hover:#82411f; --fg:#fff7ed; --fg-dim:#fed7aa; --fg-faint:#b98258; --border:rgba(251,146,60,.24); --border-strong:rgba(251,146,60,.65); --accent:#fb923c; --accent-2:#fbbf24; --accent-grad:linear-gradient(135deg,#fb923c,#ea580c 58%,#facc15); --focus:#fb923c; --waveform-play:#fb923c; --waveform-range:#fbbf24; }
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
	}
	:global(body) {
		font-family:
			'Inter',
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		background:
			radial-gradient(1200px 500px at 15% -10%, rgba(139, 92, 246, 0.14), transparent 60%),
			radial-gradient(1000px 500px at 90% -10%, rgba(34, 211, 238, 0.08), transparent 60%),
			var(--bg);
		color: var(--fg);
		min-height: 100dvh;
		-webkit-font-smoothing: antialiased;
	}
	:global(::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
	}
	:global(::-webkit-scrollbar-thumb) {
		background: #262d40;
		border-radius: 8px;
		border: 2px solid var(--bg);
	}
	:global(::-webkit-scrollbar-track) {
		background: transparent;
	}
	.yue2-app {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	header {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.7rem 1.25rem;
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.brand-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 10px;
		background: var(--accent-grad);
		color: #fff;
		box-shadow: 0 4px 16px rgba(139, 92, 246, 0.45);
	}
	.brand-name {
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: 0.01em;
	}
	.brand-version {
		font-size: 0.68rem;
		font-family: ui-monospace, monospace;
		color: var(--fg-faint);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}
	.status-pill {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.72rem;
		font-family: ui-monospace, monospace;
		color: var(--fg-dim);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.32rem 0.75rem;
		max-width: 42vw;
		overflow: hidden;
		white-space: nowrap;
	}
	.status-pill span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.status-pill.online {
		color: var(--ok);
		border-color: rgba(52, 211, 153, 0.35);
	}
	.status-pill.offline {
		color: var(--error);
		border-color: rgba(248, 113, 113, 0.35);
	}
	.volume {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--fg-dim);
	}
	.volume input[type='range'] {
		width: 96px;
		cursor: pointer;
		accent-color: var(--accent);
	}
	main {
		flex: 1;
		width: 100%;
		max-width: 1540px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: minmax(400px, 0.92fr) minmax(0, 1.3fr);
		gap: 1.75rem;
		padding: 0 2rem 2rem;
		align-items: start;
	}
	@media (max-width: 900px) {
		main {
			grid-template-columns: 1fr;
			padding: 0 1rem 1rem;
		}
	}
	.yue2-app { height:100dvh; min-height:0; overflow:hidden; background:#061315; }
	.yue2-app > header.topbar { flex:0 0 62px; }
	.yue2-app main.workspace-main { display:grid; grid-template-columns:minmax(0,1fr) minmax(300px,31%); gap:10px; width:auto; max-width:none; margin:0; padding:10px 12px 12px; align-items:stretch; }
	.yue2-app main.library-main { display:block; width:auto; max-width:none; margin:0; padding:20px; }
	.yue2-app .library-workspace { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,350px); min-width:0; min-height:0; overflow:hidden; }
	@media(max-width:1000px) { .yue2-app main.workspace-main { display:flex; flex-direction:column; padding:8px; } }
	@media(max-width:900px) { .yue2-app .library-workspace { grid-template-columns:minmax(0,1fr) 280px; overflow:auto; } }
	@media(max-width:680px) { .yue2-app { height:auto; min-height:100dvh; overflow:visible; }.yue2-app > header.topbar { position:sticky; top:0; flex-basis:58px; }.yue2-app .status-pill { display:flex; }.yue2-app main.workspace-main { display:flex; padding:7px; }.yue2-app main.library-main { padding:12px; }.yue2-app .library-workspace { display:flex; flex-direction:column; overflow:visible; }.yue2-app .library-rail { display:none; } }
</style>
