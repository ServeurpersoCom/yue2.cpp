import type { Yue2Request, Yue2Props, Song } from './types.js';
import { OUTPUT_FORMATS } from './config.js';
import { emptyRequest } from './fields.js';
import { canRemix, type RemixDraft } from './remix.js';
import { cleanProducer, type ProducerSettings } from './producer.js';
import { validRequest, object } from './validation.js';

const STORAGE_KEY = 'yue2';
let initialStorageWarning = '';

// Safe recovery route: clears only UI/request state, preserving pending jobs. The
// IndexedDB song library, model files, and generated audio remain untouched.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reset') === '1') {
	try { localStorage.removeItem(STORAGE_KEY); } catch { initialStorageWarning = 'Settings storage is unavailable. Changes are not saved.'; }
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
			if (!object(parsed)) throw new Error('Invalid saved settings');
			return {
				producer: cleanProducer(parsed.producer || {}),
				name: typeof parsed.name === 'string' ? parsed.name : '',
				volume: typeof parsed.volume === 'number' && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(1, parsed.volume)) : .5,
				format: typeof parsed.format === 'string' && OUTPUT_FORMATS.some(format => format === parsed.format) ? parsed.format : 'mp3',
				dark: typeof parsed.dark === 'boolean' ? parsed.dark : true,
				logsOpen: typeof parsed.logsOpen === 'boolean' ? parsed.logsOpen : true,
				request: validRequest(parsed.request ?? {})
			};
		}
	} catch {
		initialStorageWarning = 'Saved settings could not be loaded. Default settings are in use; your library is unchanged.';
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
	storageWarning: initialStorageWarning,
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
	incoming = validRequest(incoming);
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
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
		catch { app.storageWarning = 'Settings could not be saved. Free browser storage or allow local storage, then retry. Your current settings remain usable.'; }
	});
});

export function retrySettingsStorage() {
 try {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({producer:app.producer,name:app.name,volume:app.volume,format:app.format,dark:app.dark,logsOpen:app.logsOpen,request:app.request}));
  app.storageWarning = ''; toast('Current settings saved.', 3000, true);
 } catch { toast('Settings storage is still unavailable.'); }
}
