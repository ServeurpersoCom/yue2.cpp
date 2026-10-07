# Reliability repairs — 27 September 2026

Implements audit items 1–6. All previous working-tree changes are preserved; nothing has been committed or pushed.

## Changes

1. Settings are validated on load. Storage failures leave the interface usable with a visible warning and a save-again action.
2. Generated audio is committed to the library before optional artwork and MP4 processing. Later results update the existing song.
3. The server archives completed job results in `job_results/`. A restart can retrieve completed results; interrupted inference is explicitly reported and must be restarted. Acknowledged results become eligible for cleanup after 30 days; unacknowledged results are retained. Cleanup runs on acknowledgement.
4. Pending jobs live in IndexedDB, with client-generated submission IDs and a browser-wide operation lock. Retrying the same submission returns the same job. Other tabs receive library-change notifications.
5. Track edits use transactional patches and update the visible state after a successful save. Late processing cannot recreate a deleted song. Replacing audio or artwork invalidates dependent cached media.
6. Backup version 2 includes disk presets and current settings. Restore validates data before changing the library, downloads a before-restore backup, merges presets without overwriting conflicts, and replaces songs atomically.

## Verification

- Svelte check: 0 errors and 0 warnings.
- Frontend unit suites: 22 passed, including malformed requests, song/preset validation and backup roundtrip.
- Isolated browser storage checks passed: quota failures, malformed settings, recovery record before submission, two-tab submission, audio saved before artwork, failed favourite save, deletion during optional processing.
- Interaction review passed: 244 visible controls, keyboard navigation, dialogs, presets, playback, artwork preview, error feedback, YouTube draft save, rename, downloads, backup/restore, reduced motion and phone layout.
- Native archive tests passed: binary persistence, metadata-only reads, interrupted state, idempotence, acknowledgement retention and safe IDs.
- Isolated HTTP restart check passed across two server starts. No synthesis was performed by that test.
- UI and native builds completed. Native compilation retains the existing SheetSage numeric-conversion warning.
- Final candidate CPU smoke checks passed, including invalid/oversized requests and embedded UI.
- Activated on port 8087, PID 15944. Live health passed and served UI bytes exactly match the final bundle. Previous binaries are preserved in `build/backup-before-producer-20260927-144608/`.

## Limits and remaining work

- These checks use disposable browser libraries and mocked media operations. Fresh real music, image inference and signed-in YouTube publishing were not exercised.
- In-flight model computation cannot resume after a restart. Results already lost by an older server cannot be recovered retroactively. Power-loss durability has not been tested.
- Browser library storage is still local to its browser profile; backups remain necessary.
- Preset files, IndexedDB and browser settings cannot be committed in one transaction. If restore fails partway, successfully imported presets remain; existing presets are preserved and the before-restore backup provides a recovery path.
- Archive retention is currently a fixed policy, not a settings control.
- Audit items 7–20 remain for subsequent work. Dependent media invalidation partially addresses item 9; full operation cancellation, GPU scheduling, publishing, album flows, performance and real media acceptance checks remain outstanding.
