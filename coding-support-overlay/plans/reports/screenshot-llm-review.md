# Screenshot → LLM review — overlay 1.0.14 / Bridge source 1.0.10

Scope: current Meeting Screenshot/coding-image flow, shared Bridge provider streaming, renderer send/capture lifecycle. Review only: no production source/settings changes, private capture, cloud request or user-app restart. Direct-parent review; no independent reviewer claim. Existing configured delegated infrastructure blocker not retried.

## Findings (confirmed locally)

### P2 — unrelated mic flush can prevent sending a coding screenshot
- Location: `src/renderer/MeetingMode.tsx:279-281`.
- Every request awaits `recorderRef.current.flush()` before invoking main `requestHint`, including image-only Send. A mic AudioWorklet flush rejection prevents the image request from reaching main/provider. The model-phase/preparation deadlines in main have not started yet. Main already excludes coding requests from STT snapshot/flush (`src/main/meeting/meeting-reply.ts:55-60`), so isolation is incomplete at the renderer boundary.
- Local reproduction: production React App/MeetingMode/composer with recorder fault injection only. Capture synthetic image, make recorder.flush reject, click Send. Main request fixture count remains unchanged, mic error appears, image is retained. No provider request. Full UI suite continues to pass after clearing fault.
- Recommendation: bypass renderer transcript flush for screenshot requests; define coding text-follow-up intent explicitly if it should bypass too. Regression tests must cover failed/stalled mic and image send independently.

### P2 — Bridge corrupts Vietnamese/non-ASCII text across UTF-8 chunk boundaries
- Locations: `../cursor-extension/src/extension.ts:124-126` (OpenAI), `:235-237` (Gemini).
- Both stream parsers independently call `Buffer.toString()` on each network chunk. A multibyte character split between chunks becomes replacement characters before SSE JSON decoding. Applies to text/code responses after image upload and ordinary answers.
- Reproduced with production Bridge HTTP handlers/OpenAI image route, verified synthetic model, local synthetic upstream, exact PNG attachment. Split a Vietnamese character inside one SSE frame: expected `{"reply":"Tiếng Việt: sửa lỗi chỉ số"}`, actual `{"reply":"Ti���ng Việt: sửa lỗi chỉ số"}`. Output JSON still parses, so this can silently display/store damaged text. Gemini has the same implementation defect by inspection, but no direct Gemini network repro was run.
- Recommendation: stream-aware UTF-8 decoding (`res.setEncoding('utf8')` or StringDecoder) in both providers; byte-boundary regression tests. A fix here requires a new Bridge build and explicit installation/reload, not just overlay restart.

### P2 — capture has no deadline/cancellation wake; hidden window can remain hidden
- Location: `src/main/meeting/meeting-media.ts:42-45,59-61`.
- Overlay is hidden before awaiting desktopCapturer.getSources. Window restoration and clearing global capturing flag happen only after that promise settles. There is no capture deadline; the 180s model budget does not cover capture. Stop clears pending images but does not release this await/flag.
- Controlled reproduction: inject a pending native-capture promise. After 450ms and logical session stop, capture is still pending and window still hidden; only releasing the promise reaches finally/restoration. This confirms the control-flow failure mode, **not** that macOS actually hung in the user's prior session.
- Recommendation: bounded capture wait, stop/quit-aware cancellation, ignore late/stale completion, preserve owner/session/window checks and always restore a still-open app. Avoid a naive timeout that permits a late capture to replace a newer attachment.

## Paths reviewed without a new failure found
- Intended-display selection, permission/empty/8MiB errors, explicit preview/Send, one owner/session-bound opaque image ID, no auto-upload.
- Image bytes reach OpenAI image_url on the local transport test; vision disabled/missing/invalid/symlink image is rejected in the Meeting route, no silent text-only downgrade.
- Coding generation excludes Meeting transcript/CV/JD/format/memory and has separate cached AI context. Explicit image only; no image replay for follow-up.
- Temporary file cleanup on normal success/error/abort; stale response/Stop suppression, shared busy state and existing timeout reporting.
- Limits remain: whole-display downscaled screenshot, not a crop tool; overlay hiding is best-effort; forced kill can bypass temp-file cleanup. These are documented limitations, not new confirmed regressions.

## Evidence / commands
1. `node --test tests/meeting-media.test.mjs tests/meeting-reply.test.mjs tests/meeting-vision-bridge.test.mjs tests/meeting-answer-stream.test.mjs` — **17/17 pass**, zero failures. Existing green tests do not cover the three fault cases above.
2. `node /tmp/review-screenshot-probes.mjs` — exit0, capture pending + production Bridge UTF-8 corruption confirmed, result JSON saved.
3. `node /tmp/build-screenshot-ui-probe.mjs` creates a /tmp-only clone of existing UI smoke with synthetic recorder flush fault. No production edit.
4. First `node /tmp/screenshot-ui-fault-probe.mjs` — exit1 **before screenshot probe**, unrelated `Real AudioWorklet emitted no frames`; failure log preserved.
5. Same command retry — exit0, `REVIEW_CONFIRMED: image Send blocked before main requestHint by renderer mic.flush failure; image retained; no provider call`; full remaining UI assertions pass. Retry evidence is not presented as an unqualified first-attempt pass.

Artifacts saved under `plans/reports/screenshot-review-*`: probe JSON, existing test log, failed UI attempt, successful UI retry. Repro scripts remain in /tmp. No cloud model-image accuracy or Luna vision latency test; image forwarding locally is not proof a cloud model interpreted the image correctly. Keys/provider/global model untouched. No production fixes/build/version bump in this review.

## Unresolved
- Whether the user has encountered these conditional faults in a live session: no failed-request trace supplied.
- Real macOS capture hang frequency and real cloud vision quality/latency remain unmeasured.
