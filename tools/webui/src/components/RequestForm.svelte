<script lang="ts">
	import { onMount } from 'svelte';
	import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
	import {
		RotateCcw,
		Download,
		FolderOpen,
		X,
		Sparkles,
		LoaderCircle,
		Dices
	} from '@lucide/svelte';
	import { app, toast, setRequest } from '../lib/state.svelte.js';
	import { example } from '../lib/example.js';
	import { synthSubmit, pollJob, jobResultTracks, cancelJob, JobTerminalError } from '../lib/api.js';
	import { putSong, putJobSongs, getAllSongs, saveJob, loadJob, clearJob } from '../lib/db.js';
	import { buildSparse, clearSection, emptyRequest } from '../lib/fields.js';
	import { COT_FULL, COT_MELODY, COT_OFF } from '../lib/config.js';
	import type { Yue2Request, Song } from '../lib/types.js';
	import type { PendingJob } from '../lib/db.js';
	import Dialog from './Dialog.svelte';
	import DialogButton from './DialogButton.svelte';
	import { discoverLyricModels, writeLyrics, type LyricModel } from '../lib/ollama.js';
	import { lyricStyleInstructions, LYRIC_PACK_STYLES, LEGACY_LYRIC_CHOICES, LYRIC_STYLE_CHOICES } from '../lib/lyric-styles.js';
	import InfluenceRing from './InfluenceRing.svelte';
	import SamplingControls from './SamplingControls.svelte';
	import BlendFavourites from './BlendFavourites.svelte';
	import { cleanMix, freeformMusicPrompt, musicPrompt } from '../lib/style-mix.js';
	import { automaticProfile, applyAutomaticSettings, hasManualSettings } from '../lib/auto-settings.js';
	import { HIP_HOP_STYLES, MUSIC_STYLE_BY_ID, MUSIC_STYLE_CHOICES, MUSIC_STYLE_DESCRIPTIONS } from '../lib/style-profiles.js';
	import { scrollStrip } from '../lib/scroll-strip.js';
	import { prepareGeneration } from '../lib/generation-request.js';
	import { remixRequest } from '../lib/remix.js';
	import ProducerControls from './ProducerControls.svelte';
	import { applyProducer, cleanProducer, lyricGuidance } from '../lib/producer.js';

	if (!app.request.mastering_profile) app.request.mastering_profile = 'off';
	let busy = $state(false);
	let stopTakes = false;
	let takeProgress = $state('');
	let fileInput: HTMLInputElement;
	let lyricsFileInput: HTMLInputElement;
	let saveFormatOpen = $state(false);
	let takeOpen = $state(false);
	let musicStylePreset = $state('');
	let styleSearch = $state('');
	let freshComposition = $state(true);
	$effect(() => { if (app.remix) freshComposition = false; });
	$effect(() => {
		if (app.remix && (app.request.style !== app.remix.request.style || app.request.lyrics !== app.remix.request.lyrics)) {
			app.remix = null;
			freshComposition = true;
		}
	});
	let previousDirection = app.request.style;
	$effect(() => {
		const direction = app.request.style;
		if (direction !== previousDirection) {
			previousDirection = direction;
			if (!app.remix) freshComposition = true;
		}
	});
	function initialAutomatic() {
		if (app.request.semantic_tokens) return false;
		try { return localStorage.getItem('yue2-production-mode') !== 'manual'; } catch { return true; }
	}
	let automatic = $state(initialAutomatic());
	$effect(() => { try { localStorage.setItem('yue2-production-mode', automatic ? 'auto' : 'manual'); } catch { /* Current mode still works. */ } });
	let requestIdentity = app.request;
	$effect(() => { const next = app.request; if (next !== requestIdentity) { requestIdentity = next; automatic = !hasManualSettings(next) && !next.semantic_tokens; } });
	function setAutomatic(value: boolean) {
		if (!value && automatic) Object.assign(app.request, applyAutomaticSettings(buildSparse(app.request), profile));
		automatic = value;
	}
	let musicMix = $state<string[]>([]);
	let musicMixWeight = $state<Record<string, number>>({});
	const musicStyles = MUSIC_STYLE_CHOICES;
	const musicDescriptions = MUSIC_STYLE_DESCRIPTIONS;
	let musicPromptStrength = $state(100);
	const profile = $derived(automaticProfile(musicMix, musicMixWeight, musicMix.length || musicPromptStrength > 0 ? app.request.style : '', app.props?.defaults));
	function addMusicStyle(id: string) {
		if (!id) return;
		if (!musicMix.includes(id) && musicMix.length >= 3) { toast('Use up to three style profiles per blend to keep the prompt focused.'); return; }
		if (!musicMix.includes(id)) {
			const secondary = musicMix.length > 0;
			musicMix = [...musicMix, id];
			musicMixWeight = {...musicMixWeight, [id]: secondary ? 50 : 100};
		}
		musicStylePreset = '';
		updateMusicPrompt();
	}
	function selectQuickStyle(id: string) {
		musicMix = [];
		musicMixWeight = {};
		addMusicStyle(id);
	}
	let visibleMusicStyles = $derived.by(() => {
		const query = styleSearch.trim().toLocaleLowerCase();
		if (query) return HIP_HOP_STYLES.filter((style) => style.searchText.includes(query));
		return HIP_HOP_STYLES;
	});
	function updateMusicPrompt() {
		app.request.style = musicPrompt(musicMix, musicMixWeight, musicDescriptions, musicStyles);
		mixedMusicPrompt = app.request.style;
	}
	let mixedMusicPrompt = $state('');
	let mixReady = $state(false);
	let storageWarning = false;
	let lyricPreset = $state('pack_02_syllable_dense');
	let lyricMix = $state<string[]>(['pack_02_syllable_dense']);
	let lyricMixWeight = $state<Record<string, number>>({ pack_02_syllable_dense: 100 });
	const lyricProfile = $derived(LYRIC_PACK_STYLES.find(style => style.id === lyricMix[0]));
	function selectPrimaryLyric(id: string) {
		if (!LYRIC_STYLE_CHOICES.some(([key]) => key === id)) return;
		lyricMix = [id, ...lyricMix.slice(1).filter(key => key !== id)].slice(0, 3);
		lyricMixWeight = { ...lyricMixWeight, [id]: 100 };
		lyricPreset = id;
	}
	let lyricTopic = $state('');
	let lyricBusy = $state(false);
	let lyricModels = $state<LyricModel[]>([]);
	let lyricModel = $state('');
	let lyricModelError = $state('');
	let lyricDraft = $state('');
	let lyricController: AbortController | undefined;
	async function refreshLyricModels() {
		try {
			lyricModels = await discoverLyricModels();
			if (!lyricModels.some((m) => m.name === lyricModel)) lyricModel = lyricModels[0]?.name || '';
			lyricModelError = lyricModels.length ? '' : 'No Ollama models installed.';
		} catch (error) {
			lyricModelError = `Cannot reach local Ollama: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	onMount(() => {
		const onQuickStyle = (event: Event) => {
			const id = (event as CustomEvent<string>).detail;
			if (musicDescriptions[id]) selectQuickStyle(id);
		};
		window.addEventListener('yue2-select-style', onQuickStyle);
		void refreshLyricModels();
		return () => { window.removeEventListener('yue2-select-style', onQuickStyle); lyricController?.abort(); };
	});
	const lyricPresets = LYRIC_STYLE_CHOICES;
	async function generateLyrics() {
		if (!lyricTopic.trim() || lyricBusy || !lyricModel) return;
		if (app.producer.enabled && app.producer.presence === 0) { toast('Instrumental mode needs no lyrics. Increase vocal presence to write a vocal part.'); return; }
		if (busy) { toast('Wait for music generation to finish before loading an Ollama model.'); return; }
		lyricBusy = true;
		lyricController = new AbortController();
		const timeout = setTimeout(() => lyricController?.abort(), 600000);
		try {
			const selected = lyricMix.filter((id) => id && (lyricMixWeight[id] ?? 50) > 0);
			if (!selected.length) throw new Error('Choose at least one active lyric engine.');
			const total = selected.reduce((sum, id) => sum + (lyricMixWeight[id] ?? 50), 0);
			const blend = selected.map((id, index) => `${index === 0 ? 'PRIMARY STYLE' : 'SECONDARY STYLE'} (${Math.round(100 * (lyricMixWeight[id] ?? 50) / total)}% relative influence):\n${lyricStyleInstructions(id)}`).join('\n\n');
			const prompt = `You are a professional lyric writer. Write original song lyrics about: ${lyricTopic}\nApply the complete active lyric-style profiles below:\n${blend}\nPreserve the primary style's defining cadence and rhyme behavior. Apply compatible secondary traits at their relative strengths; when rules conflict, the primary style wins. Treat mandatory writing rules as constraints. Silently check the draft against every active Style Compliance Check, revise failed lines, and return only the final lyrics, without the checklist or analysis. Keep musical genre and production separate from lyric construction. Include clear section labels. Avoid filler, cliches, meaningless rhyme, unnatural grammar, and named-artist imitation.`;
			const musicalContext = app.producer.enabled ? lyricGuidance(cleanProducer(app.producer), app.request.style, app.request.duration) : '';
			lyricDraft = await writeLyrics(lyricModel, `${prompt}\n\n${musicalContext}`, lyricController.signal);
		} catch (error) { toast(error instanceof Error ? error.message : 'Lyric generation failed'); }
		finally { clearTimeout(timeout); lyricBusy = false; }
	}

	// elapsed-time readout while a job is running
	let elapsed = $state('');
	let elapsedTimer = 0;
	function startTimer() {
		const t0 = Date.now();
		elapsed = '0:00';
		clearInterval(elapsedTimer);
		elapsedTimer = setInterval(() => {
			const s = Math.floor((Date.now() - t0) / 1000);
			elapsed = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
		}, 1000) as unknown as number;
	}
	function stopTimer() {
		clearInterval(elapsedTimer);
		elapsedTimer = 0;
		elapsed = '';
	}

	let d = $derived(app.props?.defaults);
	let durationAuto = $derived(app.request.duration === 0);
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('yue2-style-mix-v1') || 'null');
			if (saved?.version === 1) {
				if (Number.isFinite(saved.musicPromptStrength)) musicPromptStrength = Math.max(0, Math.min(100, Math.round(saved.musicPromptStrength)));
				if (saved.musicPrompt === app.request.style) {
					const music = cleanMix(saved.musicIds, saved.musicWeights, musicStyles.map(([id]) => id).filter(Boolean), 3);
					musicMix = music.ids; musicMixWeight = music.weights; mixedMusicPrompt = saved.musicPrompt;
					if (musicMix.length) updateMusicPrompt();
				}
				const lyrics = cleanMix(saved.lyricIds, saved.lyricWeights, lyricPresets.map(([id]) => id), 3);
				lyricMix = lyrics.ids; lyricMixWeight = lyrics.weights;
				lyricTopic = typeof saved.topic === 'string' ? saved.topic : '';
			}
		} catch { toast('Saved style blend could not be loaded; generation settings preserved.'); }
		mixReady = true;
	});
	$effect(() => {
		// Imported, reused or manually edited text is authoritative, not stale rings.
		if (mixReady && musicMix.length && app.request.style !== mixedMusicPrompt) {
			musicMix = []; musicMixWeight = {}; musicStylePreset = '';
		}
	});
	$effect(() => {
		if (!mixReady) return;
		const saved = JSON.stringify({ version: 1, musicIds: musicMix, musicWeights: musicMixWeight, musicPromptStrength,
			musicPrompt: mixedMusicPrompt, lyricIds: lyricMix, lyricWeights: lyricMixWeight, topic: lyricTopic });
		try { localStorage.setItem('yue2-style-mix-v1', saved); }
		catch { if (!storageWarning) { storageWarning = true; toast('Style blend could not be saved: browser storage unavailable.'); } }
	});

	// The mode menu shows the published default until a mode is picked, so
	// the request carries a cot only when it is yours.
	let cot = $derived(app.request.cot || d?.cot || '');

	// resume a pending job after page reload, or land a fresh submission.
	// shared tail of both the onMount resume and the generate path.
	async function landJob(job: PendingJob) {
		try { await pollJob(job.id); }
		catch (error) { if (error instanceof JobTerminalError) clearJob(); throw error; }
		const tracks = await jobResultTracks(job.id);
		if (!tracks.length) throw new Error('No audio returned; recovery retained.');
		const completed: Song[] = [];
		// Mastered responses carry an adjacent dry take so one song card can A/B them.
		const now = Date.now();
		for (let i = 0; i < tracks.length; i++) {
			let track = tracks[i];
			let originalAudio: Blob | undefined;
			const next = tracks[i + 1];
			if (track.request.mastering_profile === 'off' && next?.request.mastering_profile && next.request.mastering_profile !== 'off') {
				originalAudio = track.audio;
				track = next;
				i++;
			}
			const r = track.request;
			const song: Song = {
				takeGroup: job.takeGroup,
				name: tracks.length > 1 ? `${job.name} ${completed.length + 1}` : job.name,
				format: r.output_format || job.request.output_format || 'mp3',
				created: now + completed.length,
				style: r.style || '',
				seed: r.lm_seed ?? 0,
				duration: 0,
				score: r.abc || '',
				request: r,
				audio: track.audio,
				originalAudio
			};
			completed.push(song);
		}
		await putJobSongs(job.id, completed);
		clearJob();
		app.songs = (await getAllSongs()).reverse();
		// Scores and audio codes belong to saved tracks, not the next song's input.
	}

	// on mount: resume polling for a pending job in localStorage.
	onMount(() => {
		const job = loadJob();
		if (job) {
			busy = true;
			startTimer();
			landJob(job)
				.catch((error) => {
					toast(`${error instanceof JobTerminalError ? '' : 'Recovery retained: '}${error instanceof Error ? error.message : String(error)}`);
				})
				.finally(() => {
					busy = false;
					stopTimer();
				});
		}
	});

	function reset() {
		app.name = '';
		musicMix = []; musicMixWeight = {}; musicStylePreset = ''; mixedMusicPrompt = '';
		lyricMix = ['syllable_dense']; lyricMixWeight = { syllable_dense: 100 }; lyricTopic = '';
		setRequest(emptyRequest());
	}

	function saveAs(format: 'json' | 'yaml') {
		const req = freshComposition && !app.remix ? applyProducer(buildRequest(), app.producer) : buildRequest();
		const text = format === 'json' ? JSON.stringify(req, null, 2) : yamlStringify(req);
		const mime = format === 'json' ? 'application/json' : 'application/x-yaml';
		const blob = new Blob([text], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const safe = app.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '') || 'request';
		a.download = `${safe}.${format}`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function importJson() {
		fileInput.click();
	}

	function openLyricsFile() {
		lyricsFileInput.click();
	}

	async function onLyricsFileSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const extension = file.name.split('.').pop()?.toLowerCase() || '';
		if (!['txt', 'md', 'lrc', 'srt', 'vtt'].includes(extension)) {
			toast('Choose a plain text lyrics file: TXT, MD, LRC, SRT or VTT.');
			return;
		}
		try {
			app.request.lyrics = (await file.text()).replace(/^\uFEFF/, '');
			toast(`Loaded lyrics from ${file.name}`);
		} catch {
			toast(`Could not read ${file.name}`);
		}
	}

	function onFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		// reset so the same file can be re-opened
		input.value = '';

		const ext = file.name.split('.').pop()?.toLowerCase() || '';

		// MP3 or WAV: a song card with the audio alone, transcribed from the
		// card into a score
		if (ext === 'mp3' || ext === 'wav') {
			openAudio(file, ext);
			return;
		}

		// JSON and YAML share the same load path: parse, push the request into
		// the form, and use the file basename as app.name.
		const parsers: Record<string, (s: string) => Yue2Request> = {
			json: JSON.parse,
			yml: yamlParse,
			yaml: yamlParse
		};
		const parse = parsers[ext];
		if (!parse) {
			toast('Unsupported file type: ' + ext);
			return;
		}
		file
			.text()
			.then((text) => {
				const parsed = parse(text) as any;

				// optional title field: lets a LLM authored YAML/JSON pre-fill
				// the song name on import. Stripped before setRequest.
				const importedName =
					typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : '';
				delete parsed.title;
				setRequest(parsed as Yue2Request);
				app.name = importedName || file.name.replace(/\.(json|ya?ml)$/i, '') || 'Imported';
			})
			.catch(() => {
				toast(`Invalid ${ext.toUpperCase()} file`);
			});
	}

	// open audio file: create song card with audio only (no server call).
	// use Transcribe on the card to read its score.
	async function openAudio(file: File, ext: string) {
		const blob = new Blob([await file.arrayBuffer()], {
			type: ext === 'wav' ? 'audio/wav' : 'audio/mpeg'
		});
		const name = file.name.replace(/\.(mp3|wav)$/i, '') || 'Imported';
		const song: Song = {
			name,
			format: ext,
			created: Date.now(),
			style: '',
			seed: 0,
			duration: 0,
			score: '',
			request: emptyRequest(),
			audio: blob
		};
		song.id = await putSong(song);
		app.songs.unshift(song);
		app.name = name;
		toast('Opened: ' + name, 4000, true);
	}

	// snapshot app.request into a clean Yue2Request with proper types.
	// bind:value guarantees app.request always matches the DOM.
	function buildRequest(): Yue2Request {
		let request = buildSparse(app.request);
		if (automatic) request = applyAutomaticSettings(request, profile);
		if (!musicMix.length) request.style = freeformMusicPrompt(app.request.style, musicPromptStrength);
		if (durationAuto) request.duration = 0;
		return request;
	}

	// Example: pick a random official demo prompt, fill the form and name
	// the song after it
	function pickExample() {
		const ex = example();
		setRequest(ex.request);
		app.name = ex.title;
	}

	// Generate: submit the request, poll until done, land the song card.
	// The webui resolves the seeds so the stored request reproduces the song.
	async function generate() {
		if (busy) return;
		if (lyricBusy) { toast('Wait for lyric generation to finish before generating music.'); return; }
		if (loadJob()) { toast('A previous job still needs recovery. Reload to recover it before starting another.'); return; }
		busy = true;
		stopTakes = false;
		startTimer();
		try {
			const planning = !app.remix && freshComposition && app.producer.enabled;
			const producer = cleanProducer($state.snapshot(app.producer));
			const base = app.remix
				? { ...remixRequest(app.remix.request, app.remix.amount, d), mastering_profile: app.request.mastering_profile }
				: planning ? applyProducer(buildRequest(), producer) : buildRequest();
			const count = planning ? producer.takes : 1;
			const takeGroup = count > 1 ? crypto.randomUUID() : undefined;
			const name = app.name || 'Untitled';
			const format = app.format;
			const fresh = freshComposition && !app.remix;
			for (let take = 0; take < count && !stopTakes; take++) {
				takeProgress = count > 1 ? `Take ${take + 1} of ${count}` : '';
				const req = prepareGeneration(base, fresh);
				if (count > 1) { req.lm_batch_size = 1; req.synth_batch_size = 1; }
				const jobId = await synthSubmit(req, format);
				const job: PendingJob = { id: jobId, name: count > 1 ? `${name} · Take ${take + 1}` : name, request: req, takeGroup };
				saveJob(job);
				if (stopTakes) await cancelJob(jobId);
				await landJob(job);
			}
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : String(e));
		} finally {
			takeProgress = '';
			busy = false;
			stopTimer();
		}
	}

	// A request carrying audio codes renders the take they hold, so the run
	// asks which take is wanted before it starts. An empty box goes straight
	// to the pipeline.
	function askTake() {
		if (app.remix) { generate(); return; }
		if (!freshComposition && app.request.semantic_tokens?.trim()) {
			takeOpen = true;
			return;
		}
		generate();
	}

	// The codes leave the request and both seeds go back to a free draw, so
	// the AR half performs the prompt again instead of retracing the take
	function newTake() {
		freshComposition = true;
		generate();
	}

	// cancel the active pipeline job
	async function cancelPipeline() {
		stopTakes = true;
		try {
			const job = loadJob();
			if (job) await cancelJob(job.id);
		} catch {}
	}

	function clearLm() {
		clearSection(app.request, 'lm');
	}

	function clearScoreSampling() {
		clearSection(app.request, 'score');
	}

	// the score itself, so a generation that missed the tune is one click away
	// from a free composition again
	function clearScoreText() {
		app.request.abc = '';
	}

	function clearSemantic() {
		clearSection(app.request, 'semantic');
	}

	function clearPost() {
		clearSection(app.request, 'post');
	}

	function ph(v: unknown): string {
		return v != null ? String(v) : '';
	}
