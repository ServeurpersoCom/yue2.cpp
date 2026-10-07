import type { Yue2Request } from './types.js';

export function prepareGeneration(request: Yue2Request, fresh: boolean): Yue2Request {
	const next = { ...request };
	if (fresh) {
		// Cached scores bypass composition; cached codes bypass performance generation.
		delete next.abc;
		delete next.semantic_tokens;
	}
	for (const key of ['lm_seed', 'seed'] as const) {
		const seed = next[key];
		if (fresh || seed == null || seed < 0) next[key] = crypto.getRandomValues(new Uint32Array(1))[0];
	}
	return next;
}
