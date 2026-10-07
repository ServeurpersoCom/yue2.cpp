const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;

// 1920x1080 fallback cover in the card's deterministic gradient style, so
// MP4 delivery never dead-ends on a track without artwork.
export async function fallbackCover(name: string, seed: number): Promise<Blob> {
	const hue = (((seed * 47) % 360) + 360) % 360;
	const canvas = document.createElement('canvas');
	canvas.width = 1920;
	canvas.height = 1080;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not rasterize a cover image.');
	const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
	gradient.addColorStop(0, `hsl(${hue} 65% 42%)`);
	gradient.addColorStop(1, `hsl(${(hue + 50) % 360} 70% 26%)`);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 1920, 1080);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
	ctx.font = '700 96px Inter, system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const words = (name || 'Untitled track').split(/\s+/);
	const lines: string[] = [];
	for (const word of words) {
		const last = lines[lines.length - 1];
		if (last && `${last} ${word}`.length <= 24 && lines.length < 3) lines[lines.length - 1] = `${last} ${word}`;
		else if (lines.length < 3) lines.push(word);
	}
	lines.forEach((line, i) => ctx.fillText(line, 960, 540 + (i - (lines.length - 1) / 2) * 120));
	return new Promise((resolve, reject) =>
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not rasterize a cover image.'))), 'image/png')
	);
}

export async function validateArtwork(file: Blob): Promise<void> {
	if (!TYPES.has(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
	if (!file.size || file.size > MAX_ARTWORK_BYTES) throw new Error('Artwork must be between 1 byte and 20 MB.');
	const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be decoded. Existing artwork is unchanged.'); });
	try {
		if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64_000_000) {
			throw new Error('Artwork must be no larger than 64 megapixels.');
		}
	} finally { bitmap.close(); }
}