</script>

<form class="request-form" class:is-generating={busy} onsubmit={(e) => e.preventDefault()}>
	<input
		type="file"
		accept=".json,.yml,.yaml,.mp3,.wav"
		bind:this={fileInput}
		onchange={onFileSelected}
		hidden
	/>

	<nav class="desk-nav" aria-label="Creation steps"><a href="#music-workbench"><span>1</span><span class="step-copy"><strong>Sound</strong><small>Describe &amp; choose style</small></span></a><a href="#lyrics-editor" onclick={() => { const section = document.getElementById('lyrics-editor'); if (section instanceof HTMLDetailsElement) section.open = true; }}><span>2</span><span class="step-copy"><strong>Lyrics</strong><small>Write or generate</small></span></a><a href="#arrangement-workbench"><span>3</span><span class="step-copy"><strong>Arrange</strong><small>Structure &amp; options</small></span></a><a href="#engine-workbench"><span>4</span><span class="step-copy"><strong>Generate</strong><small>Render &amp; export</small></span></a></nav>
	<section class="card sound-card">
		<div class="card-head">
			<h3><span class="step-number">01</span> Sound direction</h3>
			<div class="toolbar">
				<button
					type="button"
					class="tool-btn"
					onclick={importJson}
					title="Open JSON/YAML prompt or MP3/WAV audio"
				>
					<FolderOpen size={13} /><span>Load preset</span>
				</button>
				<button
					type="button"
					class="tool-btn"
					onclick={() => (saveFormatOpen = true)}
					title="Save prompt as JSON or YAML"
				>
					<Download size={13} /><span>Save preset</span>
				</button>
				<button type="button" class="tool-btn" onclick={reset} title="Reset prompt">
					<RotateCcw size={13} /><span>Reset</span>
				</button>
			</div>
		</div>
		<div id="music-workbench" class="sound-direction-grid" role="group" aria-label="Music style">
   <div class="brief-column">
    <span class="field-name">Selected styles <small>{musicMix.length} / 3</small></span>
    <div class="selected-style-slots" aria-label="Selected styles">
     {#each [0, 1, 2] as slot}
      {@const id = musicMix[slot]}
      {@const style = MUSIC_STYLE_BY_ID[id]}
      {#if style}
       <div class="selected-style-slot" class:inactive={musicMixWeight[id] === 0}>
        <img src={style.thumbnail} alt="" />
        <button type="button" class="remove-selected-style" aria-label={`Remove ${style.name}`} onclick={() => { musicMix = musicMix.filter(x => x !== id); updateMusicPrompt(); }}><X size={13}/></button>
        <strong>{style.name}</strong><small>{musicMixWeight[id] === 0 ? 'Excluded · 0%' : `${slot === 0 || musicMix.slice(0, slot).every(key => musicMixWeight[key] === 0) ? 'Primary' : 'Secondary'} · ${musicMixWeight[id] ?? 50}%`}</small>
       </div>
      {:else}
       <button type="button" class="selected-style-slot empty-style-slot" aria-label={`Choose style ${slot + 1}`} onclick={() => document.querySelector<HTMLInputElement>('.style-search')?.focus()}><span>+</span><strong>Choose style</strong><small>Slot {slot + 1}</small></button>
      {/if}
     {/each}
    </div>
    {#if !musicMix.length && app.request.style.trim()}<small class="help-text">Custom direction loaded. Choose a style to replace it.</small>{/if}
    <label class="track-name-row"><span>Track name</span><input type="text" bind:value={app.name} placeholder="Untitled track" /></label>
   </div>
   <div class="preset-column"><label class="field"><span class="field-name">Style preset <small>{styleSearch.trim() ? `${visibleMusicStyles.length} / ` : ''}{HIP_HOP_STYLES.length} styles</small></span><input class="style-search" type="search" aria-label="Find a hip-hop style" placeholder="Search styles…" bind:value={styleSearch}/></label>
   <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable region supports arrows, Home and End through scrollStrip.) -->
   <div class="preset-discovery" use:scrollStrip role="region" tabindex="0" aria-label="Hip-hop style profiles">{#each visibleMusicStyles as style}<button type="button" class="style-tile" class:chosen={musicMix.includes(style.id)} aria-pressed={musicMix.includes(style.id)} onclick={() => addMusicStyle(style.id)} title={`${style.name} · ${style.family}`}><img src={style.thumbnail} alt="" loading="lazy" /><span class="style-tile-copy"><strong>{style.name}</strong><small>{style.family}</small></span><span class="style-tile-add">{musicMix.includes(style.id) ? "✓" : "+"}</span></button>{/each}</div>
   <small class="help-text">Drag or scroll to explore all styles.</small>
   {#if visibleMusicStyles.length === 0}<p class="help-text">No matching styles. Try another search.</p>{/if}
   </div>
   <details class="blend-disclosure"><summary>Style blend &amp; saved favourites <span>{musicMix.length ? `${musicMix.filter(id => musicMixWeight[id] > 0).length} active influences` : app.request.style.trim() ? 'Custom direction' : 'No styles selected'}</span></summary>
			<div class="music-mixer"><div class="ring-stage">
				{#each musicMix as id, i}
					<div class="style-ring-wrap">
						<InfluenceRing name={musicStyles.find(([key]) => key === id)?.[1] || id} value={musicMixWeight[id] ?? 50} color={['#fb923c','#f472b6','#22d3ee','#a78bfa','#34d399'][i % 5]} thumbnail={MUSIC_STYLE_BY_ID[id]?.thumbnail} onchange={(value) => { musicMixWeight = {...musicMixWeight, [id]: value}; updateMusicPrompt(); }} />
						<span>{musicStyles.find(([key]) => key === id)?.[1] || id}</span>
						<button type="button" onclick={() => { musicMix = musicMix.filter(x => x !== id); updateMusicPrompt(); }}>Remove</button>
					</div>
				{/each}
				{#if musicMix.length === 0}
					<div class="style-ring-wrap custom-style-ring">
						<InfluenceRing name="Custom music direction strength" value={musicPromptStrength} color="#2dd4a3" onchange={(value) => { musicPromptStrength = value; }} />
						<span>Prompt strength</span>
					</div>
				{/if}
			</div><p class="mixer-help">Turn a ring to shape the blend. Zero excludes a style. The first active style sets the foundation.</p></div>
			<details class="custom-direction"><summary>Advanced: custom direction</summary><label class="field"><span class="field-name">Music direction</span><textarea aria-label="Music style prompt and descriptions" rows="4" bind:value={app.request.style}></textarea></label><p class="help-text">Editing this text replaces the selected blend with a custom direction.</p></details>
			<BlendFavourites kind="music" current={{ ids: musicMix, weights: musicMixWeight, prompt: app.request.style }} onload={(data) => {
				const mix = cleanMix(data.ids, data.weights, musicStyles.map(([id]) => id).filter(Boolean), 3);
				musicMix = mix.ids; musicMixWeight = mix.weights;
				if (musicMix.length) updateMusicPrompt();
				else { app.request.style = typeof data.prompt === 'string' ? data.prompt : ''; mixedMusicPrompt = app.request.style; }
			}} />
   </details>
		</div>
	</section>
	<details class="card words-card" id="lyrics-editor">
		<summary class="card-head"><h3><span class="step-number">02</span> Lyrics &amp; writing</h3><span class="section-meta">{app.request.lyrics ? "Lyrics ready · click to edit" : "Add lyrics or write with AI"}</span></summary><div class="lyrics-content"><div class="card-head">
			<h3><span class="step-number">02</span> Lyrics &amp; writing</h3>
			<div class="lyrics-heading-actions">
				<span class="section-meta">{(app.request.lyrics || "").trim().split(/\s+/).filter(Boolean).length} words</span>
				<button type="button" class="lyrics-load-btn" onclick={openLyricsFile} title="Load lyrics from a text file"><FolderOpen size={14} /><span>Load lyrics</span></button>
				<input bind:this={lyricsFileInput} class="lyrics-file-input" type="file" accept=".txt,.md,.lrc,.srt,.vtt,text/plain" aria-label="Choose a lyrics text file" onchange={onLyricsFileSelected} />
			</div>
		</div>
		<div class="lyric-profile-selector">
			<label class="field"><span class="field-name">Lyric style <small>{LYRIC_PACK_STYLES.length} pack styles</small></span>
			<select aria-label="Primary lyric style" value={lyricMix[0] || ''} onchange={e => selectPrimaryLyric(e.currentTarget.value)}>
				<option value="" disabled>Choose a lyric style</option>
				<optgroup label="Hip-Hop Lyric Styles · 30 Pack">{#each LYRIC_PACK_STYLES as style}<option value={style.id}>{style.name}</option>{/each}</optgroup>
				<optgroup label="Previous lyric engines">{#each LEGACY_LYRIC_CHOICES as [id, name]}<option value={id}>{name}</option>{/each}</optgroup>
			</select></label>
			{#if lyricProfile}<p>{lyricProfile.description}</p>{/if}
			<small>Guides the lyric assistant. Existing lyrics stay unchanged; open the assistant below to write a new draft.</small>
		</div>
		<label class="field">
			<span class="field-name">Lyrics</span>
			<textarea
				rows="7"
				placeholder={'[Verse]\nWrite your lyrics here...'}
				bind:value={app.request.lyrics}
			></textarea>
		</label>
		<details class="writer-disclosure"><summary><Sparkles size={15}/> Lyric assistant <span>Write with your local model</span></summary>
		<div id="lyric-workbench" class="lyric-ai">
			<label>Ollama model<select bind:value={lyricModel} disabled={lyricBusy}>
				<option value="">Select an installed model</option>
				{#each lyricModels as model}<option value={model.name}>{model.name}</option>{/each}
			</select></label>
			<button type="button" onclick={refreshLyricModels} disabled={lyricBusy}>Refresh models</button>
			{#if lyricModelError}<p role="status">{lyricModelError}</p>{/if}
			{#if lyricBusy}<button type="button" onclick={() => lyricController?.abort()}>Cancel lyric request</button>{/if}
			{#if lyricDraft}
				<label>Review generated lyrics<textarea rows="8" bind:value={lyricDraft}></textarea></label>
				<button type="button" onclick={() => { app.request.lyrics = lyricDraft; lyricDraft = ''; }}>Use these lyrics</button>
				<button type="button" onclick={() => { lyricDraft = ''; }}>Discard draft</button>
			{/if}
			<div class="library-head"><span>Lyric style · construction engine</span><span>separate from music style</span></div>
			<div class="style-row"><select aria-label="Lyric engine" bind:value={lyricPreset}><option value="">Choose secondary style…</option>{#each lyricPresets as p}<option value={p[0]}>{p[1]}</option>{/each}</select><button type="button" class="tool-btn" disabled={!lyricPreset || lyricMix.includes(lyricPreset) || lyricMix.length >= 3} onclick={() => { if (lyricPreset && !lyricMix.includes(lyricPreset) && lyricMix.length < 3) { lyricMix = [...lyricMix, lyricPreset]; lyricMixWeight = {...lyricMixWeight, [lyricPreset]: 50}; } }}>Add to blend</button></div>
			<div class="style-mixer"><div class="ring-stage">
				{#each lyricMix as id, i}
					<div class="style-ring-wrap">
						<InfluenceRing name={lyricPresets.find(([key]) => key === id)?.[1] || id} value={lyricMixWeight[id] ?? 50} color={['#fb923c','#f472b6','#22d3ee','#a78bfa','#34d399'][i % 5]} onchange={(value) => { lyricMixWeight = {...lyricMixWeight, [id]: value};  }} />
						<span>{lyricPresets.find(([key]) => key === id)?.[1] || id}</span>
						<button type="button" onclick={() => { lyricMix = lyricMix.filter(x => x !== id);  }}>Remove</button>
					</div>
				{/each}
			</div><p class="mixer-help">Drag around a ring or use arrow keys. Influence is relative to other active styles, not an exact audio percentage. Zero excludes a style.</p></div>
			<BlendFavourites kind="lyric" current={{ ids: lyricMix, weights: lyricMixWeight }} onload={(data) => {
				const mix = cleanMix(data.ids, data.weights, lyricPresets.map(([id]) => id), 3);
				lyricMix = mix.ids; lyricMixWeight = mix.weights;
			}} />
			<textarea rows="2" placeholder="What should the song be about? Add story, emotion, characters or a central idea…" bind:value={lyricTopic}></textarea>
			<button type="button" class="generate-lyrics" disabled={!lyricTopic.trim() || lyricBusy || busy || !lyricModel} onclick={generateLyrics}>{lyricBusy ? 'Writing lyrics…' : 'Generate Lyrics with Ollama'}</button>
		</div>
		</details>
	</div></details>

	<ProducerControls disabled={busy || !!app.remix || !freshComposition} />
	{#if takeProgress}<p role="status">{takeProgress} · completed takes are saved in your library.</p>{/if}
	<section class="card" id="arrangement-workbench">
		<div class="card-head">
			<h3><span class="step-number">03</span> Composition</h3>
			<button
				type="button"
				class="mini-btn"
				title="Clear score"
				onclick={clearScoreText}
				aria-label="Clear score"
			>
				<X size={15} />
			</button>
		</div>
		<div class="duration-auto" role="group" aria-labelledby="duration-auto-label">
			<div class="duration-copy">
				<span id="duration-auto-label" class="field-name"><span class="field-name-emoji">🤖</span> Auto duration</span>
				<span class="duration-help">Estimate from lyrics. Turn off to enter a target length or use the server default.</span>
			</div>
			<label class="duration-toggle" title="Estimate duration automatically from lyrics">
				<input type="checkbox" checked={durationAuto} onchange={(event) => { app.request.duration = event.currentTarget.checked ? 0 : undefined; }} id="duration-auto" aria-label="Estimate duration automatically from lyrics" />
				<span class="duration-switch-track" aria-hidden="true"></span>
			</label>
		</div>
		<label class="composition-choice"><input type="checkbox" bind:checked={freshComposition} disabled={!!app.remix} aria-label="New composition each time" /><span><strong>New composition each time</strong><small>{app.remix ? 'Remix keeps the source composition and seeds.' : freshComposition ? 'A fresh musical idea from your selected styles for every track.' : 'Uses the loaded score, audio codes and seed settings.'}</small></span></label>
		<details class="score-editor"><summary>Composition score <span>{freshComposition ? "New score each time" : app.request.abc ? "Loaded score enabled" : "Let YuE2 compose"}</span></summary>
		<label class="field">
			<span class="field-name"
				>Symbolic score <em>· ABC notation, empty = model writes one</em></span
			>
			<textarea
				rows="6"
				class="mono"
				disabled={freshComposition || !!app.remix}
				placeholder={'X:1\nL:1/8\nM:4/4\nK:Cmaj\n"C"c2 e2 g2 c\'2|'}
				bind:value={app.request.abc}
			></textarea>
		</label>
		</details>
		<div class="field-row">
			<span class="field-name">Score mode</span>
			<select
				class="field-select"
				value={cot}
				onchange={(e) => (app.request.cot = e.currentTarget.value)}
				title="What the autoregressive half writes before the codes."
			>
				<option value={COT_FULL}>Full · chords included</option>
				<option value={COT_MELODY}>Melody · no chords</option>
				<option value={COT_OFF}>Off · no score</option>
			</select>
		</div>
		<div class="meta-grid">
			<label
				>Duration <span class="unit">sec</span><input
					type="number"
					min="1"
					step="1"
					placeholder={durationAuto ? 'From lyrics' : 'Server default'}
					value={durationAuto ? '' : app.request.duration ?? ''}
					disabled={durationAuto}
					oninput={(event) => { const value = event.currentTarget.value.trim(); app.request.duration = value ? Number(value) : undefined; }}
					title="Target length in seconds. Automatic mode estimates from lyrics; the model may finish earlier."
				/></label
			>
			<label
				>LM batch <input
					type="text"
					placeholder={ph(d?.lm_batch_size)}
					bind:value={app.request.lm_batch_size}
					title="Songs drawn from this prompt, each with its own score and codes, seeds LM seed + index."
				/></label
			>
			<label
				>LM seed <input
					type="text"
					placeholder={freshComposition ? 'Random each time' : ph(d?.lm_seed)}
					value={freshComposition ? '' : app.request.lm_seed ?? ''}
					disabled={freshComposition || !!app.remix}
					oninput={e => app.request.lm_seed = e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value)}
					title="Seed of the token draw: the score, the melody and the length come from this one."
				/></label
			>
		</div>
	</section>

	<section class="card engine-card" id="engine-workbench">
  <div class="card-head"><h3><span class="step-number">04</span> Production engine</h3><span class="engine-indicator" class:active={automatic}>{automatic ? 'AUTO' : 'MANUAL'}</span></div>
  {#if app.remix}
   <section class="remix-panel" aria-label="Remix controls">
    <div class="remix-heading"><div><strong>Remix: {app.remix.sourceName}</strong><small>Original seed: {app.remix.request.lm_seed} · Sound seed: {app.remix.request.seed}</small></div><button type="button" class="tool-btn" onclick={() => { app.remix = null; freshComposition = true; }}>Exit remix</button></div>
    <label class="remix-variation">Variation <output>{app.remix.amount} / 100</output><input type="range" min="0" max="100" step="1" bind:value={app.remix.amount} aria-label="Remix variation" /></label>
    <div class="remix-scale"><span>0 · Original performance</span><span>100 · More adventurous</span></div>
    <p>{app.remix.amount === 0 ? 'Re-renders the saved performance with its original seeds.' : 'Generates a new performance with the original seeds, style, lyrics and score. Higher values allow more sampling freedom, not an exact percentage of audio change.'} The result is saved as a separate track.</p>
    {#if !app.remix.request.abc}<p>This track has no saved score, so its melody and arrangement are not locked.</p>{/if}
   </section>
  {:else}<p class="remix-hint">To vary a saved song with the same seed, choose its Remix button.</p>{/if}
  <div class="engine-mode" aria-label="Production settings mode"><button type="button" class:selected={automatic} aria-pressed={automatic} onclick={() => setAutomatic(true)}>Automatic</button><button type="button" class:selected={!automatic} aria-pressed={!automatic} onclick={() => setAutomatic(false)}>Manual control</button></div>
  <details class="engine-options"><summary>Output, mastering &amp; profile details</summary>  <div class="profile-title"><Sparkles size={19}/><div><strong>{automatic ? profile.name : 'Your custom settings'}</strong><p>{automatic ? 'Follows your active sound directions' : 'Sampling and render controls are unlocked below'}</p></div></div>
  {#if automatic}<div class="engine-metrics"><div><span>COMPOSITION</span><strong>{profile.scoreTemperature.toFixed(2)}</strong><small>score temperature</small></div><div><span>RENDER</span><strong>{profile.settings.steps}<em> steps</em></strong><small>model default</small></div><div><span>OUTPUT</span><strong>{app.format === 'mp3' ? '320' : app.format.slice(3)}<em>{app.format === 'mp3' ? ' kbps' : ' bit'}</em></strong><small>{app.format === 'mp3' ? 'MP3 encoding' : 'WAV encoding'}</small></div></div>{/if}
  <label class="engine-format">Delivery format<select aria-label="Delivery format" bind:value={app.format}><option value="mp3">MP3 · 320 kbps in Auto</option><option value="wav16">WAV · 16 bit</option><option value="wav24">WAV · 24 bit</option><option value="wav32">WAV · 32 bit float</option></select></label>
  <label class="engine-format">Automatic mastering<select aria-label="Automatic mastering" bind:value={app.request.mastering_profile} title="Optional EBU R128 loudness normalization with a true-peak ceiling. It sets delivery level; it does not repair mix problems."><option value="off">Off · preserve current output</option><option value="streaming">Streaming · −14 LUFS, −1 dBTP</option><option value="broadcast">Broadcast · −23 LUFS, −1 dBTP</option></select></label>
  <p class="engine-note">{automatic ? 'Style-guided composition with the model’s stable audio defaults. A starting point you can fine-tune, not a guarantee of the best take.' : 'Imported and reused settings are preserved. Switch to Automatic to apply the current style profile.'}</p></details>
 </section>
	<details id="score-sampling" class="card collapsible" open>
		<summary>
			<span>Score sampling</span>
			<button
				type="button" disabled={automatic}
				class="mini-btn"
				title="Clear score sampling"
				onclick={(e) => {
					e.preventDefault();
					clearScoreSampling();
				}}
				aria-label="Clear score sampling"
			>
				<X size={15} />
			</button>
		</summary>
		<div class="details-body"><SamplingControls values={automatic ? profile.settings.abc_sampling : app.request.abc_sampling} defaults={d?.abc_sampling} {automatic} onchange={(key, value) => { app.request.abc_sampling[key] = value; }} /></div>
	</details>

	<details id="semantic-sampling" class="card collapsible" open>
		<summary>
			<span>Semantic sampling</span>
			<button
				type="button" disabled={automatic}
				class="mini-btn"
				title="Clear semantic sampling"
				onclick={(e) => {
					e.preventDefault();
					clearSemantic();
				}}
				aria-label="Clear semantic sampling"
			>
				<X size={15} />
			</button>
		</summary>
		<div class="details-body"><SamplingControls values={automatic ? profile.settings.semantic_sampling : app.request.semantic_sampling} defaults={d?.semantic_sampling} {automatic} onchange={(key, value) => { app.request.semantic_sampling[key] = value; }} /><details class="sampling-extra"><summary>Guidance &amp; audio codes</summary><label class="field">CFG scale<input type="number" step="0.1" disabled={automatic} value={automatic ? profile.settings.cfg_scale : app.request.cfg_scale} placeholder={ph(d?.cfg_scale)} oninput={e => app.request.cfg_scale = e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value)}/></label><label class="field">Audio codes<textarea rows="2" bind:value={app.request.semantic_tokens} disabled={automatic}></textarea></label></details></div>
	</details>

	<details id="render-workbench" class="card collapsible" open>
		<summary>
			<span>Render &amp; output</span>
			<button
				type="button" disabled={automatic}
				class="mini-btn"
				title="Clear render settings"
				onclick={(e) => {
					e.preventDefault();
					clearPost();
				}}
				aria-label="Clear render settings"
			>
				<X size={15} />
			</button>
		</summary>
		<div class="details-body">
			{#if automatic}<p class="auto-detail">{profile.settings.steps} flow steps · peak clip {profile.settings.peak_clip} · {app.format === "mp3" ? "320 kbps MP3" : app.format.toUpperCase()}. Output format stays under your control. <button type="button" onclick={() => setAutomatic(false)}>Customize settings</button></p>{:else}
			<div class="meta-grid">
				<label
					>Flow steps <input
						type="text"
						placeholder={ph(d?.steps)}
						bind:value={app.request.steps}
						title="Midpoint steps of the acoustic ODE."
					/></label
				>
				<label
					>Synth batch <input
						type="text"
						placeholder={ph(d?.synth_batch_size)}
						bind:value={app.request.synth_batch_size}
						title="Noise variations per song on the same codes, seeds noise seed + index, 9 at most."
					/></label
				>
				<label
					>Noise seed <input
						type="text"
						placeholder={freshComposition ? 'Random each time' : ph(d?.seed)}
						value={freshComposition ? '' : app.request.seed ?? ''}
						disabled={freshComposition || !!app.remix}
						oninput={e => app.request.seed = e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value)}
						title="Seed of the acoustic noise. Change it to re-render the same song differently."
					/></label
				>
				<label
					>Peak clip <input
						type="text"
						placeholder={ph(d?.peak_clip)}
						bind:value={app.request.peak_clip}
					/></label
				>
				<label
					>MP3 bitrate <input
						type="text"
						placeholder={ph(d?.mp3_bitrate)}
						bind:value={app.request.mp3_bitrate}
					/></label
				>
				<label
					>Format <select
						bind:value={app.format}
						title="Output audio format. WAV32 outputs raw IEEE float without normalization."
					>
						<option value="mp3">MP3</option>
						<option value="wav16">WAV16</option>
						<option value="wav24">WAV24</option>
						<option value="wav32">WAV32</option>
					</select></label
				>
			</div>
			{/if}
		</div>
	</details>


	<div class="action-bar">
		<button
			type="button"
			class="ghost-btn"
			disabled={busy}
			onclick={pickExample}
			title="Pick a random official demo prompt"
		>
			<Dices size={15} /><span>Surprise me</span>
		</button>
		<button
			type="button"
			class="generate-btn"
			class:running={busy}
			disabled={busy}
			onclick={askTake}
			title="Run the full pipeline: score, semantic codes, flow matching, VAE"
		>
			{#if busy}
				<LoaderCircle size={16} class="spin" /><span>Rendering · {elapsed}</span>
			{:else}
				<Sparkles size={16} /><span>{app.remix ? 'Generate remix' : 'Generate track'}</span>
			{/if}
		</button>
		{#if busy}
			<button
				type="button"
				class="ghost-btn danger"
				onclick={cancelPipeline}
				title="Cancel the active job"
			>
				<X size={15} /><span>Cancel</span>
			</button>
		{/if}
	</div>
</form>

<Dialog bind:open={takeOpen} title="Reuse this take?">
	{#snippet body()}
		The audio codes hold a performance already sung. Keeping them renders it again, dropping them
		performs the prompt anew.
	{/snippet}
	{#snippet actions(close)}
		<DialogButton
			onclick={() => {
				close();
				generate();
			}}>Same take</DialogButton
		>
		<DialogButton
			onclick={() => {
				close();
				newTake();
			}}>New take</DialogButton
		>
	{/snippet}
</Dialog>

<Dialog bind:open={saveFormatOpen} title="Save format">
	{#snippet actions(close)}
		<DialogButton onclick={close}>Cancel</DialogButton>
		<DialogButton
			onclick={() => {
				saveAs('json');
				close();
			}}>JSON</DialogButton
		>
		<DialogButton
			onclick={() => {
				saveAs('yaml');
				close();
			}}>YAML</DialogButton
		>
	{/snippet}
</Dialog>

<style>
	.request-form {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: start;
		gap: 0.65rem;
	}
	.request-form > .desk-nav,
	.request-form > .sound-card,
	.request-form > .words-card,
	.request-form > #arrangement-workbench,
	.request-form > .engine-card,
	.request-form > #render-workbench,
	.request-form > .action-bar { grid-column: 1 / -1; }
	.request-form > .sound-card { grid-row: 2; }
	.request-form > .words-card { grid-row: 3; }
	.request-form > #arrangement-workbench { grid-row: 4; }
	.request-form > #score-sampling { grid-column: 1; grid-row: 5; }
	.request-form > #semantic-sampling { grid-column: 2; grid-row: 5; }
	.request-form > .engine-card { grid-row: 6; }
	.request-form > #render-workbench { grid-row: 7; }
	.request-form > .action-bar { grid-row: 8; }
	.request-form > input[type='file'] { display: none; }
	@media (max-width: 800px) { .request-form { display:flex; flex-direction:column; } .request-form > * { width:100%; } }
	.card {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		box-shadow: var(--shadow);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.card-head h3 {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--fg-dim);
	}
	.toolbar {
		display: flex;
		gap: 0.35rem;
	}
	.tool-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--fg-dim);
		background: var(--bg-btn);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.32rem 0.6rem;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.tool-btn:hover {
		background: var(--bg-btn-hover);
		color: var(--fg);
		border-color: var(--border-strong);
	}
	.mini-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 7px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--fg-faint);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.mini-btn:hover {
		background: var(--bg-btn);
		color: var(--fg);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.field-name {
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--fg-dim);
	}
	.field-name em {
		font-style: normal;
		font-weight: 400;
		color: var(--fg-faint);
	}
	textarea,
	input[type='text'],
	select {
		font-family: inherit;
		font-size: 0.86rem;
		line-height: 1.5;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-input);
		color: var(--fg);
		resize: vertical;
		width: 100%;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	textarea::placeholder,
	input[type='text']::placeholder {
		color: var(--fg-faint);
	}
	textarea:focus,
	input[type='text']:focus,
	select:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.22);
	}
	textarea.mono {
		font-family: ui-monospace, 'Cascadia Mono', monospace;
		font-size: 0.78rem;
	}
	select {
		resize: none;
		cursor: pointer;
	}
	.field-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.field-row .field-name {
		flex-shrink: 0;
	}
	.field-select {
		flex: 1;
		min-width: 0;
	}
	.meta-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.55rem;
	}
	.meta-grid label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--fg-dim);
	}
	.meta-grid input,
	.meta-grid select {
		font-size: 0.82rem;
		padding: 0.45rem 0.55rem;
	}
	.unit {
		font-weight: 400;
		color: var(--fg-faint);
	}
	.collapsible {
		padding: 0;
	}
	.collapsible summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		cursor: pointer;
		list-style: none;
		padding: 0.85rem 1rem;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--fg-dim);
	}
	.collapsible summary::-webkit-details-marker {
		display: none;
	}
	.collapsible summary:hover {
		color: var(--fg);
	}
	.details-body {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0 1rem 1rem;
	}
	.action-bar {
		position: sticky;
		bottom: 0;
		display: flex;
		gap: 0.5rem;
		padding: 0.7rem;
		background: rgba(14, 16, 22, 0.9);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	.ghost-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-btn);
		color: var(--fg-dim);
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: 600;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.ghost-btn:hover:not(:disabled) {
		background: var(--bg-btn-hover);
		color: var(--fg);
	}
	.ghost-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.ghost-btn.danger {
		color: var(--error);
		border-color: rgba(248, 113, 113, 0.35);
	}
	.generate-btn {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.65rem 1rem;
		border: none;
		border-radius: 10px;
		background: var(--accent-grad);
		color: #fff;
		cursor: pointer;
		font-size: 0.88rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
		transition:
			transform 0.12s,
			box-shadow 0.15s,
			filter 0.15s;
		font-variant-numeric: tabular-nums;
	}
	.generate-btn:hover:not(:disabled) {
		filter: brightness(1.1);
		box-shadow: 0 6px 26px rgba(139, 92, 246, 0.55);
	}
	.generate-btn:active:not(:disabled) {
		transform: scale(0.98);
	}
	.generate-btn:disabled {
		cursor: default;
	}
	.generate-btn.running {
		background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 60%, #0e7490 130%);
		background-size: 200% 200%;
		animation: render-pulse 2.2s ease-in-out infinite;
	}
	@keyframes render-pulse {
		0%,
		100% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
	}
	:global(.spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
.library-head { display:flex; justify-content:space-between; color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; margin-bottom:.4rem; }
.style-row { display:flex; gap:.45rem; align-items:center; }
.lyric-ai { margin-top:.65rem; padding:.65rem; border:1px solid rgba(45,212,191,.35); border-radius:.6rem; background:rgba(45,212,191,.05); }
.lyric-ai textarea { width:100%; margin-top:.45rem; }
.generate-lyrics { width:100%; margin-top:.45rem; padding:.5rem; border:1px solid var(--border-strong); border-radius:.45rem; color:var(--fg); background:var(--bg-btn); font-size:.75rem; }
.generate-lyrics:hover:not(:disabled) { background:var(--bg-btn-hover); }
.generate-lyrics:disabled { opacity:.45; cursor:not-allowed; }
.style-mixer { margin-top:.55rem; padding:.55rem; border:1px solid var(--border); border-radius:.6rem; background:rgba(0,0,0,.12); }
.music-mixer { margin-top:.55rem; padding:.65rem; border:1px solid rgba(45,212,163,.3); border-radius:.6rem; background:rgba(45,212,163,.045); }
.ring-stage { display:flex; flex-wrap:wrap; justify-content:center; gap:1rem; }
.style-ring-wrap { display:flex; flex-direction:column; align-items:center; gap:.28rem; width:8.4rem; text-align:center; color:var(--fg-dim); font-size:.66rem; }
.style-ring-wrap > button { border:0; background:transparent; color:var(--fg-faint); font-size:.62rem; cursor:pointer; }
.style-ring-wrap > button:hover { color:var(--error); }
.custom-style-ring { width:100%; }
.mixer-help { margin-top:.55rem; color:var(--fg-dim); font-size:.68rem; line-height:1.45; text-align:center; }
.duration-auto { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.8rem .9rem; border:1px solid var(--border-strong); border-radius:12px; background:color-mix(in srgb, var(--accent) 7%, var(--bg-input)); }
.duration-copy { display:flex; flex-direction:column; gap:.22rem; min-width:0; }
.duration-copy .field-name { font-size:.82rem; color:var(--fg); }
.duration-help { color:var(--fg-dim); font-size:.7rem; line-height:1.4; }
.duration-toggle { position:relative; display:flex; align-items:center; flex:0 0 auto; cursor:pointer; }
.duration-toggle input { position:absolute; width:1px; height:1px; opacity:0; }
.duration-switch-track { position:relative; width:2.75rem; height:1.55rem; border:1px solid var(--border-strong); border-radius:999px; background:var(--bg-btn); transition:background .18s, border-color .18s, box-shadow .18s; }
.duration-switch-track::after { content:''; position:absolute; top:.17rem; left:.18rem; width:1.08rem; height:1.08rem; border-radius:50%; background:var(--fg-dim); transition:transform .18s cubic-bezier(.2,.8,.2,1), background .18s; }
.duration-toggle input:checked + .duration-switch-track { border-color:color-mix(in srgb, #2dd4a3 70%, transparent); background:color-mix(in srgb, #2dd4a3 25%, var(--bg-btn)); }
.duration-toggle input:checked + .duration-switch-track::after { transform:translateX(1.18rem); background:#73f0c8; }
.duration-toggle input:focus-visible + .duration-switch-track { outline:2px solid var(--focus); outline-offset:3px; }
.meta-grid input:disabled { opacity:.68; cursor:not-allowed; }
@media (max-width: 520px) { .duration-auto { align-items:flex-start; } .duration-help { max-width:28ch; } }
</style>
