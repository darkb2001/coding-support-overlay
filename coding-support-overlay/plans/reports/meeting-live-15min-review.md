# Bug review + actual 15-minute Speechmatics check

## Outcome

Final command, run from `coding-support-overlay`:

```bash
set -o pipefail
caffeinate -i npm run test:meeting-live -- --synthetic --minutes=15 \
  --report=plans/reports/meeting-live-15min.json 2>&1 \
  | tee plans/reports/meeting-live-15min.log
```

**Exit 0, `ok: true`, 15.01 minutes real wall-clock**, approximately 14.90 minutes
of submitted PCM per source. Startup/TTS generation precedes that measured window;
probe/replacement control overhead explains why submitted PCM time differs from
wall time. No microphone/system/private capture. Two concurrent Speechmatics
connections; generated Linh/Samantha speech, repeated synthetic sentences.

This exercises the production Node realtime/session/assembler/transport code.
It does NOT run a full Electron meeting, actual microphone/native capture, LLM
requests or human-speech/Parakeet accuracy comparisons. The accepted-turn callback
is a bounded test collector, not the production disk-persistence implementation.
Persistence is covered separately by the automated local soak and regression tests.

## Bugs fixed

1. **Confirmed unfinished turn lost on abrupt close.** RealtimeSession now commits
   confirmed assembler content on close, exactly once; replaceable partials excluded.
2. **Already accepted final skipped if closed before its queued disk write.**
   MeetingSession drains accepted finals after close, rejects newly arriving stale
   events, and does not publish stale UI updates from the draining writes.
3. **Missing EndOfUtterance leaves short confirmed turns unfinished.** A 3s idle
   fallback commits confirmed content only, reset by new recognition activity.
4. **Transport stops too readily under transient ACK lag.** A real run failed at
   11.07min on the old ~96KB transport guard. Added PcmSendQueue with a 6s/source
   local bound, a 64KB outstanding/socket send window and <150 pre-send ACK gap.
   Queue retains order and capture timestamps; no evictions or reconnection replay.
   Answer snapshots include queued bytes; Stop drains them before exact EndOfStream
   sequence. Barriers have an 8s send deadline. Overflow/stall still fails visibly.
5. **Test harness false freshness failure.** Segment timestamps can include leading
   silence; measuring a preview against the segment start falsely rejected a fresh
   result. Measure event arrival, exclude old recognition during replacement by
   stream origin, and preserve the failed attempt rather than hiding it.

The exact underlying network/provider cause of the 11min ACK stall was not proven.
The recovery change addresses premature client termination, not a claim to repair
the network. Its regression test withholds ACKs for 4s and verifies every byte,
order, snapshot flush target and queued-audio Stop behavior.

## Deeper Parakeet inspection

Read installed app bundle only, not accounts/credentials/call history:

- `useTranscriptionSession`: serialized actions, STOP disables transition acceptance,
  shared recorder sender buffering during RESTART, connection identity checks,
  flush processed audio before force-boundary, separate full capture recovery.
- `useCombinedTranscript`: confirmed/partial/completed states, 3s share/combined
  fallback; its fallback can promote a partial if no confirmed text. We deliberately
  do NOT copy partial promotion into persistent transcript or AI context.
- `useTranscriptSaveQueue`: stable entry IDs, pending/inFlight/saved states, 5s
  batching, exponential retry capped at 30s with jitter, 30s stale inFlight reclaim,
  terminal/pagehide/hidden flush. This is cloud-storage-specific; do not blindly
  retry local append-file writes (a partially completed append can duplicate text).
- Native DSP and server semantic question detector remain unverified.

## Final 15-minute measurements

- Accepted assembled turns: **151** (Me 59, Others 92); no final errors.
- Initial vi → en → vi, plus en around minute 5 and vi around minute 10:
  **4 successful language replacements**; same logical Meeting retained.
- Periodic quiet periods and Answer-style finalization, alternating muted sources
  and simultaneous sources; fresh previews and confirmed progress checked.
- Vietnamese non-switch preview probes: **842–1118ms**.
- English non-switch preview probes: **557–731ms**.
- Non-switch flush probes: Vietnamese **650–920ms**, English **284–291ms**.
- Switch + buffered catch-up: **4349 / 8706 / 9127 / 4285ms**. Not instantaneous.
- Checkpoint JS heap **19.0–20.4MiB**, process RSS **51.8–58.1MiB**.
  This is Node harness memory, not full Electron UI memory or a proof of no leaks.
- Checkpoint transcript coverage lag did not trend upward: Me roughly 1–2.1s,
  Others roughly 1.3–1.7s while running; final drain left 0/0.1s.
  Coverage lag is not semantic turn-completion or first-answer latency.
- Peak local queue **1600 bytes**, peak unacked **64000 bytes**, peak ACK gap **40**;
  queued bytes and pending ACKs zero after close. Maximum measured pacing lag 36ms.
- Vietnamese technical-name transcription remains poor/inconsistent in this TTS
  corpus (React/TypeScript/PostgreSQL). No WER or accuracy-parity claim. Do not tune
  spelling replacements to game this synthetic recording.

## Other verification

- `npm run typecheck`: pass.
- `npm test`: **82 pass / 0 fail**.
- `npm run test:ui`: ok, real Chrome generated AudioWorklet + fixture lifecycle.
- `npm run build`: success, including separate self-hosted worklet asset.
- `npm run test:quit`: ok, exit 0, ports released, bridge unchanged; no live session.
- LSP: no reported errors on five changed production paths, but all five probes
  inconclusive; full TypeScript compilation is the authoritative check here.
- An intermediate new boundary test had an off-by-one expectation (150 chunks fit
  the send window, not 149); corrected expected capacity, not production limits.

## Durable evidence

- `meeting-live-15min.json` / `.log`: final successful 15min run.
- `meeting-live-15min-attempt1.json` / `.log`: early test-harness false failure.
- `meeting-live-15min-attempt2.json` / `.log`: genuine 11.07min transport-stop failure.
- `meeting-live-15min-source-sha256.txt`: tested source fingerprints.

9Router, Cursor Bridge and provider credentials were not changed. No overall
Parakeet parity claim. Human accuracy, echo/overlap robustness, actual 15min
Electron capture and answer quality remain outside this synthetic cloud check.
