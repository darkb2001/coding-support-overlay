# Interview copilot — Parakeet analysis, implementation and evidence

## Scope and method

Static inspection of the installed ParakeetAI 3.9.119 app archive only:
`/Applications/ParakeetAI.app/Contents/Resources/app.asar`.
Read application bundles and worklet, not accounts, tokens, recordings or call history.
No Parakeet backend/native DSP implementation is available from this analysis.
This is pipeline-level evidence, not a claim of whole-product parity.

## Confirmed client behavior

| Layer | Observed Parakeet behavior |
|---|---|
| Audio capture | AudioWorklet, 16kHz, 10ms Float32 frames; default combiner batches five frames (~50ms) |
| Sources | Separate microphone/share transcription sessions; share supports speaker diarization |
| STT config | Enhanced path, partials, `max_delay=1.5`, silence trigger 1s, optional vocabulary |
| Transcript | Confirmed content distinct from replaceable partial content; merge by source/speaker until completed |
| Turn completion | Server EndOfUtterance plus a 3s fallback timer for share/combined entries |
| Manual Answer | Flush audio and force both sources to end their utterance before requesting AI |
| Automatic Answer | Separate detection/trigger state and recheck scheduling; backend algorithm unknown |
| Language/settings change | RESTART replaces recognition client while keeping recorder; buffers/replays frames |
| Transition buffer | Cap equivalent to 30s Float32 audio; code may evict oldest buffered frames |
| Liveness | Warn around 10s and stop around 20s without AudioAdded progress |
| UI | requestAnimationFrame-batched transcript updates |
| DSP | Native AudioProcessor receives mic/share audio; AEC/noise-reduction algorithm unverified |

Relevant bundled identifiers: `useTranscriptionSession`, `useAudioChunkCombiner`,
`useCombinedTranscript`, `initializeSpeechmaticsSession`, `useAiMessages`,
`useSpeechmaticsConnectionWatcher`, `pcm-framer.worklet.js`.

Speechmatics explicitly prohibits changing language via SetRecognitionConfig:
the value must match StartRecognition. A new STT session is necessary, not a new
app/Meeting. Parakeet's restart path is consistent with that API restriction.

## Additional screenshot/chat inspection (3.9.119)

Re-read the installed archive (not profile/history). Renderer SHA256:
`3c5c70505444d685129bdca53c86cdb8391a657841f98925451de47cdd41628c`.

- `ChatScreen` holds text + screenshot array, removable thumbnails, explicit Send,
  Enter/Escape handling. Observed client limits: ten attachments / 4 MiB aggregate
  encoded data; input max comes from a shared limits object.
- `useAiMessages` distinguishes `direct-message` from `analyze-screen`; it adds
  text and JPEG file parts, carries callSessionId and pending transcript, flushes
  unfinished speech for manual requests, streams output and guards stale triggers.
  This shows client transport/context intent, not its private backend prompt.
- Main `renderer/capture-screenshot` checks Screen Recording permission, maps the
  current screen index to a display/source, checks empty thumbnails, bounds image
  to 3840×2160 and encodes JPEG at quality 85. Its missing-screen/source fallback
  may choose primary/first source; we deliberately fail rather than capture a
  different display without the user's expectation.
- We implement one main-owned PNG preview (≤8 MiB, capture box ≤2560×1600), explicit
  Send, typed code and bounded follow-ups using current Meeting state. This is not
  a multi-image/region-selection clone, OCR accuracy result or quality parity claim.

See [implementation, verification and remaining limits](../plans/reports/meeting-chat-screenshot-review.md).

## Implemented in this overlay

- Enhanced default, vi/en dropdown, saved Auto migrates to vi; Melia remains opt-in.
- Visible live language selection, owner/meeting-bound IPC, one switch at a time.
- Drain old recognition, close handshakes, then open replacements; preserve logical
  MeetingSession, transcript, profile, memory, selected LLM and completed answer.
- Continue capture during replacement; 30s/source / 4000-packet transition bound,
  original capture timestamps and ACK/socket-paced replay. Overflow fails visibly.
