import type { Yue2Request, Yue2Props, Song } from './types.js';
import { OUTPUT_FORMATS } from './config.js';
import { emptyRequest } from './fields.js';
import { canRemix, type RemixDraft } from './remix.js';
import { cleanProducer, type ProducerSettings } from './producer.js';

const STORAGE_KEY = 'yue2';

// Safe recovery route: clears only UI/request state, preserving pending jobs. The
// IndexedDB song library, model files, and generated audio remain untouched.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reset') === '1') {
	localStorage.removeItem(STORAGE_KEY);
	history.replaceState({}, '', window.location.pathname);
}

interface Saved {
 producer: ProducerSettings;
	name: string;
	volume: number;
	format: string;
	dark: boolean;
	logsOpen: boolean;
	request: Yue2Request;
}

function load(): Saved {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			return {
				producer: cleanProducer(parsed.producer || {}),
				name: parsed.name || '',
				volume: parsed.volume ?? 0.5,
				format: OUTPUT_FORMATS.includes(parsed.format) ? parsed.format : 'mp3',
				dark: parsed.dark ?? true,
				logsOpen: parsed.logsOpen ?? true,
				request: parsed.request || emptyRequest()
			};
		}
	} catch {
		// corrupt or unavailable
	}
	return {
		producer: cleanProducer(),
		name: '',
		volume: 0.5,
		format: 'mp3',
		dark: false,
		logsOpen: true,
		request: emptyRequest()
	};
}

const saved = load();

export const app = $state({
	producer: saved.producer,
	name: saved.name,
	volume: saved.volume,
	format: saved.format,
	dark: saved.dark,
	logsOpen: saved.logsOpen,
	request: saved.request as Yue2Request,
	remix: null as RemixDraft | null,
	songs: [] as Song[],
	props: null as Yue2Props | null,
	toast: '' as string,
	toastOk: false
});

let toastTimer = 0;

export function toast(msg: string, ms = 4000, ok = false) {
	clearTimeout(toastTimer);
	app.toast = msg;
	app.toastOk = ok;
	toastTimer = setTimeout(() => {
		app.toast = '';
	}, ms) as unknown as number;
}

// overwrite app.request. A release is two GGUF fixed at server startup, so
// there is no routing to preserve across a load. An incoming request is
// sparse, every field left at its default being absent, so it lands on top of
// an empty one: a field the sender omitted reads back as unset instead of
// missing, which is what the form binds to.
export function setRequest(incoming: Yue2Request) {
	app.remix = null;
	const base = emptyRequest();
	app.request = {
		...base,
		...incoming,
		abc_sampling: { ...base.abc_sampling, ...incoming.abc_sampling },
		semantic_sampling: { ...base.semantic_sampling, ...incoming.semantic_sampling }
	};
}

export function startRemix(song: Song) {
	if (!canRemix(song)) { toast('Remix needs a generated track with saved seeds and audio codes.'); return; }
	const request = { ...song.request, abc_sampling: { ...song.request.abc_sampling }, semantic_sampling: { ...song.request.semantic_sampling } };
	setRequest(request);
	app.name = `${song.name} (Remix)`;
	app.format = song.format;
	app.remix = { sourceName: song.name, amount: 25, request: $state.snapshot(app.request) };
}

// persist on every change
$effect.root(() => {
	$effect(() => {
		const data: Saved = {
			producer: app.producer,
			name: app.name,
			volume: app.volume,
			format: app.format,
			dark: app.dark,
			logsOpen: app.logsOpen,
			request: app.request
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	});
});
