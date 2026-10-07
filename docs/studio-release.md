# Studio implementation and release — 27 September 2026

This is the current operations guide. `app-audit-2026-09-27.md` records the original findings; the older roadmap documents are historical.

## Implemented

| Audit items | Delivery |
| --- | --- |
| 1–6 | Validated settings/backups, audio-first saving, durable server results, per-job browser recovery, cross-tab ownership, transactional song updates. |
| 7–9 | Owned video cancellation; artwork stop-waiting/reconnect; persistent job IDs; media revisions reject stale completions and invalidate old MP4s/waveforms. |
| 10 | Bounded native queue for music/transcription/video/vocals; GPU admission gate for native jobs, Comfy submissions and Ollama; cancellable subprocesses with 30-minute deadline; dependency checks. |
| 11–12 | Named full Studio presets plus style blends in `saved_presets`; separate request-file export; atomic rename, interrupted-write recovery and cross-tab refresh. |
| 13 | Server job/stage/queue status, measured stage progress and persisted planned takes. ETA remains unavailable for stages without sufficient measurements. |
| 14–16 | Central navigation; single active rail; visible audio errors; lazy/shared decoding, 96 MiB decode cache and 12-card pages; disk-backed completed results; 256 MiB MP4 output cap. Recovery admission stops above 16 GiB or below 512 MiB free disk without deleting unacknowledged results. |
| 17 | Integrated YouTube launch/status/reconnect and local metadata drafts. **User deferred the upload check. Nothing uploaded or published.** Playlist and publishing remain user actions. Signed-in acceptance is incomplete. |
| 18 | Persisted album queue, reload/resume, stage retry, master/reference artwork, per-track video and album/backup ZIP export. |
| 19 | Real media acceptance recorded below; model quality is reviewed separately from successful execution. |
| 20 | Persistent test scripts, frontend CI, build/deployment wrappers and this guide. Commit/PR status is reported with the release. |

## Build and deploy on this Windows installation

Prerequisites: Visual Studio C++ build tools, CMake, CUDA toolkit, Node, FFmpeg on PATH, installed YuE2/VAE/SheetSage model files. Existing configured build directory is reused.

```powershell
cd tools/webui
npm ci
npm run check
npm run build
cd ../..
node tools/build-studio.mjs
node tools/activate-studio.mjs
```

For a fresh CUDA configuration, initialize the ggml submodule and run `cmake -S . -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=89` before building on the RTX 4060. Use the architecture appropriate to other hardware.

The build writes `build/Release-producer`. Activation refuses active native jobs, backs up the previous binaries under `build/backup-before-producer-*`, stops the matching server, deploys into `build/Release-reference`, starts hidden on 8087 and checks health. On startup failure it restores the backup. The Node wrapper normalizes Windows environment-key casing before calling PowerShell.

Use `GET /health`, `/jobs` and `/capabilities` for readiness. Logs are `build/producer-server.err.log` and `.out.log`. A browser refresh loads the embedded UI. The browser library is IndexedDB tied to the browser profile and origin; keep using the same `http://localhost:8087` origin.

## Optional services

- ComfyUI: managed Pinokio app `inteliweb-comfyui`, loopback 8188. Qwen Image 2.1 Q4_K_M, Qwen3-VL 8B INT8 and matching VAE are required. Use Pinokio/pterm for its lifecycle.
- Some GGUF loader versions do not recognize metadata-free Qwen 2.1 files. `node tools/repair-comfy-gguf.mjs <comfyui-gguf-reboot folder>` adds a narrowly matched architecture signature and keeps a `.before-yue2-qwen21` backup. Restart Comfy through Pinokio after this repair. It was needed on this installation.
- Ollama: loopback 11434; the browser uses the native `/ollama` bridge for resource coordination. Installed model selection is discovered, not hardcoded.
- Vocal separation: run `./setup-vocal-separation.ps1`. This creates isolated `.venv-vocal`, installs the separator and CUDA PyTorch, and checks the environment. The separation model downloads on first use into the OS temporary model directory. Restart Studio after setup so its PATH includes the environment.
- YouTube: `npm ci` in `tools/youtube-agent`. The integrated bridge opens a separate Chrome profile; it cannot attach to an ordinary signed-in Chrome window. The upload check is deferred at the user's request. Private profiles and run media are ignored by Git.

