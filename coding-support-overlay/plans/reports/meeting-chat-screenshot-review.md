# Meeting Chat + screenshot — 1.0.10

## Delivered

- Live **Chat**: typed question/multiline code, 16k-character limit, Enter newline,
  Cmd/Ctrl+Enter Send, works without an Others utterance. Explicit Send only.
- Live **Screenshot**: captures display containing overlay (not a region/window
  picker), temporarily hides overlay, checks permission/source/empty image, previews
  one PNG ≤8 MiB with remove/retake. Capture box ≤2560×1600. No automatic upload.
- Same production Answer controller: confirmed transcript flush/snapshot, JD/CV,
  format, selected vi/en, verified Meeting model, streamed decoded text, busy guard,
  model/language cancellation and Stop. No new STT provider or LLM routing choice.
- Successful question/answer history: at most six pairs / 18k serialized characters,
  per-question/reply caps 3k/6k with truncation markers. Separated from spoken
  transcript/CV facts; cleared on close. Image is never implicitly replayed.
- Failed send preserves draft/preview. Workspace-local unsent draft is not saved
  across History/end/reload; collapse retains the mounted tree. Completed chat is
  not appended to spoken transcript/Markdown export. No code execution/test runner.
- Owner/session-bound capture/discard and typed requests, opaque main-generated
  image IDs; no renderer-supplied filesystem paths. Only Send writes a private
  temporary PNG for existing Bridge transport; normal success/error/abort cleans it.
  Abnormal OS/process kill can bypass finally cleanup.

## Reference inspection

Installed `/Applications/ParakeetAI.app/Contents/Resources/app.asar`, **3.9.119**,
application bundles only, not accounts/cookies/tokens/recordings/history.
Renderer SHA256: `3c5c70505444d685129bdca53c86cdb8391a657841f98925451de47cdd41628c`.

- `ChatScreen`: local text + screenshot array, removable thumbnails, explicit Send,
  Enter/Escape; observed ten screenshots / 4 MiB encoded aggregate client limits.
- `useAiMessages`: direct-message/analyze-screen triggers, text + JPEG file parts,
  callSessionId, pending transcript, manual audio finalization and streamed output.
- Main `renderer/capture-screenshot`: Screen Recording permission check, current
  display selection, desktopCapturer, empty thumbnail guard, ≤3840×2160, JPEG 85.
  Missing-display/source fallback can capture primary/first; deliberately not copied.
- Backend semantic reasoning/private prompts and native DSP remain unverified.

Fresh extracts in `/tmp/parakeet-chat-screenshot-review.txt` and
`/tmp/parakeet-main-screenshot-focused.txt`; this is client-mechanism research, not
copied product code, backend reconstruction or measured product parity.

## Bridge upgrade required for images

Old Bridge explicitly rejected screenshots for Meeting sessions. New **1.0.10**
extends that route without changing provider/key/9Router/global-model settings:

- Advertises `meetingImages`; retains profile cache and selected-model preflight.
- Accepts only regular PNGs from main's temporary meeting-image directories;
  rejects invalid/missing/symlinked/oversized files and disabled vision, no silent
  text-only downgrade. Text preflight/catalog does not prove model vision support.
- Uses existing OpenAI-compatible image_url or direct Gemini inlineData encoding.
- Client disconnect aborts upstream HTTP generation (cannot undo already billed
  tokens; providers control accounting).
- Removes wildcard CORS and rejects browser Origin/preflight traffic. Supported
  caller is Electron main/Node, not arbitrary browser pages.

Built `cursor-extension/coding-support-bridge-1.0.10.vsix` (8 entries, ~14 KiB).
Archive contains compiled extension modules and manifest only, no .env/key/profile.
Packaging exited 0 with existing missing-LICENSE warning. Not automatically installed
or reloaded: user installs VSIX then runs **Developer: Reload Window** in Cursor.
Text Meeting works with older compatible Bridges; image Send gives an upgrade error.

## Background process / shutdown

At task start, main PID **63194** and owned helpers **68415/68416** remained alive.
TERM did not close them during inspection; exact PIDs were force-killed. No evidence
was collected proving active cloud transcription/billing at that moment. Cursor and
its Bridge were not killed. Final process/port check: no overlay Electron/capture/
meeting-live process, no listener on 5173; existing Cursor Bridge still on 3799.

Native window close now enters the same graceful Quit path as the explicit button,
not macOS windowless residency. SIGTERM/SIGINT call Quit. Transcript/STT cleanup is
still bounded at five seconds; a seven-second final process-exit guard prevents a
native quit stall from keeping normal event-loop execution alive. It is not proof
against an OS hang, blocked event loop or forced kill. No app is left running for
the user after validation.

## Actual verification

Full command output: `meeting-chat-screenshot-validation.log`.

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | **95 pass / 0 fail** |
| `npm run test:ui` | `ok: true` |
| `npm run build` | pass |
| `npm run test:quit` | real hidden Electron button, exit 0, ports released |
| `npm run test:quit -- --action=close` | real native close, exit 0, ports released |
| `npm run test:quit -- --action=signal` | exact CDP-owned PID SIGTERM, exit 0, ports released |
| `cd ../cursor-extension && npm run compile` | pass |
| `cd ../cursor-extension && npm run package` | pass, missing-LICENSE warning |

Local tests cover main image ownership/monitor/limits, stale capture and close,
private temp-file cleanup on success/failure, explicit question/profile/language/
model/history forwarding, no-Others manual questions, regular Answer's Others gate,
busy rejection, cancellation and no stale final/history. Real loopback Bridge HTTP
runs production preflight/context and OpenAI transport against a **synthetic local
provider**, verifying PNG bytes, pinned model, cached profile, text-only follow-up,
invalid-image/vision rejection, browser-Origin rejection and upstream abort.
It does not prove model vision accuracy; direct Gemini cloud generation not tested.

Real Chrome drives production App/MeetingMode/composer with fixture IPC: failed-send
draft retention, multiline code, streaming busy state, capture-without-send, preview,
remove/image-only Send, Ctrl+Enter follow-up without old image and 400px layout.
Screenshot IPC is a fixture, not actual native desktop capture. Existing audio,
language/model/collapse/history/transcript/Answer regressions remain green.
Unit-driver zero-ms answer timings in this log are fake-control tests, not another
live LLM latency claim. Earlier implementation failures involved prompt section
format compatibility and fixture UUID/button selectors; corrected before final run.

LSP: no reported errors, **2 confirmed clean / 14 inconclusive**; do not call all
paths LSP-clean. Full TypeScript compilation passed for both projects.
The seven-second native-stall fallback was not tested by forcing an OS deadlock.
No private screen/mic/system audio was uploaded; **no cloud STT session or paid LLM
vision generation** was started for this change. Prior 15/10-minute cloud evidence
is historical, not reused as a cloud validation of the new feature.

Fixture preview: `docs/visuals/meeting-chat-screenshot-400px.png`.
Tested-source fingerprints: `meeting-chat-screenshot-source-sha256.txt`.
All source/archive fingerprints verified with `shasum -a 256 -c`. Nine new report,
doc and compiled-code files checked against the actual Speechmatics key: no match;
no credential was printed. Existing dependency audit findings were not remediated;
no dependency upgrades.
