import type { Song } from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MEDIA_FIELDS = ['audio', 'originalAudio', 'vocalOriginalAudio', 'artwork', 'video'] as const;
const LOCAL_STORAGE_KEYS = ['yue2', 'yue2-music-blend-favourites-v1', 'yue2-lyric-blend-favourites-v1', 'yue2-music-styles'];
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	crcTable[n] = c >>> 0;
}

type MediaField = (typeof MEDIA_FIELDS)[number];
type BackupRecord = {
	data: Record<string, unknown>;
	media: Partial<Record<MediaField, { path: string; type: string }>>;
};
type Manifest = {
	format: 'yue2-library-backup';
	version: 1;
	created: string;
	songs: BackupRecord[];
	settings: Record<string, string>;
};
type ZipEntry = { name: string; blob: Blob; crc: number; size: number; offset: number };
type ZipDirectoryEntry = { name: string; method: number; crc: number; size: number; offset: number };

function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

async function crc32(blob: Blob): Promise<number> {
	let crc = 0xffffffff;
	const reader = blob.stream().getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function zipHeader(name: Uint8Array, crc: number, size: number, offset = 0, central = false): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(central ? 46 + name.length : 30 + name.length);
	const view = new DataView(bytes.buffer);
	if (central) {
		u32(view, 0, 0x02014b50);
		u16(view, 4, 20);
		u16(view, 6, 20);
		u16(view, 8, 0x0800);
		u16(view, 10, 0);
		u16(view, 12, 0);
		u16(view, 14, 0x21);
		u32(view, 16, crc);
		u32(view, 20, size);
		u32(view, 24, size);
		u16(view, 28, name.length);
		u32(view, 42, offset);
		bytes.set(name, 46);
	} else {
		u32(view, 0, 0x04034b50);
		u16(view, 4, 20);
		u16(view, 6, 0x0800);
		u16(view, 8, 0);
		u16(view, 10, 0);
		u16(view, 12, 0x21);
		u32(view, 14, crc);
		u32(view, 18, size);
		u32(view, 22, size);
		u16(view, 26, name.length);
		bytes.set(name, 30);
	}
	return bytes;
}

async function createZip(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
	if (files.length > 0xffff) throw new Error('This library has too many files for a single ZIP backup.');
	const chunks: BlobPart[] = [];
	const entries: ZipEntry[] = [];
	let offset = 0;
	for (const file of files) {
		const name = encoder.encode(file.name);
		if (name.length > 65535 || file.blob.size > 0xffffffff) throw new Error('A backup entry exceeds the ZIP format size limit.');
		const crc = await crc32(file.blob);
		const header = zipHeader(name, crc, file.blob.size);
		entries.push({ ...file, crc, size: file.blob.size, offset });
		chunks.push(header, file.blob);
		offset += header.length + file.blob.size;
		if (offset > 0xffffffff) throw new Error('This library is too large for a single ZIP backup.');
	}
	const centralOffset = offset;
	for (const entry of entries) {
		const header = zipHeader(encoder.encode(entry.name), entry.crc, entry.size, entry.offset, true);
		chunks.push(header);
		offset += header.length;
	}
	if (offset > 0xffffffff) throw new Error('This library is too large for a single ZIP backup.');
	const centralSize = offset - centralOffset;
	const end = new Uint8Array(22);
	const view = new DataView(end.buffer);
	u32(view, 0, 0x06054b50);
	u16(view, 8, entries.length);
	u16(view, 10, entries.length);
	u32(view, 12, centralSize);
	u32(view, 16, centralOffset);
	chunks.push(end);
	return new Blob(chunks, { type: 'application/zip' });
}

export async function exportLibrary(songs: Song[]): Promise<Blob> {
	const files: Array<{ name: string; blob: Blob }> = [];
	const records: BackupRecord[] = [];
	for (let index = 0; index < songs.length; index++) {
		const song = songs[index];
		const data: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(song)) {
			if (key !== 'id' && key !== 'peaks' && !MEDIA_FIELDS.includes(key as MediaField)) data[key] = value;
		}
		const media: BackupRecord['media'] = {};
		for (const field of MEDIA_FIELDS) {
			const blob = song[field];
			if (blob instanceof Blob) {
				const path = `media/${String(index + 1).padStart(5, '0')}/${field}`;
				media[field] = { path, type: blob.type };
				files.push({ name: path, blob });
			}
		}
		records.push({ data, media });
	}
	const settings: Record<string, string> = {};
	for (const key of LOCAL_STORAGE_KEYS) {
		const value = localStorage.getItem(key);
		if (value != null) settings[key] = value;
	}
	const manifest: Manifest = { format: 'yue2-library-backup', version: 1, created: new Date().toISOString(), songs: records, settings };
	files.unshift({ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) });
	return createZip(files);
}

