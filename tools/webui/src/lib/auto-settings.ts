import type { Yue2Request } from './types.js';

// Modest composition-only adjustments around the checkpoint's published 0.7 default.
// Codec sampling, token budgets and CFG stay at model defaults. These are starting
// points, not genre-specific quality measurements or a mastering processor.
const groups = [
 { name: 'Rhythmic focus', temperature: .65, keys: ['boom_bap','modern_trap','liquid_dnb','deep_house','disco_funk','afrobeat','latin_reggaeton','uk_garage','minimal_techno','brass_funk','festival_electronic'], match: /\b(trap|hip.?hop|boom.?bap|house|techno|garage|drum.{0,3}bass|reggaeton|funk|afrobeat)\b/i },
 { name: 'Expressive harmony', temperature: .75, keys: ['jazz_noir','ambient_cinematic','orchestral_pop','gospel_soul','bossa_nova','cinematic_trailer'], match: /\b(jazz|ambient|orchestral|gospel|bossa|cinematic)\b/i },
 { name: 'Balanced composition', temperature: .7, keys: [], match: /./ }
];
export function automaticProfile(ids: string[], weights: Record<string, number>, prompt: string, defaults?: Yue2Request) {
 let total = 0, temperature = 0;
 const labels = new Set<string>();
 for (const id of ids) {
  const raw = Number(weights[id] ?? 50), weight = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  if (!weight) continue;
  const group = groups.find(g => g.keys.includes(id)) ?? groups[2];
  total += weight; temperature += weight * group.temperature; labels.add(group.name);
 }
 if (!total) {
  const group = ids.length ? groups[2] : groups.find(g => g.match.test(prompt)) ?? groups[2];
  temperature = group.temperature; total = 1; labels.add(group.name);
 }
 const base = defaults?.abc_sampling?.temperature ?? .7;
 const scoreTemperature = Math.round(Math.max(.1, Math.min(1.5, base + temperature / total - .7)) * 100) / 100;
 const settings = {
  abc_sampling: { ...(defaults?.abc_sampling ?? {temperature:.7,top_p:.9,top_k:30,repetition_penalty:1.005,penalty_window:100,min_tokens:32,max_tokens:4096}), temperature: scoreTemperature },
  semantic_sampling: { ...(defaults?.semantic_sampling ?? {temperature:1,top_p:.95,top_k:100,repetition_penalty:1.2,penalty_window:50,min_tokens:200,max_tokens:9000}) },
  cfg_scale: defaults?.cfg_scale ?? -1,
  steps: defaults?.steps ?? 32,
  peak_clip: defaults?.peak_clip ?? 10,
  mp3_bitrate: 320
 };
 return { name: labels.size > 1 ? 'Blended composition' : [...labels][0], settings, scoreTemperature };
}
export function applyAutomaticSettings(request: Yue2Request, profile: ReturnType<typeof automaticProfile>): Yue2Request {
 // A reused take already has its score and codes; never rewrite those, seeds,
 // durations, batch sizes or output format while applying the render profile.
 return {...request, ...profile.settings, abc_sampling:{...profile.settings.abc_sampling}, semantic_sampling:{...profile.settings.semantic_sampling}};
}
export function hasManualSettings(request: Yue2Request): boolean {
 return !!(Object.values(request.abc_sampling ?? {}).some(v => v != null && String(v) !== '') ||
  Object.values(request.semantic_sampling ?? {}).some(v => v != null && String(v) !== '') ||
  [request.cfg_scale,request.steps,request.peak_clip,request.mp3_bitrate].some(v => v != null && String(v) !== ''));
}
