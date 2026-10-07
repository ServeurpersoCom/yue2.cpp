import type { Song, Yue2Request } from './types.js';

const DB_NAME = 'yue2-songs';
const DB_VERSION = 2;
const STORE = 'songs';

// Module-scoped singleton: one IDB connection for the whole page lifetime.
// Connection is lazy, retriable on error (null reset), and shared by every
// put/get/delete call below.
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		let blocked = false;
		req.onblocked = () => { blocked = true; dbPromise = null; reject(new Error('Close older Studio tabs, then reload to upgrade the library safely.')); };
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
			}
			for (const name of ['pending','landed']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, {keyPath:'id'});
		};
		req.onsuccess = () => { if (blocked) { req.result.close(); return; } req.result.onversionchange = () => { req.result.close(); dbPromise = null; }; resolve(req.result); };
		req.onerror = () => {
			dbPromise = null;
			reject(req.error);
		};
	});
	return dbPromise;
}

// wrap a single IDB transaction operation into a promise
function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return open().then(
		(db) =>
			new Promise((resolve, reject) => {
				const transaction = db.transaction(STORE, mode);
				const req = fn(transaction.objectStore(STORE));
				transaction.oncomplete = () => resolve(req.result);
				transaction.onabort = () => reject(transaction.error || new Error('Library transaction aborted'));
				transaction.onerror = () => reject(transaction.error || req.error);
			})
	);
}

export function putSong(song: Song): Promise<number> {
	if (song.id != null) return updateSong(song.id, song).then(() => song.id!);
	// IDBValidKey -> number (autoIncrement)
	return (tx('readwrite', (s) => s.put(song)) as Promise<number>).then(id => { announceLibraryChange(); return id; });
}

const changes = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('yue2-library') : null;
export function announceLibraryChange() { changes?.postMessage('changed'); }
changes?.addEventListener('message', () => window.dispatchEvent(new Event('yue2-library-changed')));

export async function updateSong(id: number, patch: Partial<Song>, expectedRevision?: number): Promise<Song> {
 const db = await open();
 return new Promise((resolve, reject) => {
  const transaction = db.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  let saved: Song;
  let failure: Error | undefined;
  const request = store.get(id);
  request.onsuccess = () => {
   if (!request.result) { failure = new Error('This track was deleted. Its operation result was not restored over your library.'); transaction.abort(); return; }
   if (expectedRevision !== undefined && (request.result.mediaRevision ?? 0) !== expectedRevision) { failure = new Error('Track media changed while this operation was running. Retry with the current version.'); transaction.abort(); return; }
   saved = {...request.result, ...patch, id};
   if (patch.audio || patch.artwork) { saved.mediaRevision = (request.result.mediaRevision ?? 0) + 1; saved.videoOutdated = !!request.result.video || !!request.result.videoOutdated; }
   if (patch.video) { saved.videoRevision = saved.mediaRevision ?? 0; saved.videoOutdated = false; }
   if (patch.audio && patch.audio !== request.result.audio) { saved.peaks = undefined; saved.duration = 0; saved.video = undefined; }
   if (patch.artwork && !patch.video) saved.video = undefined;
   try { store.put(saved); } catch (error) { failure = error as Error; transaction.abort(); }
  };
  transaction.oncomplete = () => { announceLibraryChange(); resolve(saved); };
  transaction.onabort = () => reject(failure || transaction.error || new Error('Could not save track changes.'));
  transaction.onerror = () => reject(transaction.error || new Error('Could not save track changes.'));
 });
}

// Commit the entire result together; retrying recovery must not duplicate tracks.
export async function putJobSongs(jobId: string, songs: Song[]): Promise<Song[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE,'landed'], 'readwrite');
		const store = transaction.objectStore(STORE);
		let saved: Song[] = [];
		transaction.oncomplete = () => { announceLibraryChange(); resolve(saved); };
		transaction.onabort = () => reject(transaction.error || new Error('Could not save completed song; recovery retained'));
		transaction.onerror = () => reject(transaction.error || new Error('Library storage failed'));
		const landed = transaction.objectStore('landed').get(jobId);
		landed.onsuccess = () => {
			const existing = store.getAll();
			existing.onsuccess = () => {
				saved = existing.result.filter((song: Song) => song.sourceJob === jobId);
				if (landed.result || saved.length) { transaction.objectStore('landed').put({id:jobId}); return; }
				for (const [sourceIndex,song] of songs.entries()) { const record = {...song,sourceJob:jobId,sourceIndex}; const add = store.add(record); add.onsuccess = () => { saved.push({...record,id:add.result as number}); }; }
				transaction.objectStore('landed').put({id:jobId});
			};
		};
	});
}