async function readDirectory(archive: Blob): Promise<Map<string, ZipDirectoryEntry>> {
	const tailStart = Math.max(0, archive.size - 65557);
	const tail = new DataView(await archive.slice(tailStart).arrayBuffer());
	let endOffset = -1;
	for (let i = tail.byteLength - 22; i >= 0; i--) {
		if (tail.getUint32(i, true) === 0x06054b50) { endOffset = i; break; }
	}
	if (endOffset < 0) throw new Error('This is not a valid YuE2 ZIP backup.');
	const count = tail.getUint16(endOffset + 10, true);
	const directorySize = tail.getUint32(endOffset + 12, true);
	const directoryOffset = tail.getUint32(endOffset + 16, true);
	if (directoryOffset + directorySize > archive.size) throw new Error('The backup directory is incomplete.');
	const bytes = new DataView(await archive.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer());
	const entries = new Map<string, ZipDirectoryEntry>();
	let pos = 0;
	for (let i = 0; i < count; i++) {
		if (bytes.getUint32(pos, true) !== 0x02014b50) throw new Error('The backup directory is corrupt.');
		const method = bytes.getUint16(pos + 10, true);
		const crc = bytes.getUint32(pos + 16, true);
		const compressed = bytes.getUint32(pos + 20, true);
		const size = bytes.getUint32(pos + 24, true);
		const nameLength = bytes.getUint16(pos + 28, true);
		const extraLength = bytes.getUint16(pos + 30, true);
		const commentLength = bytes.getUint16(pos + 32, true);
		const localOffset = bytes.getUint32(pos + 42, true);
		const name = decoder.decode(new Uint8Array(bytes.buffer, bytes.byteOffset + pos + 46, nameLength));
		if (method !== 0 || compressed !== size) throw new Error('This ZIP uses compression not supported by YuE2 backups.');
		entries.set(name, { name, method, crc, size, offset: localOffset });
		pos += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

async function zipEntryBlob(archive: Blob, entry: ZipDirectoryEntry): Promise<Blob> {
	const header = new DataView(await archive.slice(entry.offset, entry.offset + 30).arrayBuffer());
	if (header.getUint32(0, true) !== 0x04034b50) throw new Error(`The backup entry ${entry.name} is corrupt.`);
	const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
	const blob = archive.slice(start, start + entry.size);
	if (blob.size !== entry.size || await crc32(blob) !== entry.crc) throw new Error(`The backup entry ${entry.name} failed its integrity check.`);
	return blob;
}

export async function importLibrary(archive: Blob): Promise<{ songs: Song[]; settings: Record<string, string> }> {
	const directory = await readDirectory(archive);
	const manifestEntry = directory.get('manifest.json');
	if (!manifestEntry) throw new Error('The backup does not contain a library manifest.');
	const manifest = JSON.parse(await (await zipEntryBlob(archive, manifestEntry)).text()) as Manifest;
	if (manifest.format !== 'yue2-library-backup' || manifest.version !== 1 || !Array.isArray(manifest.songs)) {
		throw new Error('This YuE2 backup version is not supported.');
	}
	if (!manifest.settings || typeof manifest.settings !== 'object' || Array.isArray(manifest.settings)) {
		throw new Error('The backup contains invalid settings.');
	}
	const songs: Song[] = [];
	for (const record of manifest.songs) {
		if (!record || typeof record.data !== 'object' || !record.data || !record.media || typeof record.media !== 'object') {
			throw new Error('The backup contains an invalid song record.');
		}
		const song = { ...record.data } as unknown as Song;
		for (const field of MEDIA_FIELDS) {
			const media = record.media[field];
			if (media) {
				if (typeof media.path !== 'string' || typeof media.type !== 'string') throw new Error('The backup contains invalid media metadata.');
				const entry = directory.get(media.path);
				if (!entry) throw new Error(`The backup is missing ${media.path}.`);
				const bytes = await zipEntryBlob(archive, entry);
				(song as unknown as Record<MediaField, Blob | undefined>)[field] = new Blob([bytes], { type: media.type });
			}
		}
		if (!(song.audio instanceof Blob) || typeof song.name !== 'string' || !song.request) {
			throw new Error('The backup contains an invalid or incomplete song.');
		}
		songs.push(song);
	}
	return { songs, settings: manifest.settings || {} };
}
