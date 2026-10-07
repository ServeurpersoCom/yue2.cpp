> Current implementation, acceptance evidence and build/recovery instructions: [Studio release guide]( docs/studio-release.md ). This document records earlier planning or audit findings.

# YuE2 Studio - project update and resume plan

Updated: 2026-09-23. Work parked at the user's request; no background upgrade or restart scheduled.

## Project identity and safety

- Correct project: `C:\Users\mrmul\yue2.cpp`, NOT Maestro.
- PowerShell `music` launches `server.cmd`, then `build/Release/yue-server.exe`; UI is served on localhost:8087.
- Native C++/GGML generation with embedded Svelte UI. Preserve the working YuE2 Q8_0 model, compatible native F32 VAE, and 48 kHz audio path.
- The worktree contains substantial existing modifications and untracked features. Do not reset, clean, or overwrite them.
- No huge model downloads, security-policy weakening, or unrelated app updates without explicit approval.
- Before a future YuE2 deployment, ask the user to save new tracks and approve restarting: server-only results can be lost. Previous approvals were for previous deployments.

## Current status: distinguish deployed from draft

### Previously deployed and tested

- Modern studio UI and five themes; separate music and lyric blend controls and saved favourites.
- Ollama integration and structured lyric-style engines (real model output quality still needs end-to-end evaluation).
- MP3 default 320 kbps, existing WAV options, request validation and job persistence repairs.
- Uploaded artwork attached to songs: square thumbnail, expanding modal/morph, image download, keyboard and reduced-motion support.
- See `AUDIT_REPAIRS.md` for historical test/deployment evidence and limitations. Those passes do not validate the new album work.

### Draft source only: not complete, tested, or deployed

- `tools/webui/src/lib/album-types.ts`: album/track state and persisted job IDs.
- `tools/webui/src/lib/album-db.ts`: separate IndexedDB album storage.
- `tools/webui/src/lib/album-plan.ts`: lyric imports, request snapshots, shared art direction and per-track seeds.
- `tools/webui/src/lib/comfy-art.ts`: proposed Qwen 2.1 graph, readiness, submission, polling and reference upload.
- `tools/comfy-api.h`: restricted loopback ComfyUI API bridge; wired into `tools/yue-server.cpp` with a configurable Comfy port.
- Song type extensions and Vite proxy changes support future album/art/video integration.
- `pinokio_agent/skills/api/inteliweb-comfyui/SKILL.md`: reusable Comfy API notes.
- Album runner, real album UI, MP4 encoding, and end-to-end artwork generation are unfinished. Existing album controls must not be presented as functioning features yet.

## Immediate blocker: ComfyUI upgrade

Managed installation: `C:\pinokio\api\inteliweb-comfyui\app` (Pinokio app `inteliweb-comfyui`, last ready endpoint localhost:8188). Rediscover/probe via the Pinokio skill on return rather than assuming it is running.

User approved installing a compatible GGUF loader through its manager, restarting ComfyUI if necessary, and upgrading its core through the manager with a backup. This does not authorize changing network/security policies or downloading large weights.

- Installed/running core remained **0.34.0**, revision `f938505952476e48a12687eac696cdc94d48a3fe`.
- Manager snapshot and backup completed successfully.
- Manager update was accepted but then failed: `Failed to fetch ComfyUI` / `ComfyUI update failed`.
- Elevated read-only GitHub Git probe also timed out connecting to `github.com:443` after about 21 seconds. GitHub's API endpoint was reachable; this is not proof Git transport works.
- No restart, DNS/proxy changes, remote changes, or security bypass was performed. YuE2 health remained OK.

### Backup

`build/comfy-backup-20260923-130946/`

- `comfy-core.bundle`: original source revision, NOT a full Python environment backup.
- `manager-snapshot.json`: core/custom-node revisions and installed dependency versions.
- `user/`: user settings/workflows/manager state.
- `requirements.txt` and `RESTORE-NOTES.md`.

Keep this backup. Prefer manager-supported snapshot recovery if needed; do not blindly reset repositories or overwrite newer user workflows.

### Resume checklist: GitHub and compatible core

