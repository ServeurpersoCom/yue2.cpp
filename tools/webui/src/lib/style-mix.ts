export function clampInfluence(value: unknown, fallback = 50): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.max(0, Math.min(100, Math.round(value))) : fallback;
}

export function cleanMix(ids: unknown, weights: unknown, allowed: readonly string[], limit = Infinity) {
	const selected = Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && allowed.includes(id)))].slice(0, limit) : [];
	const values = weights && typeof weights === 'object' ? weights as Record<string, unknown> : {};
	return { ids: selected, weights: Object.fromEntries(selected.map(id => [id, clampInfluence(values[id])])) };
}

export function musicPrompt(ids: string[], weights: Record<string, number>, descriptions: Record<string, string>, names: ReadonlyArray<readonly [string, string]>): string {
	const active = [...new Set(ids)].slice(0, 3).filter(id => descriptions[id] && clampInfluence(weights[id]) > 0);
	if (!active.length) return '';
	const directions = active.map((id, index) => {
		const role = index === 0 ? 'Primary style' : 'Secondary influence';
		return `${role} — ${names.find(([key]) => key === id)?.[1] || id} (${clampInfluence(weights[id])}/100 strength): ${descriptions[id]}`;
	});
	return [
		'Use the primary style as the foundation. Blend secondary styles at their independent 0–100 strengths. Keep the supplied lyrics and language.',
		...directions
	].join('\n');
}

export function freeformMusicPrompt(prompt: string, strength: unknown): string {
	const direction = prompt.trim();
	const amount = clampInfluence(strength);
	if (!direction || amount === 0) return '';
	return `Music generation brief. Follow the user's musical direction at ${amount}/100 strength. A higher value means the direction should more strongly shape genre, rhythm, instrumentation, vocal delivery, arrangement and production. Preserve the requested lyrics and composition.\n${direction}`;
}

export function angleInfluence(x: number, y: number): number {
	return Math.round(((Math.atan2(y, x) * 180 / Math.PI + 450) % 360) / 3.6);
}
