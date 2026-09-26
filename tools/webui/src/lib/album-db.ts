import type { Album } from './album-types.js';

// Separate DB: existing track libraries do not need a schema upgrade.
function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('yue2-albums', 1);
		request.onupgradeneeded = () => request.result.createObjectStore('albums', { keyPath: 'id' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction('albums', mode);
		const request = operation(tx.objectStore('albums'));
		tx.oncomplete = () => { db.close(); resolve(request.result); };
		tx.onabort = () => { db.close(); reject(tx.error || new Error('Could not save album progress')); };
		tx.onerror = () => { /* abort owns rejection and cleanup */ };
	});
}
export async function saveAlbum(album: Album) { album.updated = Date.now(); await transaction('readwrite', store => store.put(album)); }
export async function listAlbums(): Promise<Album[]> { return (await transaction('readonly', store => store.getAll()) as Album[]).sort((a,b) => b.updated-a.updated); }