- The cloud may release quota after socket closure. Retry quota-only NEW-session
  startup at most five times (0.5/1/2/4/4s per rejected source). Keep any ready source;
  no audio sent to rejected sessions. No runtime replay/reconnect guessing/fallback.
- AudioWorklet microphone framing at 50ms, mono, transferable buffers, final short
  frame flush. No ScriptProcessor or WAV queue on the realtime path.
- Self-hosted worklet build asset rather than a data URL blocked by production CSP.
- Enhanced IT dictionary, 1.4s server silence endpoint and 1.5s max_delay.
- Assemble word-level finals into conversational turns, separate partial previews;
  commit on utterance/end/Answer barriers, close and 3s recognition-idle fallback;
  bound monologues at ~30s/~1600 chars. Accepted finals drain after logical close
  without stale UI events; never promote replaceable partials into saved text.
- Flush waits for final audio coverage OR a covering forced boundary. Enhanced can
  round forced boundary timestamps down or suppress duplicate events after an auto
  endpoint; do not assume a one-to-one exact timestamp echo. Silent finals can prove
  audio coverage without adding empty transcript entries. Late earlier boundaries
  cannot complete a newer flush.
- Stream decoded LLM reply text while generation is running, without displaying raw
  transport JSON/incomplete escapes. Cancelled/failed previews are not completed answers.
- Preserve negated experience in bounded local fact memory; compact prompt includes
  opening/latest facts. Word-level chunks no longer consume the context turn budget.
- ACK watchdog (20s) plus 6s/source transient jitter queue and 64KB send window.
  Queue overflow can fail before the watchdog. Answer snapshots include queued
  audio, Stop drains it, send barriers have an 8s deadline; no silent eviction.
  Background throttling disabled; idle power blocker released on stop/failure/quit.
- Latest 300 turns in renderer, 200 main-context turns plus bounded local fact memory;
  full accepted transcript remains on disk/export.
- 9Router/LLM selection, credentials and Cursor Bridge routing unchanged.

## Evidence collected

### Local automated tests

- Real local WebSockets: vi → en → vi; ten repeated switches; old-tail drain;
  quota-rejected startup retries; no audio to rejected sessions; buffered burst;
  close during handshake; stop during switch; overflow; non-quota failure.
- Transport flush tests cover automatic/rounded/late boundaries, final silence
  coverage, idempotence, cancelled startup and the real 8s missing-final deadline.
- Actual worklet source executes in a VM; exact 50ms framing, mono averaging,
  silence and final short frame are asserted.
- Actual Chrome AudioWorklet runs a generated oscillator (no mic permission), emits
  frames and flushes. Production React lifecycle is exercised with fixture APIs.
- UI: pending language-switch state, correct meeting ID, no Auto, completed answer
  retained, streaming preview stays busy, 2000 events render at most 300 turns.
- Accelerated local **60min-equivalent per source**: 144,000 PCM frames,
  230,400,000 bytes, 3,600 turns saved to real JSONL and Markdown export; main context
  remains 200 turns. Latest measured run: ~9.5s wall time; GC-sensitive heap delta
  -3.4MiB. This is NOT a one-hour cloud/CPU/microphone stability test.

### Actual 15-minute live Speechmatics check

`test:meeting-live` uses generated Linh/Samantha speech only, no private capture.
That STT-only run: **15.01min wall-clock**, ~14.90min submitted PCM/source, **151 assembled
turns**, four language replacements (including around minute 5/10), periodic quiet
and Answer-style flushes, both sources, exit 0 and no errors. Heap checkpoint range
19.0–20.4MiB (Node harness, not Electron). Non-switch preview probes: vi 842–1118ms,
en 557–731ms. Switch + catch-up: 4349/8706/9127/4285ms; not instantaneous.

A preceding run failed at 11.07min on the old transport cap; added a bounded jitter
queue and exact-byte delayed-ACK regressions, then restarted the full 15min test.
Another earlier attempt exposed a harness timestamp/freshness assumption. Both
failed logs remain in `plans/reports`, not overwritten or disguised as successes.

