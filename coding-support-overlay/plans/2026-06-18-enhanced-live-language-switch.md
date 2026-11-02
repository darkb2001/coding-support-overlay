# Enhanced live language switching

## Evidence and scope
- Speechmatics SetRecognitionConfig rejects a changed language. Restart provider recognition, not the app/Meeting.
- ParakeetAI 3.9.119 renderer: useTranscriptionSession RESTART keeps capture, buffers frames (30s), starts a replacement client and replays frames. It may evict old buffered frames; do not copy silent eviction.
- Preserve the existing MeetingSession, transcript, profile, selected LLM and completed answer. Keep 9Router/Bridge unchanged.
- Prior subagent preparation is blocked by missing pi runtime packages; operator authorized direct implementation. No Git repository.

## Tasks
1. Default Enhanced, explicit vi/en; small IT glossary and server silence endpointing. Keep Melia opt-in.
2. Drain both old STT streams before opening replacements (two-session quota). Bound transition audio to 30s/source, preserve capture timestamps and replay with transport backpressure. Fail visibly on overflow/error; close must prevent resurrection.
3. Await language switch over owner/session-bound IPC; serialize conflicting operations, cancel stale answers, expose switching status. Preserve history/context.
4. Visible vi/en dropdown, migrate stored Auto to Vietnamese, disable conflicting actions while switching. No app restart to switch language.
5. Test repeated switches, old tails, buffered audio/backpressure, cancellation, failures, quota ordering, UI state. Typecheck, tests, UI smoke, build, quit smoke; synthetic cloud check only, no private capture.
6. Document measured evidence and limits. No claim of whole-product parity or human accuracy without benchmarks.

## Status
- Tasks 1–6 implemented and checked. Broader interview-copilot work includes 50ms
  AudioWorklet capture, turn assembly, streaming AI previews, bounded UI/context,
  experience/negation memory, ACK watchdog and meeting power guard.
- Final verification: `npm run typecheck`; `npm test` → 85 pass / 0 fail;
  `npm run test:ui` → ok (including real generated Chrome worklet and pending
  language switch at 400px); `npm run build` → success;
  `npm run test:quit` → ok, exit 0, ports released, bridge unchanged.
- Local 60min-equivalent soak: 144000 frames / 230.4MB / 3600 persisted turns;
  200 retained; ~9.4s wall time. Not a wall-clock cloud/human-hour validation.
- `npm run test:meeting-live -- --synthetic --minutes=15` → ok; 15.01min actual
  wall-clock, 151 turns, four replacements including minute 5/10, no final errors.
  ~14.90min PCM/source. Preview probes vi 842–1118ms, en 557–731ms; replacements
  4.3–9.1s. Technical names remain poor/inconsistent with Vietnamese TTS.
- Long-run review fixed confirmed-tail loss, accepted writes discarded after close,
  missing-endpoint idle completion, and overly strict transient ACK handling.
  Added 6s/source jitter queue, bounded send window and snapshot-aware drain.
- Failed attempts retained: harness freshness check, then genuine transport-stop
  at 11.07min. Full 15min run restarted after fixes; no success extrapolation.
- Latest LSP: no reported errors, five changed paths inconclusive. Authoritative
  full TypeScript compilation passed; inconclusive is not confirmed clean.
- User accepted 15–20min gate instead of 60min; synthetic cloud gate completed.
  Actual human/full-Electron/LLM accuracy validation remains outside this check.
- Durable evidence: `plans/reports/meeting-live-15min-review.md`, raw JSON/logs
  for success and failures, and tested source SHA256 fingerprints.
- Follow-up requested: `--answers --minutes=10` ran successfully for 10.01min.
  Real main IPC/Bridge/model `cx/gpt-5.6-luna`, 9 Answer jobs: 7 completed, 2 planned
  cancellations after first streamed preview; duplicate press rejected. Four
  language replacements preserve same meeting/model/context. 101 real JSONL turns
  exported. OS/device/window boundaries remain synthetic; no human/GUI parity claim.
- Evidence: `plans/reports/meeting-live-10min-answers-review.md`, raw answer JSON/log,
  transcript JSONL/Markdown and tested source fingerprints. No app production-code
  changes needed for this follow-up; explicit dev esbuild dependency for bundling.
- Full evidence/limits: `docs/parakeet-pipeline-analysis.md`.
