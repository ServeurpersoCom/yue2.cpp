import type { JobTrack } from './api.js';

// Replay requests omit default values, including mastering_profile: 'off'.
// The server emits each dry take immediately before its mastered version.
export function completedTracks(tracks: JobTrack[]): (JobTrack & { originalAudio?: Blob })[] {
	const result: (JobTrack & { originalAudio?: Blob })[] = [];
	for (let i = 0; i < tracks.length; i++) {
		const track = tracks[i];
		const next = tracks[i + 1];
		if ((track.request.mastering_profile ?? 'off') === 'off' && next?.request.mastering_profile && next.request.mastering_profile !== 'off') {
			result.push({ ...next, originalAudio: track.audio });
			i++;
		} else result.push(track);
	}
	return result;
}
