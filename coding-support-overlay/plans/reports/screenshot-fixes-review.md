# Screenshot fixes — overlay 1.0.15 / Bridge 1.0.11

## Changes
All three findings in `screenshot-llm-review.md` addressed; original review and failed/probe evidence retained unchanged.

1. `MeetingMode.tsx`: explicit Chat/image sends no longer wait on renderer mic flush. This also covers typed coding follow-ups. Regular Answer still flushes unfinished mic context. Main's normal text-Meeting context snapshot/flush remains unchanged; screenshot/coding still uses isolated context.
2. `cursor-extension/src/extension.ts`: both OpenAI-compatible and Gemini successful SSE responses use `res.setEncoding('utf8')` and string chunks. Stateful decoding preserves Vietnamese, emoji and code characters across TCP boundaries. Existing image encoding, selected model, abort and explicit provider errors unchanged. Existing GeminiContent type now actually types the request content (resolves unused-type diagnostic in the touched provider).
3. `meeting-media.ts`: capture deadline 10,000ms including hide/compositor wait; per-capture AbortController. End/Stop/Quit already call clearMeetingImages, which now aborts capture waiting too. Timeout/cancellation releases lock, clears timers/listener and restores only a still-open owned window. Promise.race wraps each await, so a late native result does not resume the attachment-writing continuation or overwrite a newer preview. Late native rejection remains observed. Existing display/owner/session/permission/size checks retained, no auto-retry/upload.

Native Electron getSources itself cannot be forcibly cancelled with this API; only its app wait/result is cancelled. Timer assumes the main JS event loop is responsive, not a guarantee against an OS/native deadlock.

## Regression evidence
- **108/108 tests**, zero failures/skips. Five new unit tests (three capture lifecycle, two provider UTF-8) plus extended existing real HTTP image and production React UI assertions.
- Capture tests inject short budgets: timeout releases lock/restores app, next capture succeeds, late old result cannot overwrite new image; Stop wakes stalled native wait; late native rejection safe; Quit aborts compositor wait without native capture or window resurrection. Default production deadline asserted 10s, not a 10s real macOS benchmark.
- Both production provider transports receive one-byte chunks through Node streams, preserve exact Vietnamese/emoji/code output and exact image encoding/model routing. HTTPS socket boundary mocked: no Gemini/cloud request.
- Existing real Bridge loopback HTTP image test now deliberately splits a Vietnamese character between upstream TCP writes. Exact valid output retained with no replacement character; selected model/cache, PNG, no implicit image replay, rejection/origin and disconnect cancellation checks still pass.
- Actual React App/MeetingMode/composer fixture sets mic.flush to fail: image-only Send and typed coding follow-up succeed without calling mic flush; normal Answer still attempts it and reports the error. Existing answer-page navigation, transcript/answer minimum heights, mic toggle, collapse and language/model behavior pass.
- Three actual hidden Electron shutdown paths (Quit button/native close/SIGTERM), no audio session: each exit0, dev/debug ports released and Cursor Bridge unchanged.
- Overlay typecheck + main TypeScript check + build pass; Bridge compile/package pass. LSP zero errors reported, one confirmed clean/three inconclusive; full TypeScript builds are definitive. No lint script configured. Package warning: LICENSE file absent, unchanged project limitation.
- VSIX verified version 1.0.11; packaged compiled extension exactly matches local build; two packaged UTF-8 stream decoders present.
- After gates: no non-Cursor Electron/capture candidates, no 5173 listener; Cursor PID3653 still owns localhost:3799. No leftover test audio session was created.

## Exact final commands
Full output: `screenshot-fixes-validation.log` and `screenshot-fixes-bridge-validation.log`. All exit0.

```sh
# coding-support-overlay
npm run typecheck
npx tsc -p tsconfig.node.json --noEmit
npm test
npm run test:ui
npm run test:quit
npm run test:quit -- --action=close
npm run test:quit -- --action=signal
npm run build
# cursor-extension
npm run compile
npm run package
```

Direct-parent review only (existing delegated infrastructure unavailable; no independent reviewer claim): checked all abort/timer/result ownership paths, rejection handling, normal Answer retention, no transcript leakage to coding, UTF-8 exactness and artifact contents. No failed final test gates; partial package-lock edit ambiguity corrected surgically without changing dependency versions. Historical fingerprints not overwritten.

## Delivery / limits
- Overlay 1.0.15 built. Bridge artifact: `cursor-extension/coding-support-bridge-1.0.11.vsix` (8 files, 14.15KB).
- **Not installed or reloaded automatically.** User must End Meeting/Quit, explicitly install VSIX in Cursor and run Developer: Reload Window; then Test Connection for the next Meeting and reopen overlay with `npm start`. Existing running Bridge does not gain this UTF-8 fix from overlay restart alone.
- Key/provider/9Router/global-model/.env unchanged. No private capture upload, paid STT retry, real cloud generation or forced user-session interruption.
- Real macOS capture responsiveness and real Luna/Gemini vision quality/latency remain unbenchmarked; synthetic/local transport passing is not a cloud vision claim.
