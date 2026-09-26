import type { Yue2Request } from './types.js';

export interface ProducerSettings {
 enabled: boolean;
 singing: number;
 presence: number;
 voices: number;
 voiceProfiles: string[];
 voiceLocked: boolean;
 bpm: number;
 structure: string;
 takes: number;
}
export const defaultProducer: ProducerSettings = {
 enabled: true, singing: 75, presence: 75, voices: 1,
 voiceProfiles: ['Warm clear mid-range lead, natural phrasing', 'Bright airy upper voice', 'Low resonant voice', 'Soft textured voice'],
 voiceLocked: false, bpm: 100, structure: '', takes: 1
};
export function cleanProducer(value: Partial<ProducerSettings> = {}): ProducerSettings {
 const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : fallback;
 return {
  enabled: value.enabled !== false,
  singing: number(value.singing, 75, 0, 100), presence: number(value.presence, 75, 0, 100),
  voices: number(value.voices, 1, 1, 4), bpm: number(value.bpm, 100, 40, 220), takes: value.takes === 3 ? 3 : 1,
  voiceLocked: value.voiceLocked === true,
  voiceProfiles: defaultProducer.voiceProfiles.map((fallback, i) => typeof value.voiceProfiles?.[i] === 'string' ? value.voiceProfiles[i].slice(0, 240) : fallback),
  structure: typeof value.structure === 'string' ? value.structure.slice(0, 2000) : ''
 };
}
export function delivery(p: ProducerSettings): string {
 if (p.presence === 0) return 'Instrumental only; no singing, speech, humming or vocal samples.';
 if (p.singing === 0) return 'Rhythmic rap or spoken delivery throughout; no melodic singing.';
 if (p.singing === 100) return 'Fully melodic singing throughout vocal sections; no rap or spoken delivery.';
 return p.singing < 35 ? 'Mostly rhythmic rap verses, with a short melodic sung hook.' : p.singing < 70
  ? 'Rap or rhythmic spoken verses contrasting with clearly sung melodic choruses.'
  : 'Mostly melodic singing, with occasional rhythmic spoken phrases in verses; fully sung choruses.';
}
export function songPlan(p: ProducerSettings): string {
 if (p.structure.trim()) return p.structure.trim();
 if (p.presence === 0) return 'Instrumental intro → main theme → contrasting theme → breakdown → developed main theme → resolved outro';
 const verse = p.singing < 70 ? 'rhythmic verse' : 'restrained sung verse';
 const chorus = p.singing === 0 ? 'rhythmic hook' : 'memorable sung chorus';
 const breakSection = p.presence < 50 ? 'extended instrumental break' : 'short instrumental turnaround';
 return `Instrumental intro → ${verse} → ${chorus} → ${breakSection} → contrasting second verse → sparse bridge → fuller final ${chorus} → resolved outro`;
}
export function producerDirection(p: ProducerSettings): string {
 const parts = [`Tempo: approximately ${p.bpm} BPM.`, delivery(p), `Arrangement: ${songPlan(p)}.`];
 if (p.presence > 0) {
  parts.push(`Singing balance: approximately ${p.singing}% melodic singing and ${100 - p.singing}% rap or spoken phrasing within vocal passages.`);
  parts.push(`Vocal presence: approximately ${p.presence}% of the arrangement, leaving ${100 - p.presence}% for instrumental space and breaths.`);
  parts.push(`Requested cast: ${p.voices} distinct vocal ${p.voices === 1 ? 'voice; solo lead' : 'voices; alternate lead sections and join on the final hook'}.`);
  parts.push(...p.voiceProfiles.slice(0, p.voices).map((voice, i) => `Voice ${i + 1}: ${voice.trim() || defaultProducer.voiceProfiles[i]}.`));
  parts.push('Keep vocal character consistent within the song. Clear diction, natural breaths, dynamic contrast between sections.');
 }
 return parts.join('\n');
}
export function lyricGuidance(p: ProducerSettings, style: string, duration?: number): string {
 return `Musical direction: ${style}\n${producerDirection(p)}\nTarget duration: ${duration && duration > 0 ? `${duration} seconds` : 'choose a natural length for the plan'}.\nFit lyric density to tempo and delivery. Use natural word stress, singable vowels and breathing space. Sung lines should be less dense than rap lines. Build a memorable repeating hook, develop the second verse, and vary the final chorus deliberately. Use bracketed section labels; keep production instructions out of performed lines. For multiple voices, identify the voice in section labels. Instrumental sections contain no words. The arrangement and delivery instructions take priority over conflicting lyric-style density rules. Return only the final lyrics.`;
}
export function estimatedDuration(p: ProducerSettings, lyrics: string): number {
 // Approximate 4/4 phrase budget, not audio alignment. Labels never count as words.
 const lines = lyrics.replace(/\[[^\]]*\]/g, '').split(/\n/).map(s => s.trim()).filter(Boolean);
 if (!lines.length || p.presence === 0) return 180;
 const wordsPerBar = 9 - p.singing / 100 * 5;
 const bars = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.split(/\s+/).length / wordsPerBar)), 0);
 return Math.min(600, Math.max(30, Math.ceil(bars * 240 / p.bpm / Math.max(.15, p.presence / 100) + 8 * 240 / p.bpm)));
}
export function applyProducer(request: Yue2Request, settings: ProducerSettings): Yue2Request {
 const p = cleanProducer(settings);
 if (!p.enabled) return request;
 const style = request.style.replace(/(?:^|\n\n)Song direction:\n[\s\S]*$/, '').trim();
 return { ...request, style: `${style}\n\nSong direction:\n${producerDirection(p)}`.trim(),
  lyrics: p.presence === 0 ? '' : request.lyrics,
  duration: request.duration === 0 ? estimatedDuration(p, request.lyrics || '') : request.duration };
}
export function lyricWarnings(p: ProducerSettings, lyrics: string): string[] {
 if (!p.enabled) return [];
 if (p.presence === 0) return lyrics.trim() ? ['Instrumental mode omits lyrics from this render; your editor text is preserved.'] : [];
 if (!lyrics.trim()) return ['Add lyrics for the requested vocal performance.'];
 const lines = lyrics.replace(/\[[^\]]*\]/g, '').split(/\n/).filter(s => s.trim());
 const dense = lines.filter(s => s.trim().split(/\s+/).length > (p.singing >= 70 ? 14 : 24)).length;
 return [! /\[(verse|chorus|hook)/i.test(lyrics) ? 'Section labels would help connect these lyrics to the arrangement.' : '',
  dense ? `${dense} long lyric line${dense > 1 ? 's' : ''}: review phrasing and breathing space.` : ''].filter(Boolean);
}
