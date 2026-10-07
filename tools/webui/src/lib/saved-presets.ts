import { validRequest } from './validation.js';
import { cleanProducer, type ProducerSettings } from './producer.js';
export type PresetData = { ids: string[]; weights: Record<string, number>; prompt?: string; configuration?: {request: import('./types.js').Yue2Request; producer: ProducerSettings; format:string; mix?: string; automatic?:boolean; freshComposition?:boolean} };
export type SavedPreset = { name: string; kind: 'music' | 'lyric' | 'studio'; data: PresetData };
export function validatePresets(value: unknown): SavedPreset[] {
 if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid saved preset list.');
 const names = new Set<string>();
 return value.map(p => {
  if (!p || typeof p.name !== 'string' || !p.name.trim() || new TextEncoder().encode(p.name).length > 200 || /[<>:"/\\|?*\x00-\x1f]/.test(p.name) || /[. ]$/.test(p.name) || !['music','lyric','studio'].includes(p.kind) || !p.data || !Array.isArray(p.data.ids) || p.data.ids.some((id:unknown) => typeof id !== 'string') || !p.data.weights || typeof p.data.weights !== 'object' || Array.isArray(p.data.weights) || Object.values(p.data.weights).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) || (p.data.prompt !== undefined && typeof p.data.prompt !== 'string')) throw new Error('Invalid saved preset name or style data.');
  const key = `${p.kind}:${p.name.toLowerCase()}`; if (names.has(key)) throw new Error('Duplicate preset name in backup.'); names.add(key);
  if (p.kind==='studio') { if (!p.data.configuration || !['mp3','mp4','wav16','wav24','wav32'].includes(p.data.configuration.format)) throw new Error('Invalid Studio configuration.'); p.data.configuration={request:validRequest(p.data.configuration.request),producer:cleanProducer(p.data.configuration.producer),format:p.data.configuration.format,automatic:typeof p.data.configuration.automatic==='boolean'?p.data.configuration.automatic:undefined,freshComposition:typeof p.data.configuration.freshComposition==='boolean'?p.data.configuration.freshComposition:undefined,mix:typeof p.data.configuration.mix==='string'?p.data.configuration.mix:undefined}; }
  return {name:p.name,kind:p.kind,data:{ids:p.data.ids,weights:p.data.weights,...(p.kind==='studio'?{configuration:p.data.configuration}:{}),...(p.data.prompt !== undefined ? {prompt:p.data.prompt} : {})}};
 });
}
export async function listPresets(): Promise<SavedPreset[]> {
	const response = await fetch('presets');
	if (!response.ok) throw new Error('Could not read the saved_presets folder.');
	return validatePresets(await response.json());
}

// Merge restored presets without overwriting newer local presets. Matching
// names with different content receive a new name; a partial failure is safe.
export async function importPresets(presets: SavedPreset[]): Promise<void> {
 for (const preset of validatePresets(presets)) {
  const existing = await listPresets();
  const match = existing.find(p => p.kind === preset.kind && p.name.toLowerCase() === preset.name.toLowerCase());
  if (match && JSON.stringify(match.data) === JSON.stringify(preset.data)) continue;
  let name = preset.name;
  for (let index = 2; existing.some(p => p.kind === preset.kind && p.name.toLowerCase() === name.toLowerCase()); index++) name = `${preset.name.slice(0, 35)} (restored ${index})`;
  await writePreset({...preset,name});
 }
}
export async function writePreset(preset: SavedPreset, operation: 'save' | 'delete' = 'save', overwrite = false) {
	const response = await fetch('presets', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...preset,operation,overwrite}) });
	if (!response.ok) throw new Error(await response.text() || 'Could not save preset.');
	notifyPresets();
}

const channel = typeof window==='undefined' || typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('yue2-presets');
channel?.addEventListener('message',()=>window.dispatchEvent(new Event('yue2-presets-changed')));
function notifyPresets(){window.dispatchEvent(new Event('yue2-presets-changed'));channel?.postMessage('changed');}
export async function renamePreset(preset:SavedPreset,oldName:string) {
 const response=await fetch('presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...preset,oldName,operation:'rename'})});
 if(!response.ok)throw new Error(await response.text()); notifyPresets();
}
