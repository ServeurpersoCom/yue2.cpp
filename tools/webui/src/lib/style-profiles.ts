const profileFiles = import.meta.glob('../../../../music_styles/*.md', {
	query: '?raw', import: 'default', eager: true
}) as Record<string, string>;

const thumbnailFiles = import.meta.glob('../assets/style-thumbnails/*.webp', {
	query: '?url', import: 'default', eager: true
}) as Record<string, string>;

export interface MusicStyleProfile {
	id: string;
	name: string;
	family: string;
	profile: string;
	thumbnail: string;
	searchText: string;
}

export const HIP_HOP_STYLES: MusicStyleProfile[] = Object.entries(profileFiles)
	.map(([path, profile]) => {
		const filename = path.split('/').pop() || '';
		const id = filename.replace(/\.md$/i, '');
		const name = profile.match(/^#\s+(.+)$/m)?.[1]?.trim() || id;
		const family = profile.match(/^\*\*Family:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() || 'Hip-Hop';
		const thumbnailPath = `../assets/style-thumbnails/${id}.webp`;
		const searchText = `${name} ${family} ${profile}`.toLocaleLowerCase();
		return {
			id,
			name,
			family,
			profile: profile.trim(),
			thumbnail: thumbnailFiles[thumbnailPath] || '',
			searchText: `${searchText} ${searchText.replace(/[^a-z0-9]/g, '')}`
		};
	})
	.sort((a, b) => a.id.localeCompare(b.id));

export const MUSIC_STYLE_CHOICES = HIP_HOP_STYLES.map(({ id, name }) => [id, name] as const);
export const MUSIC_STYLE_DESCRIPTIONS = Object.fromEntries(
	HIP_HOP_STYLES.map(({ id, profile }) => [id, profile])
);
export const MUSIC_STYLE_BY_ID = Object.fromEntries(HIP_HOP_STYLES.map((style) => [style.id, style]));

export const FEATURED_HIP_HOP_STYLE_IDS = [
	'001_boom_bap', '003_underground_hip_hop', '004_lo_fi_hip_hop', '005_jazz_rap',
	'013_west_coast_hip_hop', '017_memphis_rap', '022_trap', '023_dark_trap',
	'030_drill', '032_uk_drill', '048_soul_hip_hop', '076_grimy_boom_bap'
] as const;
