import { emptyRequest, FIELDS, SAMPLING_KEYS } from './fields.js';
import type { Yue2Request, Song } from './types.js';

export function object(value: unknown): value is Record<string, unknown> {
 return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function validRequest(value: unknown): Yue2Request {
 if (!object(value)) throw new Error('Saved request must be an object.');
 const result = emptyRequest();
 const target = result as unknown as Record<string, unknown>;
 for (const field of [...FIELDS, {key:'output_format',type:'str'}]) {
  const raw = value[field.key];
  if (raw == null || raw === '') continue;
  if (field.type === 'str') {
   if (typeof raw !== 'string') throw new Error(`Invalid request field: ${field.key}`);
   target[field.key] = raw;
  } else {
   if (!['number','string'].includes(typeof raw) || !Number.isFinite(Number(raw))) throw new Error(`Invalid request number: ${field.key}`);
   target[field.key] = Number(raw);
  }
 }
 for (const key of ['abc_sampling','semantic_sampling'] as const) {
  const raw = value[key];
  if (raw == null) continue;
  if (!object(raw)) throw new Error(`Invalid ${key}`);
  for (const field of SAMPLING_KEYS) {
   const n = raw[field];
   if (n == null || n === '') continue;
   if (!['number','string'].includes(typeof n) || !Number.isFinite(Number(n))) throw new Error(`Invalid sampling field: ${field}`);
   result[key][field] = Number(n);
  }
 }
 return result;
}
export function validSong(value: unknown): Song {
 if (!object(value) || !(value.audio instanceof Blob) || value.audio.size === 0) throw new Error('Backup track has no audio.');
 for (const key of ['name','style','format']) if (typeof value[key] !== 'string') throw new Error(`Backup track has invalid ${key}.`);
 if (!['mp3','wav','wav16','wav24','wav32','mp4'].includes(value.format as string)) throw new Error('Backup track format is unsupported.');
 for (const key of ['created','duration','seed']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new Error(`Backup track has invalid ${key}.`);
 for (const key of ['musicStyles','lyricStyles']) {
  const list = value[key];
  if (list !== undefined && (!Array.isArray(list) || list.some(v => !object(v) || typeof v.id !== 'string' || typeof v.weight !== 'number' || !Number.isFinite(v.weight)))) throw new Error(`Backup track has invalid ${key}.`);
 }
 if (value.favorite !== undefined && typeof value.favorite !== 'boolean') throw new Error('Backup favourite is invalid.');
 if (value.youtubeDraft !== undefined) {
  const draft = value.youtubeDraft;
  if (!object(draft) || draft.version !== 1 || ['title','description','tags','playlist','endScreen'].some(key => typeof draft[key] !== 'string') || !['review','kids','general'].includes(String(draft.audience)) || !['private','unlisted','public'].includes(String(draft.visibility))) throw new Error('Backup YouTube draft is invalid.');
 }
 for (const key of ['sourceJob','takeGroup','score','albumId','albumTitle','albumTrackId']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`Backup track has invalid ${key}.`);
 return {...value, score: value.score ?? '', request:validRequest(value.request)} as unknown as Song;
}
