import { checkArtwork, submitArtwork, artworkResult, uploadReference } from './comfy-art.js';
import { updateSong } from './db.js';
import { JOB_POLL_MS } from './config.js';
import type { Song } from './types.js';

export function trackArtworkPrompt(song: Pick<Song, 'name' | 'style' | 'request'>): string {
 return `Create finished album cover artwork inspired by this song. Interpret the title and lyrics as a specific scene with expressive lighting, rich texture, depth and a strong focal subject. Professional cinematic illustration. No lettering, typography, logos, watermarks or plain title cards. Center the main subject for widescreen cropping.
Song title: ${song.name.slice(0,200)}
Musical mood: ${song.style.slice(0,1200)}
Lyrical imagery: ${(song.request.lyrics ?? '').slice(0,2200)}`;
}
export async function generateTrackArtwork(song: Pick<Song,'name'|'style'|'request'|'created'> & Partial<Song>, existingId?: string, submitted?: (id:string)=>void|Promise<void>, signal?: AbortSignal, options?: {prompt?:string;seed?:number;reference?:Blob}): Promise<Blob> {
 signal?.throwIfAborted();
 let id = existingId ?? song.artworkJobId;
 if (!id) {
  const models = await checkArtwork();
  const reference = options?.reference ? await uploadReference(options.reference,String(song.id ?? song.created)) : undefined;
  signal?.throwIfAborted();
  id = await submitArtwork(models, options?.prompt ?? trackArtworkPrompt(song), options?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0], `yue2-track-${song.created}`, reference);
  // Persist ownership before polling. Closing the dialog or tab can reconnect.
  if (song.id != null) { await updateSong(song.id,{artworkJobId:id}); song.artworkJobId = id; }
  await submitted?.(id);
 }
 const deadline = Date.now()+20*60_000;
 while (Date.now()<deadline) {
  signal?.throwIfAborted();
  const image = await artworkResult(id);
  signal?.throwIfAborted();
  if (image) return image;
  await new Promise(resolve=>setTimeout(resolve,JOB_POLL_MS));
 }
 throw new Error('Artwork is still processing. Your prompt ID is saved; use Reconnect artwork to collect it later.');
}
