import type { Yue2Request, Yue2Props } from './types.js';
import { FETCH_TIMEOUT_MS, JOB_POLL_MS } from './config.js';

// shared: submit a request and return the job ID
export class SubmissionRejected extends Error {}
async function submitJob(url: string, init: RequestInit): Promise<string> {
	const res = await fetch(url, init);
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		const ErrorType = [400,413,429,507].includes(res.status) ? SubmissionRejected : Error;
		throw new ErrorType(`${res.status} ${err.error || res.statusText}`);
	}
	const data = await res.json();
	return data.id;
}

// POST /synth: submit the full pipeline request, returns job ID.
// format fills output_format so the UI selector drives the encoding.
export function synthSubmit(req: Yue2Request, format: string, id?: string): Promise<string> {
	return submitJob('synth', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(id ? {'X-Yue2-Job-Id':id} : {}) },
		body: JSON.stringify({ ...req, output_format: format })
	});
}

// POST /transcribe (multipart): submit a recording, returns job ID. The
// melody_only field drops the chord symbols from the score.
export function transcribeSubmit(audio: Blob, melodyOnly: boolean): Promise<string> {
	const form = new FormData();
	form.append('audio', audio, 'input.audio');
	if (melodyOnly) {
		form.append('melody_only', '1');
	}
	return submitJob('transcribe', { method: 'POST', body: form });
}

// POST /vocal-balance: separate a mix locally, adjust the vocal stem and
// return a remixed WAV. The caller retains the uploaded original for A/B.
async function mediaJob(path:string, form:FormData, signal?:AbortSignal, existingId?:string, submitted?:(id:string)=>Promise<void>): Promise<Response> {
 signal?.throwIfAborted();
 const id = existingId ?? crypto.randomUUID().replaceAll('-','');
 if (!existingId) {
  // Save the client ID before submitting, so a lost response can be retried.
  await submitted?.(id);
 }
 await submitJob(path,{method:'POST',headers:{'X-Yue2-Job-Id':id},body:form});
 const cancel = () => { void cancelJob(id); };
 signal?.addEventListener('abort',cancel,{once:true});
 try {
  if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
  await pollJob(id,signal);
  const response=await fetch(`job?id=${id}&result=1`,{signal});
  if (!response.ok) throw new Error('Media result could not be retrieved. Reconnect to retry.');
  return response;
 } finally { signal?.removeEventListener('abort',cancel); }
}
export async function balanceVocalLevel(audio:Blob,gainDb:number|null,signal?:AbortSignal):Promise<{audio:Blob;gainDb:number;jobId?:string}> {
 const form=new FormData();form.append('audio',audio,'song.wav');form.append('vocal_gain_db',gainDb==null?'auto':String(gainDb));
 let jobId:string|undefined;
 const response=await mediaJob('vocal-balance',form,signal,undefined,async id=>{jobId=id;});
 const gain=Number(response.headers.get('Content-Type')?.match(/gain=([-\d.]+)/)?.[1]);
 if(!Number.isFinite(gain))throw new Error('Server did not report vocal gain.');
 return {audio:await response.blob(),gainDb:gain,jobId};
}
export async function renderVideo(audio:Blob,cover:Blob,signal?:AbortSignal,existingId?:string,submitted?:(id:string)=>Promise<void>):Promise<Blob> {
 const form=new FormData();form.append('audio',audio,audio.type.includes('mpeg')?'song.mp3':'song.wav');
 form.append('cover',cover,cover.type==='image/jpeg'?'cover.jpg':cover.type==='image/webp'?'cover.webp':'cover.png');
 return (await mediaJob('render-video',form,signal,existingId,submitted)).blob();
}

// GET /job?id=X&result=1: fetch a transcribe result, the score it heard.
export async function jobResultTranscribe(id: string): Promise<{ abc: string }> {
	const res = await fetch(`job?id=${encodeURIComponent(id)}&result=1`);
	if (!res.ok) throw new Error(`${res.status} Result not ready`);
	return res.json();
}

