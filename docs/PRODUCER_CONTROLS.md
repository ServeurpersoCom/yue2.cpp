# Song planner and voices

The Create page includes a persistent song planner for new compositions. It compiles musical direction into the existing YuE2 style prompt; no model weights or inference defaults change.

- Singing amount guides melodic singing versus rap/spoken delivery. Vocal presence separately guides the balance of vocal passages and instrumental space. These are requested proportions, not enforced timing.
- Vocal presence zero submits empty lyrics while preserving the editor text.
- One to four requested voices have editable descriptions. Locking keeps descriptions and cast size fixed in the browser across songs and reloads. This is a profile lock, not a speaker identity embedding, voice clone, or guarantee of the same singer.
- Tempo, arrangement, vocal descriptions, and delivery guide both music and the Ollama lyric assistant. Existing lyrics are never rewritten automatically. The plan is a transparent template or user-written direction, not a validated symbolic score.
- Auto duration uses a rough 4/4 phrase budget from tempo, words per line, singing balance and vocal presence. Explicit durations are preserved. It is not forced alignment and is not language-aware syllable counting; the model/token budget can end earlier.
- Three-take mode snapshots the plan, generates independent seeds, and runs one song at a time with both batch sizes set to one. It saves each result before submitting the next. Cancel stops remaining submissions. Reload recovers only the active take; unsubmitted takes are not resumed.
- The Library's Compare takes selector groups candidates; existing playback and favourite controls support choosing a take. No automatic perceptual ranking is claimed.
- Loaded performances and remixes bypass planner overrides. Switching to Library keeps the generation form mounted so the queue remains owned by one component.
- Confirmed terminal job failures/cancellations clear pending recovery; result-download and library-save failures retain it.

Validation: 15 Node regression tests; clean Svelte check; Vite and native Release builds; isolated Chrome test of controls, persisted profiles, sequential fresh seeds, grouping, cancellation, instrumental preservation and mobile width; temporary CPU server API/embedded-UI smoke checks. Browser generation uses mocked audio. Audible quality and singer consistency have not been established by these tests.

Build: `npm run build` in tools/webui, then build yue-server. `build/build-producer.cjs` normalizes duplicate Windows PATH keys and creates the Release-producer candidate. `build/activate-producer.ps1` backs up the current Release-reference executable and GGML DLLs, installs the candidate at the existing launcher path, and rolls back on startup failure.