## Recovery and backup

- Completed audio is saved before optional art/video. If either optional stage fails, use the song card's reconnect/retry controls.
- Stopping artwork waiting preserves the Comfy prompt ID; it does not interrupt another application's GPU job.
- On native restart, completed results remain retrievable; in-flight native computation is marked interrupted and must be retried.
- Do not remove `job_results` before confirming library backups. Unacknowledged results are retained. Acknowledged results expire after 30 days.
- Library backup includes songs, current settings, disk presets and album plans/covers. Restore validates before mutation, downloads a before-restore ZIP and merges conflicting preset names safely. Album song IDs are remapped after restore.
- Album Pause finishes and saves the current stage. Resume skips saved stages and reuses persisted server/Comfy IDs.

## Acceptance evidence

Persistent commands:

```powershell
node --experimental-strip-types --test tools/webui/tests/*.test.mjs
node tests/studio-interactions.mjs
node tests/workflow-browser.mjs
node tools/webui/tests/storage-browser.mjs
node tests/media-queue.mjs
node tests/recovery-http.mjs
```

The browser suites use disposable contexts and mocked service responses. They do not upload to YouTube or modify the user's browser library.

- 24 unit tests passed, including original/master pairing, remix identity, input validation and backup validation.
- 245 controls inventoried/focused; keyboard dialogs/menus, save/load, playback, export, failures, mobile layout and reduced motion passed.
- Quota failure, malformed settings, two-tab submission, audio-first saving, failed favourite rollback and no deleted-track resurrection passed.
- Two-track album reload/resume reused the first job ID and created two tracks. A 122-track library mounted 12 cards with zero eager audio decodes when peaks existed. Measured JavaScript used heap was about 10 MB for this short-audio fixture; this does not measure total browser Blob/native audio memory for long tracks.
- Native async MP4, idempotent retry, cancellation, interrupted preset recovery and atomic rename passed.
- RTX 4060 Laptop 8 GiB: two 12-second real takes plus originals completed in about 16.2 seconds. WAV: 48 kHz stereo, 24-bit. Streaming master measured −15.93 LUFS and −1.54 dBTP on the short sample; the profile target is not a promise of an exact measured value for every clip.
- Actual Qwen cover generation passed, about 152 seconds at 1024 square. The first reference result copied the scene too closely. Increasing reference guidance to 4 produced a distinct rooftop/drum-machine scene with the same amber/purple palette; visual review passed (506 seconds).
- Six-minute MP4 acceptance passed: H.264 1920×1080 + AAC, 360-second video/audio duration, idempotent retry and cancellation. The check found and fixed FFmpeg lookahead leaving a silent tail at 1 fps; exports now use the decoded audio duration explicitly.
- Real Tiger-Gemma lyric generation passed through the native Ollama bridge on CPU in 22 seconds. Ollama's CUDA runner failed initialization on this installation; the lyric assistant now retries that failure once on CPU with a visible notice. Existing lyrics remain intact on errors, and models unload after completion.
- Dependency audit fixes stayed within the declared compatible ranges; npm reports zero vulnerabilities after 11 package updates. Svelte checks remained at zero errors/warnings.
- Real generated artwork and music were combined into `build/media-acceptance/hiphop-circuit-test.mp4`. Artifacts, raw measurements and subsequent checks remain under ignored `build/media-acceptance`.
- Real GPU vocal separation and +3 dB remix passed in 12.2 seconds after fixing Windows argv quoting and resampling before sample-accurate trimming. The output retained the source sample count and rate. Model weights are now cached locally.
- Reference and vocal evidence are recorded in `followup.json`; execution success does not establish subjective vocal quality, lyric intelligibility or every requested voice characteristic.

Do not treat the mocked browser tests as signed-in YouTube acceptance, or the short media fixture as a full-duration quality guarantee.