// GET /job?id=X: poll job status
export class JobTerminalError extends Error {}
export async function jobStatus(id: string): Promise<string> {
	const res = await fetch(`job?id=${encodeURIComponent(id)}`, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (res.status === 404) throw new JobTerminalError('Job no longer exists on the server');
	if (!res.ok) throw new Error(`${res.status} Job status unavailable`);
	const data = await res.json();
	if (data.status === 'failed') {
        const result=await fetch(`job?id=${encodeURIComponent(id)}&result=1`,{signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
        const detail=await result.json().catch(()=>({error:'Processing failed. Check Studio activity.'}));
        throw new JobTerminalError(detail.error||'Processing failed. Check Studio activity.');
    }
	if (data.status === 'done' && data.durable === false) window.dispatchEvent(new CustomEvent('yue2-recovery-warning', {detail:'The server could not archive this result to disk. Keep this tab open until its audio is saved to your library.'}));
	return data.status;
}

// poll until done, throws on failure or cancel.
// no timeout: long jobs (several minutes of music) can take a while.
// the user cancels via the Cancel button if needed.
// retries on network errors (TypeError) and timeouts (DOMException).
// propagates HTTP errors (404 = job evicted, server restarted).
export async function pollJob(id: string, signal?: AbortSignal): Promise<void> {
	for (;;) {
		signal?.throwIfAborted();
		try {
			const status = await jobStatus(id);
			if (status === 'done') return;
			if (status === 'failed') throw new JobTerminalError('Generation failed');
			if (status === 'cancelled') throw new JobTerminalError('Cancelled');
			if (status === 'interrupted') throw new JobTerminalError('The server restarted before this job finished. Saved tracks are safe; start a new generation to retry.');
		} catch (e) {
			if (e instanceof TypeError || e instanceof DOMException) {
				// network down or timeout: retry next cycle
			} else {
				throw e;
			}
		}
		await new Promise((r) => setTimeout(r, JOB_POLL_MS));
	}
}

// GET /job?id=X&result=1: fetch the WAV result
// GET /job?id=X&result=1: fetch job result. Batch jobs reply
// multipart/mixed with one audio part per track in song-major order;
// single-track jobs reply with the raw audio body.
// One rendered track: its audio and the replay request the server pairs
// with it (semantic_tokens + exact seed, replays the track deterministically)
export interface JobTrack {
	request: Yue2Request;
	audio: Blob;
}

// GET /job?id=X&result=1: the finished tracks of a job. The response is
// multipart/mixed, one JSON replay request part then one audio part per
// track, in song-major order.
export async function jobResultTracks(id: string): Promise<JobTrack[]> {
	const res = await fetch(`job?id=${encodeURIComponent(id)}&result=1`);
	if (!res.ok) throw new Error(`${res.status} Result not ready`);
	const ct = res.headers.get('Content-Type') || '';
	const match = ct.match(/boundary=([^\s;]+)/);
	if (!match) throw new Error('Missing boundary in multipart response');
	const parts = parseMultipartParts(new Uint8Array(await res.arrayBuffer()), match[1]);

	const tracks: JobTrack[] = [];
	let pending: Yue2Request | null = null;
	for (const part of parts) {
		if (part.type === 'application/json') {
			pending = JSON.parse(await part.text()) as Yue2Request;
		} else if (pending) {
			tracks.push({ request: pending, audio: part });
			pending = null;
		}
	}
	return tracks;
}

// Split a multipart/mixed body on its boundary and return one Blob per
// part, typed by the part's own Content-Type header.
function parseMultipartParts(buf: Uint8Array, boundary: string): Blob[] {
	const enc = new TextEncoder();
	const delim = enc.encode('--' + boundary);
	const dec = new TextDecoder();
	const results: Blob[] = [];

	// find all boundary positions
	const positions: number[] = [];
	for (let i = 0; i <= buf.length - delim.length; i++) {
		let ok = true;
		for (let j = 0; j < delim.length; j++) {
			if (buf[i + j] !== delim[j]) {
				ok = false;
				break;
			}
		}
		if (ok) positions.push(i);
	}

	for (let p = 0; p < positions.length - 1; p++) {
		const partStart = positions[p] + delim.length + 2;
		const partEnd = positions[p + 1] - 2;
		if (partStart >= partEnd) continue;

		// split headers from body at \r\n\r\n
		let splitAt = -1;
		for (let i = partStart; i < partEnd - 3; i++) {
			if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
				splitAt = i;
				break;
			}
		}
		if (splitAt < 0) continue;

		// scan headers for Content-Type. Headers are CRLF-separated ASCII.
		const headerText = dec.decode(buf.slice(partStart, splitAt));
		let contentType = 'application/octet-stream';
		for (const line of headerText.split(/\r\n/)) {
			const m = line.match(/^Content-Type:\s*(.+)$/i);
			if (m) {
				contentType = m[1].trim();
				break;
			}
		}

		const body = buf.slice(splitAt + 4, partEnd);
		results.push(new Blob([body], { type: contentType }));
	}

	return results;
}

// POST /job?id=X&cancel=1: cancel a specific job
export async function cancelJob(id: string): Promise<void> {
	await fetch(`job?id=${encodeURIComponent(id)}&cancel=1`, { method: 'POST' });
}

// GET /props: server config (2s timeout)
export async function props(): Promise<Yue2Props> {
	const res = await fetch('props', {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.json();
}
