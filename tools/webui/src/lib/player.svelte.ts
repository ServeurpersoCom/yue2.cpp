import { getContext, getPlaybackAnalyser, registerPlaying, unregisterPlaying } from './audio.js';
import type { Song } from './types.js';

export const player = $state({ song: null as Song | null, audio: null as Blob | null, playing: false, loading: false, time: 0, duration: 0, buffered: 0, error: '' });
let element: HTMLAudioElement | undefined;
let url = '';
let registered = -1;
let revision = 0;
// furthest buffered point (seconds), for the seek bar's buffered state
function updateBuffered(audio: HTMLAudioElement) { const ranges = audio.buffered; player.buffered = ranges.length ? ranges.end(ranges.length - 1) : 0; }
function unregister() { if (registered >= 0) unregisterPlaying(registered); registered = -1; }
function media() {
 if (element) return element;
 element = new Audio();
 const audio = element;
 getContext().createMediaElementSource(audio).connect(getPlaybackAnalyser());
 audio.addEventListener('playing', () => { player.playing = true; player.loading = false; unregister(); registered = registerPlaying(audio.duration, () => audio.currentTime); });
 audio.addEventListener('pause', () => { player.playing = false; unregister(); });
 audio.addEventListener('timeupdate', () => { player.time = audio.currentTime; });
 audio.addEventListener('loadedmetadata', () => { player.duration = Number.isFinite(audio.duration) ? audio.duration : 0; updateBuffered(audio); });
 audio.addEventListener('progress', () => updateBuffered(audio));
 audio.addEventListener('ended', () => { player.playing = false; player.time = 0; audio.currentTime = 0; unregister(); });
 audio.addEventListener('error', () => { player.error = 'This track could not be played. Try another track or retry playback.'; player.loading = false; player.playing = false; unregister(); });
 return audio;
}
export function isCurrent(song: Song, audio?: Blob) { return (player.song === song || (song.id != null && player.song?.id === song.id)) && (!audio || player.audio === audio); }
export function selectTrack(song: Song, blob = song.audio) {
 const audio = media();
 if (isCurrent(song, blob)) return;
 revision++; audio.pause(); unregister();
 if (url) URL.revokeObjectURL(url);
 player.song = song; player.audio = blob; player.time = 0; player.duration = song.duration || 0; player.buffered = 0; player.error = ''; player.loading = false; player.playing = false;
 url = URL.createObjectURL(blob); audio.src = url;
}
export async function resume() {
 if (!player.song) return;
 const audio = media(), request = ++revision;
 player.error = ''; player.loading = true;
 try { await getContext().resume(); if (request !== revision) return; await audio.play(); }
 catch (error) { if (request === revision) { player.loading = false; player.playing = false; player.error = 'Playback could not start. Press play to retry.'; } }
}
export function pause() { revision++; media().pause(); player.playing = false; player.loading = false; unregister(); }
export function toggleTrack(song: Song, blob = song.audio) {
 if (isCurrent(song, blob) && (player.playing || player.loading)) pause();
 else { selectTrack(song, blob); void resume(); }
}
export function seek(seconds: number) { const audio = media(); audio.currentTime = Math.max(0, Math.min(player.duration || 0, seconds)); player.time = audio.currentTime; }
export function setVolume(volume: number) { media().volume = Math.max(0, Math.min(1, volume)); }
export function clearTrack() { pause(); const audio = media(); audio.removeAttribute('src'); audio.load(); if (url) URL.revokeObjectURL(url); url = ''; player.song = null; player.audio = null; player.time = 0; player.duration = 0; player.buffered = 0; player.error = ''; }
