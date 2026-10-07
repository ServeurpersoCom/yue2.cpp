export const activity = $state({ running: false, stage: 'Ready', percent: null as number | null, eta: null as number | null, detail: '' });
export function activityStage(stage: string, detail = '') {
	activity.stage = stage; activity.detail = detail; activity.percent = null; activity.eta = null;
}
export function updateActivity(line: string) {
	if (!activity.running || ['Creating artwork', 'Rendering MP4'].includes(activity.stage)) return;
	const step = line.match(/\[NAR\] Step (\d+)\/(\d+), ([\d.]+) ms/);
	if (step) {
		const [, done, total, ms] = step.map(Number);
		activity.stage = 'Rendering audio';
		activity.percent = Math.min(100, done / total * 100);
		activity.eta = Math.max(0, (total - done) * ms / 1000);
		activity.detail = `Current chunk · step ${done} of ${total}`;
	} else if (/\[AR\]/.test(line)) {
		activityStage('Composing music', 'Writing the score and musical tokens');
		const tokens = line.match(/\[AR\] (.+?) (\d+)\/(\d+)$/);
		if (tokens) activity.detail = `${tokens[1]} · ${tokens[2]} / ${tokens[3]} token budget`;
	} else if (/\[VAE\]/.test(line)) activityStage('Decoding audio', 'Turning the generated sound into audio');
	else if (/\[MP3\] Encoding/.test(line)) activityStage('Encoding audio', 'Preparing the audio file');
	else if (/\[NAR\] (Song|Graph|Solved)/.test(line)) activityStage('Rendering audio', 'Preparing the next audio chunk');
}

export function logTone(line: string): string {
	if (/fatal|error|failed|unavailable/i.test(line)) return 'error';
	if (/warn|cancel|clamp/i.test(line)) return 'warning';
	if (/\bdone\b|listening|solved|loaded|created/i.test(line)) return 'success';
	if (/\[AR\]|\[BPE\]/.test(line)) return 'compose';
	if (/\[NAR\]/.test(line)) return 'render';
	if (/\[VAE\]|\[MP3\]|\[WAV\]/.test(line)) return 'audio';
	return 'info';
}
