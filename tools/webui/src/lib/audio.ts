// audio.ts: shared AudioContext and playback sync
//
// All Waveform components share a single AudioContext so they run on
// the same sample clock. When a track starts playing, it checks if
// another track with the same duration is already playing and syncs
// to its position (same duration = same song variation).

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;

// shared AudioContext, created on first use
export function getContext(): AudioContext {
	if (!ctx) {
		ctx = new AudioContext();
	}
	return ctx;
}

// Shared playback output and live spectrum for the studio visualizer.
// Every track's gain node feeds this analyser, which also feeds the speakers.
export function getPlaybackAnalyser(): AnalyserNode {
	const context = getContext();
	if (!analyser) {
		analyser = context.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0.78;
		analyser.minDecibels = -85;
		analyser.maxDecibels = -12;
		analyser.connect(context.destination);
	}
	return analyser;
}

// playing track registry for auto sync

interface PlayingTrack {
	duration: number;
	getTime: () => number;
}

const tracks = new Map<number, PlayingTrack>();
let nextId = 0;
const playbackListeners = new Set<(playing: boolean) => void>();

function notifyPlayback() {
	const playing = tracks.size > 0;
	for (const listener of playbackListeners) listener(playing);
}

export function subscribePlayback(listener: (playing: boolean) => void): () => void {
	playbackListeners.add(listener);
	listener(tracks.size > 0);
	return () => playbackListeners.delete(listener);
}

// register a playing track. returns id for unregister.
export function registerPlaying(duration: number, getTime: () => number): number {
	const id = nextId++;
	tracks.set(id, { duration, getTime });
	notifyPlayback();
	return id;
}

// unregister a track when playback stops
export function unregisterPlaying(id: number) {
	if (tracks.delete(id)) notifyPlayback();
}

export function isPlaying(): boolean {
	return tracks.size > 0;
}

// number of tracks currently playing (for volume division)
export function playingCount(): number {
	return tracks.size || 1;
}

// find the position of any playing track with the same duration.
// returns its current time, or -1 if no match.
export function findSyncPosition(duration: number, excludeId: number): number {
	for (const [id, track] of tracks) {
		if (id !== excludeId && Math.abs(track.duration - duration) < 0.1) {
			return track.getTime();
		}
	}
	return -1;
}
