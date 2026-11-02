# Meeting Copilot — microphone + system audio

## Before each session: model + Test Connection

1. Configure your key and 9Router Base URL once in **Provider Setup**. The default
   gateway URL is `https://9router.darkb-tech.io.vn/v1`; no key is hardcoded.
   The provider screen loads the candidate account's `/models` before verification,
   so you select a model instead of typing its ID. Refresh, loading, empty and
   failed-catalog states are explicit. Non-chat models such as ASR/embeddings are
   excluded. Gemini 3.7 Flash (`gemini/gemini-3.7-flash`), GPT and Codex options
   appear only when the live catalog actually returns them. Review-specific
   models are grouped separately, not advertised as meeting recommendations.
   Catalog membership does not prove generation availability, speed or vision.
2. In Meeting, complete **Thông tin** (JD/CV/context), then **Tuỳ chọn** (language,
   model and answer preferences). The responsive two-step setup is inspired by the
   provided Parakeet references; it does not include unsupported import/auto-answer
   controls. Models come from the live catalog (OpenAI-compatible `/models`, or
   Gemini's paginated model list), never a fabricated list.
3. Click **Test Connection**. This performs a short real streaming generation,
   consumes provider quota, and reports time to the first non-empty text chunk.
   It is not a benchmark of STT + answer latency or answer quality.
4. **Start Meeting** stays disabled until the selected model passes. Changing the
   model invalidates the UI verification. The main process revalidates the opaque
   ticket before starting; the bridge uses that selection for answers until you
   explicitly switch, without overwriting the global Coding model setting.
5. Bridge 1.0.8+ is required. Verification tickets are memory-only, bound to the
   configured credentials/provider URL, and expire after eight idle hours. After
   a bridge restart/key change, Test Connection and reapply the selection; if the
   session has already stopped, test before starting again.
   A passed model test does not replace microphone/system-audio permission or STT setup.

## Switch model during a session

Open **Tuỳ chọn** or click the current model/language chip. Choose another model,
click **Test Connection**, then **Áp dụng model**. Test and validation do not stop
microphone/system capture. A failed test/validation keeps the active model.

Only a validated selection for the still-current meeting is committed. A late
response cannot change a stopped/replaced session; overlapping changes use the
latest request. On success, any in-flight answer is cancelled silently; click
**Answer (⌘⇧M)** again. There is no automatic regeneration or fallback model call.
Transcript, locally extracted memory, JD/CV and format stay intact. A completed
answer remains visible with the model that actually generated it.

The live layout has a compact toolbar, latest-remote-speech strip, expandable
transcript and a large scrollable Markdown answer area with Copy/Clear. Clear
only clears the visible suggestion, not context. Links/images from generated
Markdown are rendered as text, not followed or fetched automatically.

UI-only previews: [details](visuals/meeting-details.png),
[preferences](visuals/meeting-preferences.png) and
[live workspace](visuals/meeting-live.png). These use labelled local fixture data,
not a real model/provider response or an actual recording.

## Session answer pages (overlay 1.0.14)

The answer header has previous/next arrows and a page counter. Each successful
Answer or Chat/screenshot response appends exactly one page (question, full text,
original model). Partial previews are temporary; failed/cancelled attempts never
become saved pages. While pending, back browses completed pages and next can
return to live preview; completion increments the count without stealing an old
page being read. Navigation resets content scroll and Copy feedback.

Clear hides the display but does not delete pages; arrows restore them. Pages
survive collapse and the transcript-History screen. All completed text pages are
retained for this Meeting only, not silently evicted after six turns. No disk,
localStorage, screenshot copy, audio export or cross-session restoration.
End/new Meeting, quit/reload clear the UI history. Backend AI chat memory remains
separately bounded: viewing a page does not send it or change generation context.

## Mic toggle and answer space (overlay 1.0.12)

The toolbar mic toggles only Me. Red slash means muted: the browser audio track
is disabled, stale local VAD/draft buffers are cleared, queued PCM becomes silence.
Silent frames keep the Me/Others timeline aligned. Previously submitted speech
may still finalize. Others, language swaps and AI continue; mute survives collapse
and resets to enabled on a new Meeting. It does **not** close STT sockets or promise
billing stops. Use End + Quit for that. No new permissions/reconnect are needed to unmute.

The answer panel reserves 300px (content 220px minimum), with its own scroll;
question previews cap at 72px. Chat/preferences scroll in the controls region.
Since overlay 1.0.13, expanded transcript is a separate 180px panel with its own
scroll, outside shrinking controls, so opening Chat cannot squash it. If both
transcript and Answer cannot fit, the workspace scrolls instead of shrinking either.
Use full Quit/reopen to load main changes.

Regular Answer sends bounded **confirmed text from both Me and Others**, plus
profile/format, compact memory and Meeting chat history. Latest Others turn labels
the question; up to eight recent Others turns form the question window. Me supplies
context, not the default question. Raw audio is not sent to the answer model. Partial
STT previews are excluded; confirmed snapshot is taken for that explicit click.
Screenshot coding remains isolated from all Meeting conversation context.

## Chat and coding screenshots during Meeting (Bridge 1.0.11, overlay 1.0.15)

**Install Bridge 1.0.11 and reload Cursor** for images plus the UTF-8 stream fix. Upgrade from
`cursor-extension/coding-support-bridge-1.0.11.vsix`; this does not change the key,
9Router URL or global model. Text-only Meeting still works with older compatible
Bridges; image Send explicitly asks for the upgrade instead of silently ignoring it.

- **Chat** opens a multiline question/code field (16,000 chars); **Enter** is a
  newline, **⌘/Ctrl+Enter** sends. It works without a new Others turn.
- **Screenshot** temporarily hides the overlay, captures its display and opens a
  preview. It captures the whole display, not a region/window picker. Review
  sensitive content before **Gửi câu hỏi**; remove or retake. Capture never sends.
  Since 1.0.15 capture times out after 10s; Stop/Quit cancels the wait immediately.
  Restoration/lock cleanup ignores late native results; no automatic retry. Explicit
  Chat/image Send bypasses local mic flush; regular Answer still flushes the mic.
  Bridge 1.0.11 uses UTF-8 streaming decoding for both providers to preserve split
  Vietnamese/emoji/code characters. Install VSIX/reload explicitly, then Test Connection
  before a new Meeting; the app does not force reload during a live session.
  Permission/empty/missing-display/8 MiB overflow errors are visible; no guessing
  another monitor. Hiding before capture is best-effort, not guaranteed exclusion.
- One pending lossless PNG is owned by main, meeting-bound and exposed by opaque ID.
  It stays in memory until Send. A private temporary PNG is used only while the
  existing Bridge reads it, then removed in `finally`; abnormal OS/process kills
  can bypass cleanup. Never publish an entire temporary directory as a workaround.
- Screenshots use the verified Meeting model and selected vi/en with a dedicated
  coding system prompt and separate cached AI context. **No CV/JD, Meeting format,
  transcript, rolling memory or interview chat history** is read/sent; no STT flush
  or snapshot wait. Each new image starts a clean coding task. Text follow-ups use
  only coding-history pairs (no implicit image replay); a successful regular Answer
  returns to the normal Meeting context. Text Chat before an image and regular
  Answer retain profile/format/transcript context. Chat is not spoken/CV evidence;
  the app does not execute code.
- Only the explicit image on that request is sent. For follow-ups needing the
  original image, attach again; textual previous answers may be truncated. Failed
  sends keep draft/preview. Up to six recent pairs / 18k serialized characters are
  kept per context (Meeting versus coding) in memory, cleared at Meeting close;
  chat/image history is not in the audio
  transcript/Markdown export or localStorage. Unsent draft is workspace-local;
  leaving for History/ending/reloading can clear it. Collapse keeps the mounted tree.
- Requires a vision-capable model and the configured **Vision Supported** flag.
  Text preflight/catalog IDs are not proof of vision support. Disabled vision or
  rejected provider requests are explicit; no text-only or model fallback.
- Since overlay **1.0.11**, Chat/image generation has a 180s model-phase cap;
  regular Answer has 60s. Preparation/confirmed transcript has a separate 60s cap,
  with the realtime flush still using its shorter transport deadline. Deadline
  errors distinguish those stages and first-preview progress; Stop/model/language
  cancellation is not misreported as timeout. This does not guarantee a provider
  will finish within the new limit. No auto-retry; audio continues until Meeting ends.
- Answer and Chat share the busy/cancel path. Model/language change or Stop cancels
  in-flight work and suppresses stale finals/history. Bridge disconnect now aborts
  its upstream request; provider accounting may still bill already generated tokens.

[Local test evidence/limits](../plans/reports/meeting-chat-screenshot-review.md) and
[400px fixture preview](visuals/meeting-chat-screenshot-400px.png). This is not a
private-screen cloud or human coding-answer quality benchmark.

## Remembered inputs, window controls and reload

- The white setup has two steps with a left progress sidebar. Company, role, JD,
  CV and additional context are separate fields; their combined text supplies the
  existing Meeting brief. Existing combined briefs are retained in additional context.
- Changes are saved locally as you type. The next launch pre-fills details, answer
  preferences, language, model choice, live-draft setting and opacity. Users can
  edit them again; model verification still must be repeated. Removed model IDs
  are not offered as working options and no verification ticket is restored.
- Provider drafts include the API key in the Electron profile's **unencrypted
  localStorage**, matching the existing persistence mechanism. Successful provider
  verification also stores config in local Cursor settings. Nothing is hardcoded
  into source; neither discovery errors nor model catalogs return credentials.
  Only use a provider URL you trust. HTTPS is required except for localhost gateways;
  redirects are rejected to avoid forwarding keys to another host.
- Drag the top setup header or live toolbar (not buttons/inputs). Setup stays
  opaque for reading. The live panels use background alpha, not whole-window
  opacity: text remains fully opaque and there is no opaque ancestor blocking
  transparency. **Độ đậm** controls 35–100%, default 86%, saved between launches.
- **Thu gọn** reduces the native window to a small bar while keeping the meeting
  running; click the expand arrow on that bar to restore the setup/live size.
  Collapsing hides the existing React tree rather than unmounting it: recording,
  transcript, completed answers and prepared setup selections survive expand.
  If capture stops externally while collapsed, the bar stays small until expanded.
  During a running session, **Tuỳ chọn** still allows model tests/apply and language
  changes without ending the Meeting. Enhanced language changes replace the cloud
  recognition sessions while local capture continues and audio is buffered. Invalid
  selections keep active settings; transport/overflow failure stops capture visibly.
  Language changes retain completed answers and affect new turns only.
  **⌘⇧H** is the separate full-window hide shortcut: press it again or click the
  Dock icon to show the window. **Kết thúc** is different: it stops capture and
  saves the session. **✕ Thoát** is available on setup/provider/coding and the live
  toolbar: it quits the entire application, not merely the window. Quit attempts
  to drain/export queued transcript work for up to five seconds, then releases
  native capture/STT resources even if cleanup fails or hangs. Unfinished speech
  and work beyond that deadline may not be saved; use **Kết thúc** first when you
  need normal full transcript draining. In dev mode, Electron's exit also ends
  electron-vite and releases its listener (normally 5173). Port 3799 is owned by
  Cursor's Bridge, so Quit never kills that server or unrelated processes.
  Transparency does not guarantee exclusion from screen sharing.
- Layout switches size the window for setup/live/coding and clamp it to the current
  display; users can still resize and drag. `npm start -- --hidden` starts without
  showing a window (restore with the shortcut/Dock).
- For the built app, run `npm run build` then `npm start`. Development and built
  renderer origins have separate localStorage; use the same launch mode to keep
  drafts consistent. Moving from one to the other may require entering draft
  inputs once; this does not erase Cursor's provider configuration.
- If `/ping` lacks `verified` or `meetingSessions`, install
  `../cursor-extension/coding-support-bridge-1.0.8.vsix` using Cursor's
  **Extensions: Install from VSIX…**, then **Developer: Reload Window**.
  Reloading just the overlay does not upgrade the Bridge.

## Session input/output language

Use **Ngôn ngữ input / output → Tiếng Việt / English** before or during a meeting.
The preference is saved locally; a saved Auto value migrates to Vietnamese. Explicit
selection overrides brief/format language for new answers. Auto is not offered.

Default Enhanced uses the selected language for BOTH audio sources and answers.
The visible live dropdown switches language inside the same Meeting: drain old
recognition sessions, complete their close handshakes, open replacements, then
replay captured transition audio with backpressure and original capture timestamps.
Transcript, profile, memory and selected LLM survive. Wait for Listening before
speaking when possible. Transition buffers are limited to 30s/source and 4000
packets total. No audio goes to rejected startup sessions. A quota-only startup
retry is bounded (five retries, 0.5/1/2/4/4s per rejected source); ready sources
are retained. Other failures stop visibly, not silently switch models or drop data.
This is not simultaneous Vietnamese-English recognition in Enhanced.

Optional Melia stays multilingual with vi/en hints; the dropdown changes answer
language only. Legacy Whisper/Groq applies selection to subsequent clips. An
in-flight old-language answer is cancelled; failed/cancelled streaming previews
are cleared. Completed answers and existing history are never translated.

## Behavior

- **Me / Tôi** comes only from the microphone.
- **Others / Đối phương** comes only from macOS system audio via ScreenCaptureKit.
  It works independently of the output device, including headphones.
- Source labels separate the user's input from remote audio; they are not voice
  recognition/diarization and do not identify individual remote participants.
- Transcript is collected continuously while Meeting is running. **AI hints are
  generated only when you click Answer / Gợi ý trả lời** (or press **⌘⇧M**). There is no TTS
  or automatic reply.
- The profile field holds the session context: **JD, CV/experience and
  conversation goals/background**. It is stored in localStorage on this device and
  initialized to the Meeting AI session on the first hint. It is sent again only
  if edited or if the bridge session has expired/restarted.
- A separate **Format trả lời** field contains per-turn instructions (language,
  tone, structure, length, etc.). Only this format plus the latest bounded
  transcript is sent on each subsequent hint request; JD/CV is not repeated from
  the overlay to the bridge.
- The model is instructed to combine the brief with transcript: JD defines role
  requirements, CV defines the user's stated experience, and the conversation
  determines the current question. Job requirements or another person's experience
  must not be presented as the user's achievements. Missing/conflicting evidence
  should be acknowledged or clarified, not filled with invented experience.
- The bridge caches session profiles in memory (maximum 16, eight-hour idle TTL);
  restarting Cursor/bridge clears them. Providers with stateless APIs still need
  the cached profile as model context for each answer, so this avoids resending
  JD/CV from the overlay to the bridge, not provider token usage. The profile is
  stored locally without encryption and sent to the configured provider as model
  context; remove unnecessary contact/confidential details and never paste API keys.
- There is no hardcoded What/When/Why/How answer template or 80-word/900-character
  truncation. The provider's generation token budget still applies.
- The response format is sent separately from transcript context. If left empty,
  the app asks for a contextual answer without a fixed format. JSON is only the
  internal transport envelope; its `reply` is displayed as text.

## Requirements

1. macOS 13+, Xcode Command Line Tools (`xcode-select --install`).
2. Microphone permission for Electron/the app.
3. Screen & System Audio Recording permission. Depending on macOS and launch mode,
   the permission entry can belong to Electron, the helper or its terminal/host.
   Grant the prompted entry and restart the app after changing permissions.
4. A Speechmatics API key and credit/quota for **two simultaneous realtime
   connections**, or explicitly selected legacy Whisper/Groq.
5. The Coding Support Bridge extension running in Cursor with an AI API key/model
   configured. The bridge supplies the text hints, not speech recognition.

## Setup

```bash
cp .env.example .env
```

Edit `.env`, enabling one STT option. Do not put shell expressions like
`$(which whisper-cli)` inside `.env`; use absolute paths.

### Speechmatics Realtime (default)

```dotenv
MEETING_STT_BACKEND=speechmatics
SPEECHMATICS_API_KEY=your_own_key
SPEECHMATICS_MODEL=enhanced
SPEECHMATICS_REGION=global
```

The key is loaded only by Electron main; never add it to shared source, renderer
storage, CV/JD or chat. Restart the app after changing `.env`. Only trusted region
names `global`, `eu`, `us`, `au` are accepted, not custom endpoints. Missing key,
invalid config, expired credit, connection loss or bounded-buffer overload fail
visibly instead of switching provider, dropping audio silently or replaying it.

Mic and system audio send continuous 16 kHz mono PCM16LE to separate WebSockets.
They do not wait for WAV clips or share the old sequential STT queue. Partials
are replaceable previews; only confirmed text is persisted and used in hints.
Microphone AudioWorklet transfers 50ms frames and flushes its final short frame.
Enhanced uses server silence endpointing at 1.4s and `max_delay=1.5`. This is NOT
semantic endpointing; a pause can still split a thought. Word-level finals assemble
into turns; a 3s recognition-idle fallback commits confirmed words if an endpoint
is missing. Close also commits confirmed unfinished text; already accepted writes
drain even after logical close, without stale UI events. Monologues are bounded at
~30s/~1600 characters. Partials never enter
persistent transcript or AI context. Answer requests finalization, waits for final
audio coverage (including silent finals) or a covering forced boundary, then waits
for persistence. A detected boundary is not an exact echo of the requested timestamp:
Enhanced may round it down or suppress a duplicate after automatic endpointing.
End sends EndOfStream, waits for EndOfTranscript and completes socket closure.
Quit retains its existing five-second cleanup deadline.

Default **Enhanced** includes a small IT dictionary (TypeScript, React, Node.js,
PostgreSQL, Redis, Docker, Kubernetes, GraphQL, REST API, CI/CD, AWS, GitHub).
No CV/JD is sent to Speechmatics. Optional `SPEECHMATICS_MODEL=melia-1` uses
`language=multi`, vi/en hints, partials and client energy VAD at ~1.4s. It receives
no dictionary/max_delay/server silence settings. Enhanced has no Vietnamese-English
bilingual pack. 9Router/LLM routing, selection and profile flow are unchanged;
LLM reply previews now stream as decoded text, not raw JSON.

A bounded jitter queue holds at most 6s/source when ACK/socket capacity is slow;
only 64KB is allowed in the send window. Answer includes queued audio in its
snapshot, Stop drains it before EndOfStream, and send barriers fail after 8s.
Overflow stops visibly; audio is never evicted. An ACK watchdog also detects 20s
without pending-audio progress (queue limits may fail first). While Meeting runs, Electron prevents idle app suspension
and disables renderer background throttling; stopping/failure/quit releases the
power blocker. This does not override manual sleep, lid-close or OS capture policies.
The renderer retains 300 recent turns and main context retains 200 + bounded local
fact memory; full accepted turns remain in JSONL/export. Memory is heuristic, not
a guarantee that every fact from an hour is present in every AI request.
See [Parakeet analysis, test evidence and remaining limits](parakeet-pipeline-analysis.md)
and [the completed 15-minute cloud check](../plans/reports/meeting-live-15min-review.md).
That run covered Node STT, not LLM. The newer [10-minute Answer check](../plans/reports/meeting-live-10min-answers-review.md)
ran production main IPC, real streamed Bridge/LLM requests and real JSONL/export:
7 completed bilingual answers, 2 planned streaming cancellations, duplicate press
rejected, 101 turns saved. It still uses synthetic capture/window boundaries, not
GUI mouse clicks or a human/full-Electron quality comparison. To repeat (quota):
`npm run test:meeting-live -- --synthetic --answers --minutes=10`.

Both audio sources leave your device for Speechmatics. Obtain consent and follow
interview/meeting recording policies. STT credit is separate from LLM billing;
two continuous streams can cost about twice a single stream. Verify your account's
free-credit expiry/model access and two-session limit. The app does not opt into
model-training discounts; check account settings yourself and avoid enabling
training/data-sharing for confidential interviews.

References: [Realtime protocol](https://docs.speechmatics.com/api-ref/realtime-transcription-websocket),
[models and limitations](https://docs.speechmatics.com/speech-to-text/models),
[pricing](https://www.speechmatics.com/pricing).

### Local speech-to-text (explicit legacy mode)

Set `MEETING_STT_BACKEND=legacy` first. This keeps the previous segmented behavior.

Install `whisper-cpp` and obtain a supported model:

```bash
brew install whisper-cpp
which whisper-cli
which whisper-server
```

Example for an Apple Silicon Homebrew installation (adjust model path):

```dotenv
WHISPER_CLI=/opt/homebrew/bin/whisper-cli
WHISPER_MODEL=/absolute/path/to/ggml-large-v3-turbo-q5_0.bin
MEETING_STT_LANG=auto
```

The app prefers `whisper-server` alongside the CLI when available, then falls
back to the CLI. `WHISPER_SERVER` can override the server path. Audio remains local
for these STT backends. Use the session language dropdown to force vi/en when
auto-detection is poor; no app restart is needed. For a known Vietnamese or
English interview, choose the matching language instead of Auto. Auto re-detects
from each clip, costs additional inference time and can misidentify short/noisy
speech. Auto sends no English glossary; explicit vi/en use a short matching-language
vocabulary hint. This is not a guarantee of correct transcription.

**Silero VAD (recommended for noisy meetings):** place a GGML Silero model in the
app `bin/` folder (`ggml-silero-v6.2.0.bin`) or set `MEETING_VAD_MODEL` to its
path. When present, whisper.cpp applies neural speech detection inside clips;
outer microphone/system segmentation still uses energy thresholds. The app auto-detects `bin/`, `resources/`, `/opt/homebrew/share/whisper-cpp`
and `~/whisper-models`. Download:

```bash
curl -L -o bin/ggml-silero-v6.2.0.bin \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin
```

### Cloud speech-to-text alternative (legacy)

```dotenv
MEETING_STT_BACKEND=legacy
GROQ_API_KEY=your_groq_key
MEETING_STT_LANG=auto
```

Groq receives audio utterances. Default STT model: `whisper-large-v3-turbo`;
`GROQ_STT_MODEL` can override it. Hint generation sends transcript context to the
AI provider configured in the Cursor bridge, regardless of which STT backend is
used. Obtain participants' consent and follow your meeting's recording policy.

### Launch

```bash
npm run dev
# Or:
npm run build
npm start
```

`predev`/`prebuild` compile the helper into `bin/system-audio-capture`. To build it
separately: `npm run build:audio`. A packaged distribution must copy this binary
into Electron's resources directory as `system-audio-capture`, sign it as needed,
and configure the app's macOS permissions. This repo's dev/build workflow does
not create a signed distributable app.

## Usage

1. Join Teams/Zoom/Meet using headphones. Close unrelated music/video playback.
2. Open **Meeting**, choose a model from the provider catalog, click **Test
   Connection**, choose the input/output language and enter your brief/format.
   Only then click **Start Meeting**. Both audio sources must start; permission or
   STT setup failures are reported instead of silently starting a mic-only session.
3. Speak into the mic: transcript should show **Tôi**. Remote audio should show
   **Đối phương**, with the System indicator turning green while sound arrives.
4. Expand the profile field and enter the JD, CV/experience and conversation
   background. This initializes the AI session the first time a hint is requested.
   Profile limit: 32,000 characters.
5. Set **Format trả lời** if you want a per-answer style such as two English
   bullets. Format limit: 4,000 characters; it is sent with each hint request.
6. After the remote question, click **Answer / Gợi ý trả lời**. The app snapshots format
   and transcript, flushes unfinished speech and waits for queued clips. Updating
   the profile starts a fresh AI session on the next hint.
7. Read the text hint. New speech does not automatically regenerate/erase it.
8. **End** closes both sources, drains accepted clips and exports the transcript
   beside the meeting JSONL log. Switching away from Meeting stops capture too.

## Extra capabilities

- **⌘⇧M** triggers Gợi ý trả lời from anywhere while a meeting is running.
- **Lịch sử** opens the stored meetings list: browse the transcript, open the
  exported `.md`, or delete a meeting.
- **Nháp trực tiếp** shows replaceable Speechmatics partials for both sources,
  including while a hint is running. Turning it off hides previews without
  disabling recognition. In legacy mode, only local `whisper-server` provides
  drafts (1.5 seconds voiced minimum, requests at most every 2.5 seconds, skipped
  while final STT or hint is busy).
- **Long-meeting memory**: important turns (decisions, deadlines, action items,
  owners, figures) are extracted locally and injected as a compact summary on each
  hint, so details from early in a long meeting survive the bounded prompt window.

## Limits and troubleshooting

- System capture includes other applications' audio, not just the meeting app.
  It intentionally excludes the overlay process where ScreenCaptureKit supports
  that application filter. No video frames are forwarded or saved by the helper.
- Use headphones to avoid remote speech leaking into the mic. Echo, sidetone,
  mixed/virtual input devices or another person speaking into your mic can lead
  to source labels that do not match the actual speaker. No voice diarization is
  claimed.
- In **legacy mode**, energy-based segmentation can miss quiet/very short speech
  or treat music as speech. Clips finalize after roughly 650ms trailing silence or 8 seconds of
  continuous audio (plus microphone callback granularity), rather than 850ms/15s.
  This reduces buffering delay, not model inference time; forced splits can still
  cut a word. Backlog is bounded and overload is reported, not silently treated
  as a complete transcript. End-to-end latency also includes STT inference and
  queued clips. The STT model is separate from the AI answer model.
- Context in memory is bounded to opening + recent turns; prompts retain recent
  discussion and opening context within a text budget. Very old details from a
  long meeting may not be included in a hint. The complete accepted transcript
  is stored on disk.
- Hint requests time out after 60 seconds. New audio after the click is not
  intentionally included in that request's snapshot. STT/cloud latency means
  transcription and replies are not instantaneous.
- If System remains silent, check the recording permission, meeting output and
  the System indicator. Test with the integration command below. Mic permission
  alone is not enough for system capture.
- Screen-sharing invisibility is a **separate best-effort feature**. The audio
  helper does not make the overlay invisible in Teams/Zoom/Meet.

## Verification

```bash
npm run typecheck
npm test
npm run test:ui
npm run test:quit
npm run build
npm run test:audio
```

`npm test` checks the real PCM segmenter, WAV format, manual flush, context/role
selection, profile/format/language separation, input validation, session-cache
expiry and full-reply preservation. Additional local HTTP fixtures exercise the
production model discovery, streaming probe, credential-bound tickets and start
revalidation (including empty/error streams), atomic live switching, unchanged
context, and stale/concurrent validation rejection. No paid provider is called by the
tests; they do not prove actual STT/AI quality or live gateway latency.
Speechmatics tests use the production client against a local WebSocket server:
ready gating, raw PCM, partial/final reconciliation, forced flush barriers,
EndOfStream sequence and final draining, overload and connection failure. They
never spend cloud credit. Live Vietnamese-English recognition accuracy, account
model availability and end-to-end latency require a real authorized session.

`npm run test:ui` launches headless Chrome using production React components and
explicit local fixture APIs. It checks field/model/format persistence across
reload, repeat-verification gating, model groups, live-switch attribution,
opacity persistence, hide dispatch, drag CSS and 400px overflow/action access.
It writes labelled screenshots to a temporary directory printed in its output;
it does not start real capture or call a paid provider. Chrome defaults to the
macOS application path; set `CHROME_BIN` for another Chrome/Chromium executable.
This test does not prove native window dragging, shortcut registration or actual
screen-share exclusion; verify those on your Mac.

`npm run test:quit` starts the real Electron dev app hidden and clicks the
production Quit button through CDP. It requires port 5173 to be free before the
run (it will not kill an existing app). It verifies successful process exit, both
IPv4/IPv6 dev-port release, debug-port release and that an existing Cursor Bridge
keeps running. It does not start an audio session; shutdown success, save failure
and stuck-task deadline behavior are also covered by unit tests. Dev logs go to
the temporary path printed in the output.

`npm run test:audio` is an explicit macOS integration check: it briefly plays a
system Ping sound, captures PCM via the real helper and prints byte/level/exit
metrics only. No recording is saved. It needs recording permission and may be
audible in your headphones; do not run it during an active meeting.

Finally test a real two-account meeting on each platform: mic should label Me,
remote audio through headphones should label Others, no hints should appear
before a click, and a clicked hint should answer the question using prior context.
Check Stop, restart, tab-switch cleanup and permission denial/revocation too.
