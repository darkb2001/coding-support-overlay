# Actual 10-minute STT + Answer + language-switch check

## Command and result

From `coding-support-overlay`:

```bash
mkdir -p plans/reports
set -o pipefail
caffeinate -i npm run test:meeting-live -- --synthetic --answers --minutes=10 \
  --report=plans/reports/meeting-live-10min-answers.json 2>&1 \
  | tee plans/reports/meeting-live-10min-answers.log
```

**Exit 0; `ok: true`; 10.01min real wall-clock**, about 9.99min PCM/source.
Speechmatics Enhanced, real Cursor Bridge/model preflight and real streamed LLM
requests using configured model **`cx/gpt-5.6-luna`**. No provider credential,
global model setting, user profile/CV, or existing meeting history was changed.
The temporary mock profile is explicitly synthetic: three years Node.js/PostgreSQL,
no production Kubernetes experience. Only generated Linh/Samantha audio was sent.
No microphone, system audio, display capture or real call was opened.

## What was exercised

`--answers` bundles the actual production meeting main-process modules, replacing
only Electron window/power/IPC transport and native capture with synthetic boundaries.
The test invokes the registered production IPC handlers as the owning sender;
it does not reimplement Answer/language state machines. A read-only runtime export
is appended ONLY to the temporary test bundle, not shipped in the application.

Real code paths exercised:

- Model verification ticket → production `meeting:start` → two cloud STT streams.
- Microphone PCM through owner/session-bound `meeting:pcm`; Others through the
  synthetic native-capture callback. Audio continues while the model generates.
- Production `meeting:request-hint`: STT flush, persisted snapshot, bounded memory,
  synthetic JD/CV/format, MeetingAiContext, HTTP Bridge/SSE, decoded reply preview
  and unique completed answer event.
- Production `meeting:set-language`: cancel old Answer, drain/restart/replay STT,
  retain same MeetingSession/model/opening transcript and use new answer language.
- Production `meeting:stop`: drain, persist and export real JSONL/Markdown in an
  isolated temporary data directory. Copies retained in reports; temp removed.

This is **not a mouse-click/renderer/Electron-native E2E test**. The UI is checked
separately by UI smoke with fixture APIs. The two tests together are not claimed
to be one combined live renderer/device test.

## Scripted interactions

| Approx. minute | Action | Observed result |
|---|---|---|
| Startup | vi → en → vi, preserve meeting/model | Both replacements succeed |
| 1 | Answer in vi, immediate duplicate press | One streamed final; duplicate rejected |
| 2 | Answer in vi | Streamed final |
| 3 | Answer vi, switch to en on FIRST preview | Cancelled, one preview, zero final events |
| 4 | Answer in en | Streamed English final |
| 5 | Answer in en | Streamed English final |
| 6 | Answer en, switch to vi on FIRST preview | Cancelled, one preview, zero final events |
| 7–9 | Answer in vi once/minute | Three streamed Vietnamese finals |
| 10 | Stop and export | 101 turns persisted/exported |

**9 primary Answer requests: 7 completed + 2 intentionally cancelled after real
streaming began.** One extra duplicate IPC request was rejected before generation.
The real model preflight is an additional small quota-consuming request.
No orphan completed-answer event was observed outside an active request.

## Measured timings

Successful Answer jobs, from button-equivalent IPC request, including STT flush,
context preparation, Bridge/provider and decoding—not pure model-only latency:

- First decoded preview: **3826–7369ms**, median **5031ms**.
- Completed final answer: **4937–9021ms**, median **5485ms**.
- Per completed answer: 4–21 preview events, exactly one final event.
- Planned cancellation jobs: first preview at 5370/3603ms, cancelled at 5373/3605ms;
  both had zero completed-answer events.
- Four language replacements: **4456 / 8941 / 4804 / 3672ms**.
- 101 emitted and 101 persisted turns: Me 43, Others 58. Post-run count equality
  and JSONL readability checked independently against the raw report.
- Checkpoint heap **11.4–12.8MiB**, RSS **32.1–38.0MiB**, no clear accumulating
  transcript-lag trend. This is test Node memory, not full Electron memory. Do not
  compare it as an app-memory improvement against the older TS-transpiling harness.
- Queues/pending ACKs empty after Stop; peak queued bytes 1600, unacked bytes 64000,
  ACK gap 40, pacing lag 27ms. No final errors in the run.

Manual review of the seven small answer samples: Vietnamese/English output followed
session selection; the provided synthetic Node.js/PostgreSQL experience and absent
Kubernetes experience were distinguished from proposed designs. This is limited
sample inspection, not an automated hallucination/quality benchmark. Technical-name
STT errors from Vietnamese TTS remain visible in the saved transcript.

## Verification and limits

- `npm run typecheck`: pass.
- `npm test`: **85 pass / 0 fail**, including driver success/failure checks and
  bundle/production-IPC boundary tests. Unit fake answers are NOT the cloud results.
- `npm run test:ui`: ok.
- `npm run build`: success.
- `npm run test:quit`: ok, exit 0, ports released, bridge unchanged; no live session.
- LSP: two changed script/test files confirmed clean, two inconclusive, no reported
  errors. Actual Node execution/import tests provide additional script validation.
- `esbuild` was already transitive via Vite; declared explicitly as a dev dependency
  for this harness's bundle API. No force dependency upgrades; existing full-tree
  18 audit findings were not remediated by this change.

Real microphone/native capture, GUI input dispatch, echo, human accuracy, arbitrary
question quality and performance across other models/providers remain unverified.
This does not establish overall Parakeet parity. The test uses STT credit and LLM
quota; don't occupy the same account's two STT slots with another Meeting.

## Evidence files

- `meeting-live-10min-answers.json`: raw successful output, timings and answer text.
- `meeting-live-10min-answers.log`: command/progress/output.
- `meeting-live-10min-answers-transcript.jsonl` and `-transcript.md`: real storage
  output, synthetic content only; original temporary path in header is historical.
- `meeting-live-10min-answers-source-sha256.txt`: tested-source fingerprints.

API-key leak scan of these artifacts passed. Model verification tickets are never
included in the report. This run did not need a production application-code fix;
the changes add opt-in action coverage to the test harness.