export function getSong(id: number): Promise<Song | undefined> { return tx('readonly', s => s.get(id)); }

export function getAllSongs(): Promise<Song[]> {
	return tx('readonly', (s) => s.getAll());
}

// Replace the library in one IndexedDB transaction. Imported IDs are omitted
// so the store assigns fresh keys without risking collisions with old records.
export async function replaceAllSongs(songs: Song[]): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readwrite');
		const store = transaction.objectStore(STORE);
		store.clear();
		for (const song of songs) {
			const { id: _id, peaks: _peaks, ...record } = song;
			store.add(record);
		}
		transaction.oncomplete = () => { announceLibraryChange(); resolve(); };
		transaction.onabort = () => reject(transaction.error || new Error('Library restore was rolled back'));
		transaction.onerror = () => reject(transaction.error || new Error('Library restore failed'));
	});
}

export function deleteSong(id: number): Promise<void> {
	return (tx('readwrite', (s) => s.delete(id)) as Promise<void>).then(() => announceLibraryChange());
}
export async function deleteSongs(ids: number[]): Promise<void> {
 const db = await open();
 await new Promise<void>((resolve,reject) => {
  const transaction = db.transaction(STORE,'readwrite');
  for (const id of ids) transaction.objectStore(STORE).delete(id);
  transaction.oncomplete = () => resolve();
  transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('No tracks were deleted; library update failed.'));
 });
 announceLibraryChange();
}

// pending job: saved before polling starts, cleared on completion,
// so a page reload resumes polling and lands the finished song.

export interface PendingJob {
	queueOrder?: number;
	submitted?: boolean;
	artworkJobs?: Record<number, string>;
	takeGroup?: string;
	id: string;
	name: string;
	request: Yue2Request;
	// delivery format at submit, including 'mp4' (muxed client-side after the
	// audio lands; the request itself always carries an audio encoding).
	format?: string;
	// style blend snapshot taken at submit so the landed song can name the
	// styles even if the form (or a page reload) moves on before it lands.
	musicStyles?: { id: string; weight: number }[];
	lyricStyles?: { id: string; weight: number }[];
}

const JOB_KEY = 'yue2-job-synth';
let checkedLegacyJob = false;

export async function saveJob(job: PendingJob) {
	const db = await open();
	await new Promise<void>((resolve,reject) => { const transaction = db.transaction('pending','readwrite'); transaction.objectStore('pending').put(job); transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Cannot save recovery information; generation was not started.')); });
}

export async function loadJob(): Promise<PendingJob | null> {
	let legacy: string | null = null;
	try { if (!checkedLegacyJob) legacy = localStorage.getItem(JOB_KEY); } catch { /* IndexedDB recovery remains available. */ }
	if (legacy) {
		let job: PendingJob | undefined;
		try { const parsed = JSON.parse(legacy); if (typeof parsed?.id === 'string' && parsed.request) job = {...parsed,submitted:true}; } catch { /* Invalid legacy record. */ }
		if (job) await saveJob(job);
		try { localStorage.removeItem(JOB_KEY); } catch { /* Leave legacy copy; deduplication is by ID. */ }
	}
	checkedLegacyJob = true;
	const db = await open();
	return new Promise((resolve,reject) => { const request = db.transaction('pending').objectStore('pending').getAll(); request.onsuccess = () => resolve(request.result.sort((a:PendingJob,b:PendingJob)=>(a.queueOrder ?? 0)-(b.queueOrder ?? 0))[0] ?? null); request.onerror = () => reject(request.error); });
}

export async function clearJob(id: string) {
	const db = await open();
	await new Promise<void>((resolve,reject) => { const transaction = db.transaction('pending','readwrite'); transaction.objectStore('pending').delete(id); transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error); });
}

export async function cancelQueuedTakes() {
 const db=await open();
 await new Promise<void>((resolve,reject)=>{ const t=db.transaction('pending','readwrite'),s=t.objectStore('pending'),q=s.getAll(); q.onsuccess=()=>{for(const job of q.result) if(!job.submitted)s.delete(job.id);};t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error); });
}
