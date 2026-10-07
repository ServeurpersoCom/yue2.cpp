import { getContext } from './audio.js';

const cache = new Map<Blob, AudioBuffer>();
const pending = new WeakMap<Blob, Promise<AudioBuffer>>();
let tail: Promise<unknown> = Promise.resolve();
const LIMIT = 96 * 1024 * 1024;
export function audioCacheBytes() { return [...cache.values()].reduce((n,b) => n + b.length * b.numberOfChannels * 4, 0); }
export function decodeAudio(blob: Blob): Promise<AudioBuffer> {
 const hit = cache.get(blob);
 if (hit) { cache.delete(blob); cache.set(blob,hit); return Promise.resolve(hit); }
 const queued = pending.get(blob); if (queued) return queued;
 const work = tail.then(async () => {
  if (!blob.size || blob.size > 128 * 1024 * 1024) throw new Error('Choose a non-empty audio file smaller than 128 MiB.');
  const buffer = await getContext().decodeAudioData(await blob.arrayBuffer());
  if (!buffer.length || !Number.isFinite(buffer.duration)) throw new Error('The audio contains no playable samples.');
  cache.set(blob,buffer);
  while (audioCacheBytes() > LIMIT && cache.size) cache.delete(cache.keys().next().value!);
  return buffer;
 });
 pending.set(blob,work); tail = work.catch(() => {});
 void work.finally(() => pending.delete(blob)).catch(() => {});
 return work;
}
