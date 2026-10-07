import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { validateDraft } from './draft.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  draft: { type: 'string' }, video: { type: 'string' }, thumbnail: { type: 'string' },
  channel: { type: 'string', default: 'msedge' }, 'validate-only': { type: 'boolean' }
} });
if (!values.draft || !values.video) {
  console.error('Usage: npm start -- --draft draft.json --video video.mp4 [--thumbnail cover.png] [--validate-only]');
  process.exit(1);
}
const draft = validateDraft(JSON.parse(await readFile(resolve(values.draft), 'utf8')));
const video = resolve(values.video);
if (extname(video).toLowerCase() !== '.mp4' || !(await stat(video)).isFile() || !(await stat(video)).size) throw new Error('Choose a nonempty MP4 file.');
const thumbnail = values.thumbnail && resolve(values.thumbnail);
if (thumbnail && (!['.png', '.jpg', '.jpeg', '.webp'].includes(extname(thumbnail).toLowerCase()) || !(await stat(thumbnail)).isFile())) throw new Error('Choose a PNG, JPEG or WebP thumbnail.');
if (values['validate-only']) { console.log('Draft and input files validated; no browser opened.'); process.exit(0); }
if (!process.stdin.isTTY) throw new Error('Run this agent in an interactive terminal for Studio review.');

const runDir = resolve(root, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(runDir, { recursive: true });
const state = { title: draft.title, video, status: 'starting', steps: [], studioUrl: '', error: '' };
const record = async (step) => { state.steps.push({ step, at: new Date().toISOString() }); await writeFile(resolve(runDir, 'status.json'), JSON.stringify(state, null, 2)); };
const terminal = createInterface({ input: process.stdin, output: process.stdout });
let context;
let page;
async function review(message, word = 'DONE') {
  console.log(`\n${message}`);
  while (true) {
    const answer = (await terminal.question(`Type ${word} to continue, or STOP to end: `)).trim();
    if (answer === word) return;
    if (answer === 'STOP' || terminal.closed) throw new Error('Stopped by user.');
    console.log(`Enter exactly ${word}; press Ctrl+C to stop.`);
  }
}
// Aborting always closes the local agent; Studio may retain a draft already uploaded.
terminal.on('SIGINT', () => { terminal.close(); void context?.close(); process.exitCode = 130; });
try {
  context = await chromium.launchPersistentContext(resolve(root, 'profile'), { channel: values.channel, headless: false, viewport: null });
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });
  await review(`Sign in, select the intended channel, then open Create → Upload videos.\nVideo: ${video}\nTitle: ${draft.title}\nConfirm the channel before authorizing this upload.`, 'UPLOAD');
  const input = page.locator('input[type="file"][accept*="video"]');
  if (await input.count() !== 1) throw new Error('Could not uniquely identify the Studio video picker. Open Upload videos and retry only after checking for an existing upload.');
  await input.setInputFiles(video);
  state.status = 'upload-started';
  await record('Video handed to Studio; processing and saving are not yet verified.');
  const title = page.locator('ytcp-social-suggestions-textbox#title-textarea #textbox');
  const description = page.locator('ytcp-social-suggestions-textbox#description-textarea #textbox');
  await title.fill(draft.title);
  await description.fill(draft.description);
  if (await title.innerText() !== draft.title) throw new Error('Studio title did not match the draft.');
  await record('Title and description filled.');
  if (draft.audience !== 'review') {
    await page.getByRole('radio', { name: draft.audience === 'kids' ? /Yes, it.*made for kids/i : /No, it.*not made for kids/i }).click();
    await record('Audience selected; verify in Studio.');
  }
  if (thumbnail) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: /Upload (file|thumbnail)/i }).click()
    ]);
    await chooser.setFiles(thumbnail);
    await record('Thumbnail submitted; verify preview in Studio.');
  }
  if (draft.parsedTags.length) {
    await page.getByRole('button', { name: /show more/i }).click();
    const tags = page.locator('ytcp-form-input-container#tags-container input');
    await tags.fill(draft.parsedTags.join(','));
    await tags.press('Enter');
    await record('Tags entered; verify in Studio.');
  }
  state.status = 'awaiting-review';
  state.studioUrl = page.url();
  await record('Automatic steps finished; manual review required.');
  await review(`Review Details in Studio:\n• Title, description, tags and thumbnail preview\n• Audience: ${draft.audience}\n• Playlist: ${draft.playlist || 'No playlist requested'}\n• Language, category, AI/altered-content disclosure and other upload settings\nThen go to Video elements and apply the end screen: ${draft.endScreen || 'No end screen requested'}.\nMade-for-kids uploads may not offer end screens. Record any unavailable option yourself.\nComplete copyright/checks review and wait for video processing.\nIntended visibility: ${draft.visibility}. Choose visibility/scheduling and save or publish yourself.\nKeep the Studio tab open until it confirms saving.`, 'REVIEWED');
  state.status = 'user-reviewed';
  state.studioUrl = page.url();
  await record('User confirmed review. Publication has not been independently verified.');
  console.log(`Run record: ${runDir}`);
} catch (error) {
  state.status = 'needs-attention';
  state.error = error instanceof Error ? error.message : String(error);
  await record('Stopped; inspect Studio before retrying to avoid duplicate uploads.');
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(runDir, 'attention.png') }).catch(() => {});
  console.error(state.error);
  console.error(`Details: ${runDir}`);
  if (!terminal.closed && page && !page.isClosed()) await terminal.question('Inspect or finish the existing Studio draft. Press Enter when ready to close the browser.').catch(() => {});
  process.exitCode = 1;
} finally {
  terminal.close();
  await context?.close();
}
