export interface YouTubeDraft {
	version: 1;
	title: string;
	description: string;
	tags: string;
	audience: 'review' | 'kids' | 'general';
	playlist: string;
	endScreen: string;
	visibility: 'private' | 'unlisted' | 'public';
}

export function downloadYouTubeFile(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
