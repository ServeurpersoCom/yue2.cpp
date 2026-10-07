# YouTube draft agent

Current integrated workflow: **Prepare for YouTube → Launch agent** on a saved MP4. The native server starts the loopback bridge; a dedicated Chrome profile opens. The ordinary signed-in Chrome window cannot be attached without a debugging connection. Metadata drafts save locally; playlist, end screens and publishing remain review actions. The user deferred signed-in upload acceptance on 27 September 2026; nothing was uploaded.

The CLI below remains an alternative. Its separate Edge profile is independent of the integrated Chrome bridge.

# YouTube browser agent — first version

Creates a local publishing draft from a YuE2 song and assists a signed-in YouTube Studio upload. Uses a dedicated persistent Edge profile; Google credentials are entered in the browser, never in a configuration file.

## Start

1. On the song menu select **Export video (MP4)** if necessary, then **Prepare for YouTube**.
2. Edit the metadata, save/download the draft, and download the MP4. Optionally download artwork.
3. In PowerShell:

```powershell
cd C:\Users\mrmul\yue2.cpp\tools\youtube-agent
npm install
npm start -- --draft "$env:USERPROFILE\Downloads\youtube-1.json" --video "$env:USERPROFILE\Downloads\youtube-1.mp4"
```

Use your actual filenames. Add `--thumbnail "C:\path\cover.png"` for a thumbnail. Edge is the default browser; `--channel chrome` uses installed Chrome. `--validate-only` checks the draft and input files without opening a browser or uploading anything.

4. Sign in, select your channel, and open **Create → Upload videos**. Type `UPLOAD` in the terminal to authorize transferring this video.
5. The agent supplies the MP4, title, description, chosen audience, optional thumbnail and tags.
6. Review the fields and thumbnail in Studio. Apply the requested playlist and end screen manually, review disclosures and checks, wait for processing, and choose visibility or scheduling. Save/publish in Studio yourself. Type `REVIEWED` only after Studio confirms your changes were saved.

## Implemented and pending

Implemented: per-song local draft, export of draft/video/artwork, input validation, dedicated browser session, upload and basic metadata filling, staged review, run status and error screenshot. Selectors currently target English Studio. The browser automation has not yet been exercised against a signed-in channel.

Playlist selection, end-screen editing, disclosures, scheduling and the final save/publish action currently require the user in Studio. End screens may be unavailable based on audience and video eligibility. These steps are explicitly presented for review, never recorded as automatically completed. A completed run means the user confirmed review; it is not proof of publication.

Runs are saved under `runs/`; browser session data under `profile/`. Both are ignored by git. Keep them local. Errors stop without retrying the upload. Inspect the existing Studio draft before running again, because YouTube may already have retained it. Browser layout changes may require selector updates. Close the agent before launching another run with the same profile.

The UI bundle is embedded in yue-server. Building the WebUI alone updates the bundle on disk; rebuilding/restarting yue-server is needed to expose it on port 8087.

The runner uses Playwright [persistent browser contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) and [file input actions](https://playwright.dev/docs/input#upload-files).
