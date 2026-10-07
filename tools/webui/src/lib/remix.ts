import type { Song, Yue2Request } from './types.js';

export interface RemixDraft {
	sourceName: string;
	amount: number;
	request: Yue2Request;
}

export function canRemix(song: Song): boolean {
	return !!song.request.semantic_tokens?.trim() &&
		[song.request.lm_seed, song.request.seed].every(seed => typeof seed === 'number' && Number.isFinite(seed) && seed >= 0);
}

export function remixRequest(source: Yue2Request, amount: number, defaults?: Yue2Request): Yue2Request {
	const value = Math.max(0, Math.min(100, Math.round(Number.isFinite(amount) ? amount : 0)));
	const result: Yue2Request = { ...source, abc_sampling: { ...source.abc_sampling }, semantic_sampling: { ...source.semantic_sampling }, lm_batch_size: 1, synth_batch_size: 1 };
	if (value > 0) {
		// Replay codes freeze the performance. Regenerate them while holding the
		// source score and both seeds fixed. Sampling freedom is not audio distance.
		delete result.semantic_tokens;
		const base = source.semantic_sampling?.temperature ?? defaults?.semantic_sampling?.temperature ?? 1;
		result.semantic_sampling.temperature = Math.round((base + value / 100 * 0.5) * 1000) / 1000;
	}
	return result;
}
