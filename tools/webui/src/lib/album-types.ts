import type { Yue2Request } from './types.js';

export interface AlbumTrack {
	id: string;
	title: string;
	lyrics: string;
	artDirection: string;
	jobId?: string;
	songId?: number;
	artJobId?: string;
	videoJobId?: string;
	artDone?: boolean;
	videoDone?: boolean;
}
export interface ArtModels { diffusion: string; encoder: string; vae: string }
export interface Album {
	id: string;
	version: 1;
	title: string;
	created: number;
	updated: number;
	request: Yue2Request;
	visualStyle: string;
	artwork: boolean;
	video: boolean;
	seed: number;
	models?: ArtModels;
	cover?: Blob;
	coverJobId?: string;
	referenceName?: string;
	tracks: AlbumTrack[];
	status: 'draft' | 'running' | 'paused' | 'complete';
	stage: string;
	error?: string;
}