1. Read this plan, `AUDIT_REPAIRS.md`, and the Pinokio skill. Inspect current changes and confirm both apps' identities/status.
2. Check whether GitHub Git connectivity has recovered. If still failing, diagnose read-only first; ask before network configuration changes or using a different installation method.
3. Confirm ComfyUI's image queue and manager queue are idle. Refresh the backup if user state changed since this snapshot.
4. Retry the core update through the supported manager; inspect worker logs, not just HTTP 200. Select a supported release containing native Qwen Image 2.1 support; recheck current compatibility rather than hard-coding a stale release.
5. Check dependency installation and restart ComfyUI via its supported managed lifecycle. Verify `/system_stats`, `/object_info`, and startup errors.
6. Require `TextEncodeQwenImage21` and the correct 2.1 model implementation. Older Qwen Edit nodes are not substitutes.
7. Install a genuinely compatible GGUF loader through the manager. Prior inspection found the model-recommended leejet fork supports the architecture, while the inspected city96 loader did not. Reverify upstream state. If the required fork is blocked by the manager's custom-URL policy, ask for direction; do not disable that protection or bypass it with a clone.
8. Confirm all installed model dropdowns, validate a minimal graph, and then run an explicitly identified artwork smoke test. Node presence alone is not an inference pass.

### Installed model files observed (recheck before use)

- `models/diffusion_models/qwen-image-2.1-Q4_K_M.gguf`
- `models/text_encoders/qwen3vl_8b_int8_convrot.safetensors`
- `models/vae/qwen_image_2.1_vae_bf16.safetensors`

The requested Heretic GGUF text encoder was NOT found. Do not claim it is in use. The proposed graph uses the installed compatible INT8 encoder, on CPU where supported. The machine has an RTX 4060 Laptop GPU with 8 GB VRAM and approximately 16 GB RAM; actual memory pressure and inference performance need measurement.

References to recheck:

- https://github.com/Comfy-Org/ComfyUI
- https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json
- https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json
- https://huggingface.co/abenzerps/Qwen-Image-2.1-Uncensored-GGUF

## Build milestones after compatibility is restored

### 1. Resumable album orchestration

- Upload multiple UTF-8 lyric files; editable titles, order and optional per-song art direction.
- Snapshot music settings; clear reused semantic tokens/score data; generate one song at a time.
- Persist stage and job IDs before polling; commit song data before advancing. Resume without regenerating already saved songs.
- Coordinate album/single-song runs and multiple tabs. Pause after the current item; never cancel another app user's Comfy work.
- Preserve completed music if optional artwork/video fails. Give explicit retry and audio-only choices.

### 2. Consistent but distinct artwork

- Generate one master album cover from shared art direction, palette, medium and lyrical themes.
- Reference the master cover for each track, with different lyric-derived subjects and seeds. Do not chain references through preceding tracks, which can drift.
- Store resulting image Blobs on albums/songs and reuse the deployed thumbnail/viewer.
- Stage work to reduce model competition: sequential songs, cover, per-song artwork, then optional video. Check queues before unloading models.
- Validate actual reference conditioning and image quality. Consistency is guidance, not a guarantee; offer preview/retry.
- Investigate current upstream Qwen 2.1 reference-latent issues before choosing canvas/reference settings.

### 3. Optional MP4 export

