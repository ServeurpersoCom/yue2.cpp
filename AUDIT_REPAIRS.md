> Current implementation, acceptance evidence and build/recovery instructions: [Studio release guide]( docs/studio-release.md ). This document records earlier planning or audit findings.

# Audit repair status

## Implemented

- Atomic browser-library job saves; recovery is cleared after commit, retry saves are deduplicated by source job.
- MP3 default 320 kbps; returned job format determines song metadata.
- Installed Ollama model discovery, lyric draft review, cancellation/timeout, unload request after inference.
- Complete YAML lyric engines loaded into prompts; malformed inline YAML fixed.
- Separate music and lyric mixers with angular, keyboard and numeric 0–100 controls.
- Zero influence excludes a style; removal updates the music prompt. Music descriptions are included in that prompt.
- Active blends persist across reloads. Manually edited/imported music prompts invalidate stale music rings.
- Separate saved music/lyric blends: save, load, explicit update, rename, confirmed delete. Legacy music favourites remain intact and are imported when no new-format favourites exist.
- Auto-duration explicitly submits zero; ordinary saved/imported durations are preserved.
- At most four pending native jobs (including the executing job); excess submissions return HTTP 429.
- Generation request cap 1 MiB; steps 1–200, duration 0–600 seconds, CFG -1–30, peak clip 0–999, supported MPEG bitrates only.
- Worker catches C++ exceptions and marks affected jobs failed; queued cancellation avoids model work. This cannot recover from native assertions, access violations or driver failures.
- Localhost server default and launcher binding. Explicit --host remains available for deliberate LAN use; no authentication layer added.

## Verification

From tools/webui: `npm run check`, `node --test tests/repair-regression.test.mjs`, `npm run build`.

Native release candidate: `build/audit-repair/yue-server.exe` plus its sibling DLLs. Build target yue-server with MSBuild OutDir set to that directory.

From repository root: `node tests/server-smoke.mjs` starts a separate CPU-only server on port 18087, checks defaults and rejected requests, then stops only its own child. The test does not generate music.

## Deployment and remaining work

### Track artwork viewer

Deployed 2026-09-23 with explicit restart approval; previous binaries: build/backup-before-artwork-viewer-20260923-122024. Songs now support an optional artwork Blob in IndexedDB. The track menu offers Add/Replace artwork (PNG/JPEG/WebP, max 20 MB and 64 MP); validation and saving finish before the existing artwork changes. Art displays as a square beside the track with a separate playback button. Clicking it opens a native modal with thumbnail-to-image Web Animations morph, reverse close, keyboard Escape/focus restoration, scroll lock, full-image download and reduced-motion support. Blob URLs are revoked on cleanup. Automatic artwork generation is still not connected; a future generator should attach its resulting image Blob to Song.artwork and save the track.

Verified: six regression tests, clean frontend checks, production/native builds, isolated desktop/mobile browser upload-and-reload persistence, active morph animation, Escape/close button, focus and scroll restoration, reduced-motion behavior, screenshots and live embedded-UI markers. GPU-backed native server starts with the existing 320 kbps default. No user library data was used in browser tests.

### Modern studio UI

Deployed 2026-09-23 after a second explicit restart approval. Previous binaries: build/backup-before-modern-ui-20260923-112727. Modern theme-aware surfaces, decorative waveform animation, responsive header, section shortcuts, record-sleeve empty state, library search and favourite filtering. Motion respects prefers-reduced-motion; the activity indicator now reflects actual log connectivity. No remote assets or new dependencies.

Verification: Svelte check has no errors/warnings; five existing regression tests pass; production/native builds and temporary-server smoke checks pass. `node tests/studio-browser.mjs` from tools/webui tested all five themes, desktop/mobile overflow, ring add/remove and keyboard controls, render navigation, reduced motion, library search and favourites, with no runtime exceptions. Isolated-profile screenshots: build/ui-review. Live port 8087 serves the new UI with the 320 kbps default and CUDA initialization intact.

Deployed on 2026-09-23 after the user confirmed tracks were saved and approved restarting. Candidate executable and four GGML DLLs were copied into build/Release. Previous binaries are retained in build/backup-before-audit-20260923-110222. The existing music launcher continues to use build/Release through server.cmd.

Live verification: health OK on localhost:8087, MP3 default 320 kbps, native 48 kHz, Q8_0 backbone and F32 YuE2 VAE unchanged, CUDA0 initialization successful, updated embedded UI present, all five deployed binary hashes match the tested candidate. No new song was generated during deployment.

Not yet verified: interactive browser pointer/keyboard/favourite workflows, song-generation quality, actual Ollama lyric generation on installed models, VRAM recovery under load, admission-limit stress or worker-failure injection.

Still pending: durable server-side song recovery, broader library backup, full pipeline/plugin architecture, mastering, album/artwork/MP4 processing, all end-to-end audio scenarios. The existing album/artwork controls remain placeholders. Browser-only concurrency guards do not coordinate separate tabs or applications.
