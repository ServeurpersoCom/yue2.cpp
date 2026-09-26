import type { ArtModels } from './album-types.js';

type NodeSpec = { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } };
export type NodeInfo = Record<string, NodeSpec>;
const nodes = ['UnetLoaderGGUF','CLIPLoader','VAELoader','TextEncodeQwenImage21','EmptyLatentImage','KSampler','VAEDecode','SaveImage','LoadImage'];

async function api(path: string, init?: RequestInit): Promise<Response> {
	const response = await fetch(`comfy/${path}`, { ...init, signal: AbortSignal.timeout(30000) });
	if (!response.ok) throw new Error(`Artwork service: ${response.status} ${(await response.text()).slice(0,350)}`);
	return response;
}
export function availableArtModels(info: NodeInfo): ArtModels {
	const missing = nodes.filter(name => !info[name]);
	if (missing.length) throw new Error(`ComfyUI needs Qwen 2.1 support and its GGUF loader. Missing: ${missing.join(', ')}`);
	function choose(node: string, field: string, pattern: RegExp) {
		const values = info[node]?.input?.required?.[field]?.[0];
		const options = Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
		const match = options.find(name => pattern.test(name));
		if (!match) throw new Error(`Missing compatible Qwen 2.1 file for ${field}. No models are downloaded automatically.`);
		return match;
	}
	return { diffusion: choose('UnetLoaderGGUF','unet_name',/qwen[-_]image[-_]?2[._]1.*Q4_K_M/i),
		encoder: choose('CLIPLoader','clip_name',/qwen3vl.*8b.*int8/i), vae: choose('VAELoader','vae_name',/qwen_image_2[._]1_vae/i) };
}
export async function checkArtwork(): Promise<ArtModels> { return availableArtModels(await (await api('object_info')).json()); }
export async function ensureComfyIdle() {
	const queue = await (await api('queue')).json();
	if (queue.queue_running?.length || queue.queue_pending?.length) throw new Error('ComfyUI has another queued/running task. Album paused; no other tasks were interrupted.');
}
export async function freeArtworkMemory() {
	await ensureComfyIdle();
	await api('free', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
}
export function artworkGraph(models: ArtModels, prompt: string, seed: number, prefix: string, reference?: string) {
	const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
		'1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: models.diffusion } },
		'2': { class_type: 'CLIPLoader', inputs: { clip_name: models.encoder, type: 'qwen_image', device: 'cpu' } },
		'3': { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
		'4': { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['2',0], vae: ['3',0], prompt, negative_prompt: '', resolution: 1024 } },
		'5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
		'6': { class_type: 'KSampler', inputs: { model: ['1',0], seed, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['4',0], negative: ['4',1], latent_image: ['5',0], denoise: 1 } },
		'7': { class_type: 'VAEDecode', inputs: { samples: ['6',0], vae: ['3',0] } },
		'8': { class_type: 'SaveImage', inputs: { images: ['7',0], filename_prefix: prefix } }
	};
	if (reference) { graph['9'] = { class_type: 'LoadImage', inputs: { image: reference } }; graph['4'].inputs['images.image_1'] = ['9',0]; }
	return graph;
}
export async function submitArtwork(models: ArtModels, prompt: string, seed: number, prefix: string, reference?: string): Promise<string> {
	await ensureComfyIdle();
	const data = await (await api('prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: artworkGraph(models, prompt, seed, prefix, reference), client_id: 'yue2-album' }) })).json();
	if (!data.prompt_id) throw new Error('Artwork was not accepted by ComfyUI.');
	return data.prompt_id;
}
export async function artworkResult(id: string): Promise<Blob | null> {
	const history = await (await api(`history/${encodeURIComponent(id)}`)).json();
	const item = history[id];
	if (!item) {
		const queue = await (await api('queue')).json();
		if (![...(queue.queue_running || []), ...(queue.queue_pending || [])].some((entry: unknown[]) => entry[1] === id)) throw new Error('Artwork job missing after ComfyUI restart. Reset the failed stage to retry.');
		return null;
	}
	if (item.status?.status_str === 'error') throw new Error(`Artwork failed: ${JSON.stringify(item.status.messages).slice(-500)}. Reset the failed stage to retry.`);
	const image = item.outputs?.['8']?.images?.[0];
	if (!image) { if (item.status?.completed) throw new Error('Artwork job produced no image.'); return null; }
	return (await api(`view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' })}`)).blob();
}
export async function uploadReference(cover: Blob, albumId: string): Promise<string> {
	const form = new FormData(); form.append('image', cover, `yue2-album-${albumId}.png`); form.append('type', 'input'); form.append('overwrite', 'false');
	const result = await (await api('upload/image', { method: 'POST', body: form })).json();
	return `${result.subfolder ? result.subfolder + '/' : ''}${result.name} [input]`;
}
