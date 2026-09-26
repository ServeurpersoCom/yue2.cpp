import { parse } from 'yaml';

const sources = import.meta.glob('../../../../lyric_styles/*.yaml', {
	query: '?raw', import: 'default', eager: true
}) as Record<string, string>;

const markdownSources = import.meta.glob('../../../../lyric_styles/hiphop_30/*.md', {
	query: '?raw', import: 'default', eager: true
}) as Record<string, string>;

export const LYRIC_PACK_STYLES = Object.entries(markdownSources).map(([path, instructions]) => {
	const filename = path.split('/').pop()!.replace(/\.md$/, '');
	const name = instructions.match(/^#\s+(.+)$/m)?.[1].trim() || filename;
	const description = instructions.match(/## Purpose\s+([^\r\n]+)/)?.[1].trim() || '';
	return { id: `pack_${filename}`, name, description, instructions: instructions.trim() };
}).sort((a, b) => a.id.localeCompare(b.id));

export const LEGACY_LYRIC_CHOICES = [
	['rapid_fire', 'Rapid-Fire Momentum'], ['syllable_dense', 'Technical Rhyme Architecture'], ['chilled_conversational', 'Chilled Conversational Flow'],
	['punchline', 'Bar-Heavy Punchline Craft'], ['cinematic_story', 'Cinematic Storytelling'], ['melodic_emotional', 'Melodic Emotional Anchors'],
	['raw_direct', 'Raw Direct Precision'], ['abstract_psychedelic', 'Abstract Dream Logic'], ['minimalist_space', 'Minimal Space-Driven Writing'], ['progressive_switching', 'Progressive Flow Switching']
] as const;
export const LYRIC_STYLE_CHOICES: ReadonlyArray<readonly [string, string]> = [
	...LYRIC_PACK_STYLES.map(style => [style.id, style.name] as const), ...LEGACY_LYRIC_CHOICES
];

export function lyricStyleInstructions(id: string): string {
	const profile = LYRIC_PACK_STYLES.find(style => style.id === id);
	if (profile) return profile.instructions;
	for (const [path, text] of Object.entries(sources)) {
		if (path.endsWith('00_STYLE_INDEX.yaml')) continue;
		const data = parse(text);
		if (data?.style?.id !== id) continue;
		for (const section of ['identity', 'rhythm', 'rhyme', 'language', 'delivery', 'composition',
			'storytelling', 'technical_rules', 'anti_patterns', 'generation_guidance', 'adaptation', 'metrics']) {
			if (!data[section]) throw new Error(`Invalid lyric engine ${id}: missing ${section}`);
		}
		return JSON.stringify(data);
	}
	throw new Error(`Lyric engine not found: ${id}`);
}
