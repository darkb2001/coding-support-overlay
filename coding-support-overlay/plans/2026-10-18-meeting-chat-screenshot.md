# Meeting chat + screenshot

## Scope
Preserve working STT/live language/model/Answer behavior. Add explicit typed questions
and a single screenshot attachment with preview/removal before sending. Use current
Meeting profile, language, transcript and verified model. No automatic screenshot,
private capture test, provider fallback or global-model change.

## Observed reference
Installed Parakeet renderer: ChatScreen keeps local input/screenshots, thumbnail
removal, Send gating, Enter/Escape; direct-message vs analyze-screen triggers.
Generation sends text + file parts, flushes conversation before manual actions,
and carries callSessionId/pending transcript. Renderer observed up to ten images /
4 MiB encoded aggregate; not copying limits or inaccessible backend/native internals.
Source extracts: /tmp/parakeet-chat-screenshot-review.txt (application code only).

## Implementation
1. Stop stale overlay. Observed PID 63194 and owned helpers persisted after TERM;
   exact PIDs force-stopped. No remaining overlay processes; Bridge retained.
   This does not establish whether Speechmatics was charging while idle.
2. Add owner/session-bound capture/discard IPC. Capture overlay's display on explicit
   click, hide overlay temporarily, preview only, bounded one-image memory. Resolve
   only main-owned opaque IDs; private temp image only while sending, clean finally.
3. Extend Answer with validated typed question/optional image, bypass Others gate
   only for explicit user input. Keep shared busy/abort/language/model/Stop handling.
   Bounded successful question/answer history, separated from CV facts/audio.
4. Extend existing Bridge meeting route for vision, preserve routing/preflight/context;
   advertise capability, fail explicitly on old Bridge/disabled vision/missing image.
   Package updated VSIX; do not silently replace/reload user's running extension.
5. Add Chat/Screenshot composer, multiline coding input, preview/remove, explicit
   Send, streaming answers; state survives failure, no resending image implicitly.
6. Harden actual close/quit/signal cleanup; verify click/OS close/termination paths
   without opening audio or paid STT sessions.
7. Run typechecks/tests/UI/build/quit, synthetic vision transport checks; document
   exact evidence and limits. No new cloud STT soak or private-screen cloud upload.

## Completed
- Steps 1–7 complete; overlay and packaged Bridge 1.0.10 built. VSIX not installed
  or auto-reloaded; user must install and reload Cursor for Meeting image support.
- Final verification: both TypeScript projects pass, 95 tests / 0 fail, UI smoke,
  production build, and native button/close/SIGTERM exit 0 with ports released.
- No overlay/capture/live-test process remains; Cursor Bridge preserved. No cloud
  STT/LLM vision generation performed. New report/limits and tested-source hashes:
  `plans/reports/meeting-chat-screenshot-review.md`.
- One image/full overlay display only; no region picker or multi-image parity claim.
  Real model vision accuracy/actual native capture still requires a consented test.
