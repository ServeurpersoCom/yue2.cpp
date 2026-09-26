import type { Song, Yue2Request } from './types.js';

const DB_NAME = 'yue2-songs';
const DB_VERSION = 1;
const STORE = 'songs';

// Module-scoped singleton: one IDB connection for the whole page lifetime.
// Connection is lazy, retriable on error (null reset), and shared by every
// put/get/delete call below.
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
			}
		};
		req.onsuccess = () => resolve(req.result);
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
	// IDBValidKey -> number (autoIncrement)
	return tx('readwrite', (s) => s.put(song)) as Promise<number>;
}

// Commit the entire result together; retrying recovery must not duplicate tracks.
export async function putJobSongs(jobId: string, songs: Song[]): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readwrite');
		const store = transaction.objectStore(STORE);
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error || new Error('Could not save completed song; recovery retained'));
		transaction.onerror = () => reject(transaction.error || new Error('Library storage failed'));
		const existing = store.getAll();
		existing.onsuccess = () => {
			if (existing.result.some((song: Song) => song.sourceJob === jobId)) return;
			for (const song of songs) store.add({ ...song, sourceJob: jobId });
		};
	});
}

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
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error || new Error('Library restore was rolled back'));
		transaction.onerror = () => reject(transaction.error || new Error('Library restore failed'));
	});
}

export function deleteSong(id: number): Promise<void> {
	return tx('readwrite', (s) => s.delete(id)) as Promise<void>;
}

// pending job: saved before polling starts, cleared on completion,
// so a page reload resumes polling and lands the finished song.

export interface PendingJob {
	takeGroup?: string;
	id: string;
	name: string;
	request: Yue2Request;
}

const JOB_KEY = 'yue2-job-synth';

export function saveJob(job: PendingJob) {
	localStorage.setItem(JOB_KEY, JSON.stringify(job));
}

export function loadJob(): PendingJob | null {
	const raw = localStorage.getItem(JOB_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function clearJob() {
	localStorage.removeItem(JOB_KEY);
}