- Resolve FFmpeg through managed tool discovery/configuration (previously found under Pinokio's miniforge), not a hard-coded module path.
- Add a bounded asynchronous video job: track artwork plus audio, 1080p H.264/AAC with broadly compatible pixel format and fast-start metadata.
- Use safe subprocess argument handling, unique temporary paths, input limits, clear errors and deliberate cleanup.
- Preserve the original MP3/WAV and image. MP3 default remains 320 kbps; AAC video audio is a separate encode, not a lossless quality upgrade.
- Expose video availability and per-track download; do not show an enabled option without a functioning encoder.

### 4. Album UI and usability

- Replace placeholders with a collapsible Create Album workspace: track queue, shared visual direction, artwork toggle, optional MP4 toggle, readiness and progress.
- Saved albums/resume, cover preview, per-track audio/art/video status and understandable failures.
- Keep music style and lyric construction separate. Preserve existing themes, ring controls, favourites and generation workflows.
- Explain whether the browser must stay open during orchestration. Do not promise background processing until implemented and tested.

### 5. Verification and deployment gates

- Unit tests: import validation, request isolation, deterministic prompts/seeds, state transitions, retry/deduplication, persistence failures.
- Integration tests: missing Comfy/model/loader, failed/restarted job, concurrent work, pause/resume, malformed uploads, video failures, all optional features OFF.
- Real end-to-end test: at least two short songs, one master cover, two distinct reference-conditioned images, MP3 metadata and playable MP4s; inspect visual coherence, audio validity and peak memory.
- Re-run frontend checks/regressions, production/native builds, server smoke tests and isolated browser tests. Existing smoke tests do not prove music/image generation quality.
- Inspect mobile layout, keyboard/focus, reduced motion, theme contrast and image persistence after reload.
- Request fresh YuE2 restart approval; back up deployed binaries, deploy only the tested candidate, verify health/UI/model paths, and document exact results and remaining limitations.

Useful existing commands:

```text
# From tools/webui
npm run check
node --test tests/repair-regression.test.mjs
npm run build
node tests/studio-browser.mjs

# From repository root, after rebuilding the candidate
node tests/server-smoke.mjs
```

Build native candidate to `build/audit-repair`, leaving the running executable alone. On this Windows setup, normalize duplicate Path/PATH environment keys before invoking MSBuild. Read existing test harnesses before running: browser tests should use isolated profiles/fixtures, not user library data.

## Later roadmap (not delivered by the album work)

Re-audit the original enhancement specification before implementing: processor registry, model lifecycle manager, serializable configuration, safe decoder selection, genuine mastering DSP, optional restoration/separation/stem processing/RAVE/detail recovery/style-transfer adapters, A/B playback, and broader recovery/backup. Expose only controls backed by real implementations. Keep all enhancements optional and retain YuE2's compatible native decoder.

## Suggested resume instruction

"Resume YuE2 from PROJECT_BUILD_PLAN.md. Check GitHub connectivity, finish the approved manager-based ComfyUI compatibility upgrade with the backup preserved, then continue the tested album/artwork/MP4 milestones. Do not modify Maestro or restart YuE2 without fresh approval."

## Signal Studio update — 2026-09-24

Deployed on 2026-09-24 after explicit approval for this update. Live process at verification: PID 10876 on 127.0.0.1:8087.

- Canvas visualizer: ribbon, orbit and logarithmic spectrum views; actual playback analysis, bass/body/air meters, native-dialog expanded view, Escape/focus restoration, reduced-motion and offscreen rendering limits.
- Creation desk: numbered navigation, searchable preset chips and existing influence rings, separate lyric section, collapsible local lyric assistant and score editor, compact sampling controls and a production summary. Removed the unfinished album input placeholders from the active form.
- Automatic production uses conservative weighted score-temperature presets (0.65 rhythmic / 0.70 balanced / 0.75 expressive, relative to the model default). Semantic sampling, CFG, flow steps and normalization use the model defaults; MP3 is 320 kbps. Manual mode, explicit imported settings, replay codes, seeds, durations and batches are preserved. These presets are not empirically proven genre optima.
- Validation: Svelte check 0 errors/warnings; 8 regression tests; production build; isolated browser tests covering actual muted PCM playback, mode controls, mobile/themes, automatic/manual submitted request capture and reload persistence; native candidate build; temporary CPU server smoke pass. No song was generated to evaluate preset quality.
- Candidate: `build/audit-repair/yue-server.exe` (matching `Release/yue-server.exe` inside candidate).
- Screenshots: `build/ui-review/studio-mint.png`, `signal-live.png`, `signal-orbit.png`, `production-desk.png`, `studio-mobile.png`.
- Backup: `build/backup-before-signal-studio-20260924-202647/`. Only the executable changed during deployment; all four backend DLL hashes matched the tested candidate.
- Live validation: `/health` OK; compressed production HTML contains the new visualizer, production engine, style search and automatic profiles. Live executable SHA256 matches candidate: `753B810125F7FDFDF38B2A8E5AB8523465E51B8900F1B74524EE3924491366E4`.
- Existing browser tabs need a reload to use the new build. This update does not finish the separate album/artwork/video roadmap above.
