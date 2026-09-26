export interface LyricModel { name: string; size: number }
const endpoint = 'http://127.0.0.1:11434';

export async function discoverLyricModels(): Promise<LyricModel[]> {
	const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10000) });
	if (!response.ok) throw new Error(`Ollama model discovery failed (${response.status})`);
	const data = await response.json();
	return (data.models || []).filter((m: LyricModel) => typeof m.name === 'string')
		.sort((a: LyricModel, b: LyricModel) => a.size - b.size);
}

export async function writeLyrics(model: string, prompt: string, signal: AbortSignal): Promise<string> {
	const response = await fetch(`${endpoint}/api/generate`, {
		method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, prompt, stream: false, think: false, keep_alive: 0,
			options: { temperature: 0.82, num_ctx: 8192, num_predict: 2048 } })
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data.error || `Ollama failed (${response.status})`);
	const lyrics = typeof data.response === 'string' ? data.response.trim() : '';
	if (!lyrics) throw new Error('Ollama returned no lyrics. Existing lyrics preserved.');
	return lyrics;
}
