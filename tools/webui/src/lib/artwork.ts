const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;

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
