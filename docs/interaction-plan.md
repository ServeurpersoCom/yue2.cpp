# Studio interaction plan

Every control receives theme-aware hover, keyboard focus, pressed and disabled states. Hover takes 140 ms; press takes 90 ms. Motion is disabled when reduced motion is requested. Cards emphasize their border without moving their contents. Only actionable controls lift; destructive actions retain a distinct warning color. No click sounds, fake progress or idle pulsing.

## Component inventory and treatment

| Area | Cards and controls | Planned response |
| --- | --- | --- |
| App shell | Navigation, theme selector, volume, connection | Active navigation stays selected; keyboard focus remains visible; volume updates immediately; connection reflects actual state. |
| Saved presets | Preset cards, empty state | Hover/focus emphasis, pressed feedback, loaded confirmation; keep names readable. |
| Workflow | Sound, planner, lyrics, generate navigation | Active step uses accent; hover previews action without moving panels. |
| Sound | Style tiles, add/remove, search, category controls | Image emphasis on hover; selected border/check remain visible; search gets focus ring. |
| Blend controls | Influence dials and numeric inputs | Drag state and grabbing cursor; arrows and numeric edits retained; distinct focus. |
| Saved blends | Choose, load, name, save, update, rename, delete | Disable conflicting actions while writing; visible saving status; load confirmation; preserve destructive confirmations. |
| Planner | Voice selectors, layout, length, structure and automatic options | Consistent field focus and pressed states; disabled automatic controls stay visibly unavailable. |
| Lyrics | Styles, assistant, prompt, text editor, generate/cancel | Selection confirmation; text remains stable while editing; real busy text and cancellation retained. |
| Composition | Melody/reference selection, range, upload/reset | Clear action and disabled states; range controls remain available for precise keyboard editing. |
| Engine | Model choices and advanced disclosure | Distinct focus, open disclosure styling and selected states. |
| Sampling | Range/number pairs, reset and automatic settings | Range hover/focus response; paired values unchanged; disabled controls do not animate. |
| Output | Format, mastering, monitor volume | Consistent focus; dropdown choices remain native and accessible. |
| Generation | Generate/queue/cancel and progress | Primary button has stronger emphasis; existing real progress/ETA retained; busy feedback does not imply completion. |
| Library | Search, favourites, backup, restore, empty state | Active filter indication; visible operation name while backup/restore runs; prevent duplicate operations. |
| Track cards | Play/stop, remix, favourite, version comparison | Playing border, pressed playback state, favourite pop, persistent selected version. |
| Track menu | Download, video export, artwork, transcription, vocal balance, rename, delete, YouTube | Keyboard arrow/Home/End navigation; Escape restores trigger; busy operations guarded and labelled; deletion distinct. |
| Artwork | Cover, fullscreen, close, prompt, seed/dice, generate | Cover affordance; existing fullscreen dismissal; visible rendering state and disabled concurrent inputs. |
| Waveform | Seek and range selection | Keyboard seek with arrows/Home/End and Space playback; visible focus; pointer cancellation clears dragging. |
| Preview rail | Cover, transport, recent tracks and favourites | Same control language as library; active playback and selected tracks remain distinct. |
| Activity | Disclosure, progress, log viewport | Open/focus emphasis; existing stage colors and real progress retained; no decorative fake progress. |
| Dialogs | Rename/delete and custom action dialogs | Initial focus, Tab containment, Escape dismissal and return focus; multiline Enter never accidentally confirms. |
| YouTube | Metadata, checkboxes, save/export draft and cancel | Shared button/input feedback; existing saved/busy/error state retained; publishing remains explicit. |
| Toasts | Success and error notices | Distinct icons and colors, theme-readable surface and polite announcement. |
| Visualizer | Playback-driven canvas | Keep existing audio response and reduced-motion behavior; do not add idle animation. |

## Review boundaries

Inspect each component and shared controls. Build/typecheck the UI, then exercise navigation, keyboard menus/dialogs, style selection, presets, playback and busy/error states in an isolated browser profile. Review all six themes and reduced motion. Use mocked operations for destructive/server-heavy actions; do not generate songs, delete real tracks or publish uploads as part of interaction review.

## Execution record — 27 September 2026

- Implemented shared hover/press/focus/disabled feedback and component-specific selection, playback, drag, busy, success and error feedback.
- Reviewed 244 visible controls with panels expanded and manual settings enabled; keyboard focus checked for every enabled control in that inventory.
- Browser exercises passed for named preset saving/loading, style selection, manual sampling, menu arrows/Home/End/Escape, dialog initial focus/Tab containment/return focus, favourites, waveform seeking/playback, artwork dismissal, transcription busy/error and YouTube draft saving.
- All six themes passed desktop and 390-pixel phone width checks. Secondary text palette contrast ranged from 5.93:1 to 8.41:1. Screenshot review additionally caught and corrected library title/play-control contrast in Studio Glass.
- Reduced-motion checks passed. UI typecheck: zero errors and zero warnings. Frontend and embedded server builds completed; native build retains an existing numeric-conversion warning in sheetsage.h.
- Review uses a disposable browser library and mocked server mutations. These checks cover interaction behavior, not the quality of newly generated audio/artwork or actual YouTube publication.
- Local review artifacts: `build/ui-review/control-inventory.json`, `interaction-library.png`, `theme-*.png`, and `glass-mobile.png`.
- Additional disposable-library checks passed for renaming, audio download and backup/restore. Active generation was cancelled at the user's request and the rebuilt server activated on port 8087.
