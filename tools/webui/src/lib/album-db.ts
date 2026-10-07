import { validRequest } from './validation.js';
import type { Album } from './album-types.js';

// Separate DB: existing track libraries do not need a schema upgrade.
function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('yue2-albums', 1);
		request.onupgradeneeded = () => request.result.createObjectStore('albums', { keyPath: 'id' });
		request.onblocked = () => reject(new Error('Close the older Studio tab to open album storage.'));
		request.onsuccess = () => {request.result.onversionchange=()=>request.result.close();resolve(request.result);};
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

export function validateAlbum(value:unknown):Album {
 const a=value as Album;
 if(!a||a.version!==1||typeof a.id!=='string'||typeof a.title!=='string'||typeof a.visualStyle!=='string'||!Number.isFinite(a.seed)||!Number.isFinite(a.created)||!Number.isFinite(a.updated)||typeof a.video!=='boolean'||typeof a.artwork!=='boolean'||!Array.isArray(a.tracks)||a.tracks.length>30||a.tracks.some(t=>!t||typeof t.id!=='string'||typeof t.title!=='string'||typeof t.lyrics!=='string'||typeof t.artDirection!=='string'))throw new Error('Invalid album plan in backup.');
 return {...a,request:validRequest(a.request),status:a.status==='complete'?'complete':'paused'};
}
export async function restoreAlbums(albums:Album[],songs:import('./types.js').Song[]) {
 for(const source of albums){const a=validateAlbum(source);a.tracks=a.tracks.map(t=>{const song=songs.find(s=>s.albumId===a.id&&s.albumTrackId===t.id);return {...t,songId:song?.id,jobId:undefined,artJobId:undefined,videoJobId:undefined,artDone:!!song?.artwork,videoDone:!!song?.video};});a.coverJobId=undefined;a.status=a.tracks.every(t=>t.songId&&(!(a.artwork||a.video)||t.artDone)&&(!a.video||t.videoDone))?'complete':'paused';await saveAlbum(a);}
}