Vietnamese technical terms remain inconsistent/poor in this synthetic TTS corpus.
Do not claim perfect IT vocabulary, measured human accuracy or parity from it.
That STT-only mode checks production Node STT code with a bounded accepted-turn
collector, not full Electron capture, production persistence or LLM answers. Separate tests
cover those local lifecycle/persistence paths. Full details, source fingerprints
and measurements: [15min review](../plans/reports/meeting-live-15min-review.md).

Further installed-bundle review confirmed Parakeet's serialized STOP/RESTART,
connection identity guards and terminal save queue with stable IDs, 5s batching,
backoff/retry and stale inFlight reclaim. Its fallback may promote partial text;
we intentionally persist only confirmed text. Cloud-save retries are not blindly
copied to local append-file writes, where a partial append could duplicate text.

### Actual 10-minute check with real Answers

Opt-in `--answers` uses production main IPC/controller code, real Bridge/model
preflight, streamed LLM requests and actual disk persistence in a temporary profile.
It still replaces OS capture/window/IPC transport boundaries; no private capture.

Completed **10.01min**, model `cx/gpt-5.6-luna`: nine primary Answers, **seven
completed**, **two cancelled after their first preview** by language changes;
duplicate Answer rejected, four language replacements, same meeting/model/context,
**101 turns saved/exported**. Successful first previews 3826–7369ms, finals
4937–9021ms (end-to-end, including STT flush). No final errors. GUI mouse clicks,
actual devices, human accuracy and general LLM quality are not covered by this run.
See [10min Answer review](../plans/reports/meeting-live-10min-answers-review.md).

## Reproduce STT and Answer checks

```bash
npm run typecheck
npm test
npm run test:ui
npm run build
npm run test:quit
# Cloud opt-in, generated speech, consumes credit/two sessions:
mkdir -p plans/reports
caffeinate -i npm run test:meeting-live -- --synthetic --minutes=15 \
  --report=plans/reports/meeting-live-15min.json
# Real Answer + two streaming cancellations, current Bridge model, LLM quota:
caffeinate -i npm run test:meeting-live -- --synthetic --answers --minutes=10 \
  --report=plans/reports/meeting-live-10min-answers.json
```

Do not occupy the same limited account's two cloud slots with another Meeting.
The 60min cloud option still exists but is not a requested delivery gate and has
not been run. For actual capture/accuracy confidence, use a consented 15–20min
human mock in the overlay: headphones, mixed technical terms, rapid turns,
silence, collapsed/hidden UI, Answer, language switches and network interruption.
Compare identical audio with Parakeet/Melia before claiming overall parity.

## Remaining limits

- 15min STT and 10min main/Answer synthetic cloud checks passed; a human/full-Electron
  meeting and broad answer-quality comparison remain unverified.
- Free-account replacement latency can be several seconds. Cannot promise seamless
  immediate switching or eliminate vendor quota/region/network delays in client code.
- Same-source overlapping speakers remain difficult. Enhanced diarization is NOT
  enabled merely because the model supports it; this overlay still labels sources.
- Native DSP, echo robustness, semantic question detection, model quality and all
  Parakeet features have not been replicated or independently benchmarked.
- Idle guard does not override lid-close/manual sleep or OS capture restrictions.
- Extended network failures still stop visibly; no lossless offline recovery claim.
  Confirmed buffered turns now commit on close and accepted final writes drain.
  Unconfirmed/in-flight audio, forced quit deadlines and OS kills can still lose data.
- Memory is bounded/extractive, not complete semantic recall of an hour. Full
  accepted transcript on disk does not mean the full transcript is sent per answer.
- Audio leaves the device. Obtain consent and follow interview/recording policies.

Sources: [Speechmatics Realtime API](https://docs.speechmatics.com/api-ref/realtime-transcription-websocket#setrecognitionconfig),
[models](https://docs.speechmatics.com/speech-to-text/models),
[turn detection](https://docs.speechmatics.com/speech-to-text/realtime/turn-detection).
