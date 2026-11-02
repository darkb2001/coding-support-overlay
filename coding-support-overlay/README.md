# Coding Support Overlay

Floating always-on-top desktop overlay that captures your screen and sends it to AI for analysis — without switching focus.

## How it works

```
Overlay (Electron) → captures screen
  ↓
Cursor Extension Bridge (localhost:3799)
  → calls AI API (Gemini / OpenAI / DeepSeek / Claude)
  ↓
Overlay displays streamed response
```

---

## Step 1 — Install the Bridge Extension

1. Open **Cursor**
2. Press `Cmd+Shift+P`
3. Type: **"Install from VSIX"**
4. Select:
   ```
   AI-Support-Coding/cursor-extension/coding-support-bridge-1.0.11.vsix
   ```
5. **Reload** Cursor when prompted

---

## Step 2 — Configure AI API

On first launch the overlay shows a white **Provider Setup** screen. Enter your
**API key** and Base URL (9Router defaults to `https://9router.darkb-tech.io.vn/v1`).
The app loads models into a dropdown directly from that provider, before connection
verification. For direct Google Gemini, select **Google Gemini trực tiếp** and leave
**Base URL** empty; the default 9Router URL is only for OpenAI-compatible providers.
Choose a model and click **Kiểm tra kết nối & tiếp tục**.
The app stays locked until verification succeeds.

Provider drafts (including the key) are saved in this Electron profile's
localStorage, **without encryption**; a successful connection also saves config
in local Cursor settings. Nothing is written into shared project source. Avoid
sharing your app profile or pasting keys into JD/CV. Model catalog membership does
not prove availability or vision support; connection tests consume provider quota.

`Cmd+Shift+P` → **"Coding Support: Open Settings"** also works for manual edits.
Reopen the in-app setup anytime via **Settings → 🔑 Provider Setup**.

### For Google Gemini (Free, with vision):

- **Api Key**: `AIza...` *(your key — get one at aistudio.google.com/apikey)*
- **Provider**: `gemini` *(or leave as `auto`)*
- **Model**: `gemini-2.5-flash` *(default, supports vision)*
- **Vision Supported**: `✓` *(checked)*

### For other providers:

<details>
<summary>OpenAI GPT-4o</summary>

- **Api Key**: `sk-...` *(from platform.openai.com)*
- **Provider**: `openai`
- **Model**: `gpt-4o`
- **Vision Supported**: `✓`
</details>

<details>
<summary>DeepSeek</summary>

- **Api Key**: `sk-...` *(from platform.deepseek.com)*
- **Provider**: `openai` *(DeepSeek uses OpenAI format)*
- **Model**: `deepseek-chat`
- **Vision Supported**: `☐` *(text-only)*
</details>

<details>
<summary>Anthropic Claude</summary>

- **Api Key**: `sk-ant-...` *(from console.anthropic.com)*
- **Provider**: `openai` *(Claude SDK uses OpenAI format via proxy)*
- **Model**: `claude-3-5-sonnet-20241022`
- **Vision Supported**: `✓`
</details>

---

## Step 3 — Run the Overlay

```bash
# From the repository root:
cd coding-support-overlay
npm run dev
```

The overlay appears and shows connection status. If connected, you'll see the model name.

---

## Usage

| Action | Shortcut / Button |
|--------|-------------------|
| Capture screen + ask AI | Click **Coding Support** or press **⌘⇧S** |
| Thu gọn thành thanh nhỏ | **Thu gọn** → bấm mũi tên để mở rộng |
| Ẩn hoàn toàn / hiện lại | **⌘⇧H** |
| Thoát hẳn ứng dụng | **✕ Thoát** (not the Hide button) |
| Quit the entire app | **✕ Thoát** (not the Hide button) |
| Follow-up question | Type in input box, press **Enter** |
| Reset chat session | Click reset icon (↺) |
| Customize default prompt | Click settings icon (⚙) |

---

## Meeting Copilot: microphone + system audio

On **macOS 13+**, Meeting mode captures two separate sources:

- Microphone → **Tôi / Me**.
- Native ScreenCaptureKit system audio → **Đối phương / Others**, including when
  the meeting plays through headphones. No BlackHole/loopback device is required.

### Thiết lập STT key qua .env

Mỗi người dùng tự cung cấp key Speechmatics; app không có key STT hardcode/dự phòng.
Tại thư mục `coding-support-overlay`, tạo file cấu hình nếu chưa có:

```bash
# Không ghi đè .env đã có key/cấu hình của bạn.
[ -f .env ] || cp .env.example .env
chmod 600 .env
```

Mở `.env` bằng editor, điền key của bạn vào `SPEECHMATICS_API_KEY` (không cần
nhập LLM key vào đây; LLM vẫn cấu hình trong Provider Setup). Giữ các giá trị mặc
định dưới đây trừ khi bạn muốn chọn backend/region khác:

```dotenv
MEETING_STT_BACKEND=speechmatics
SPEECHMATICS_API_KEY=your_own_key
SPEECHMATICS_MODEL=enhanced
SPEECHMATICS_REGION=global
```

Sau khi sửa, **Kết thúc Meeting → Thoát overlay → mở lại bằng `npm start`**.
Chỉ refresh giao diện không nạp lại `.env`. Không gửi file này khi zip/chia sẻ app.

Git ignore `.env` và `.env.*`; chỉ `.env.example` với key trống được phép commit.
Trước khi push, kiểm tra `git status --short` và `git diff --cached`; không dùng
`git add -f` để thêm file chứa key. Nếu `.env` từng được track, cần
`git rm --cached -- .env` (giữ file trên máy). Nếu key từng được push, phải thu hồi/
đổi key và xử lý lịch sử Git; thêm `.gitignore` không xoá secret đã lộ.

Keep the key in `.env` only, never in chat, source or renderer storage. Audio from
both sources is sent continuously to Speechmatics over separate WebSockets
(two concurrent sessions; check your account's quota/credit expiry). The key stays
in Electron's main process. Enable Microphone and Screen & System Audio Recording
permissions, then start Meeting. There is no silent local fallback if the key or
connection fails. For the old segmented Whisper/Groq path explicitly set
`MEETING_STT_BACKEND=legacy`.

Enhanced is the default: choose **Tiếng Việt / English** for recognition and answer
language. Change the visible live dropdown without closing the app or ending the
Meeting. The app drains old STT sessions, opens replacements and replays bounded
transition audio; wait for Listening before speaking in the new language when possible.
The selection applies to **both sources**, not a different language for each person.
Switching can take several seconds, especially under the two-session quota; it is
not an instantaneous bilingual model. Auto is not offered; saved Auto becomes Vietnamese.

Microphone capture uses **AudioWorklet / 50ms PCM frames**, not ScriptProcessor.
Enhanced uses `max_delay=1.5`, server silence endpointing at 1.4s and a small IT
dictionary. Word-level finals are assembled into turns before persistence/AI; partials
remain replaceable previews. Long monologues split at ~30s or ~1600 characters.
Answer waits for confirmed coverage and streams decoded LLM text as it arrives.
Optional `SPEECHMATICS_MODEL=melia-1` stays multilingual with vi/en hints; its dropdown
controls answer language and client VAD supplies endpointing. It does not accept
Enhanced-only dictionary/max_delay settings. No accuracy/latency guarantee is implied.
The native audio
helper builds automatically before `npm run dev` / `npm run build` (requires Xcode
Command Line Tools).

Before starting a Meeting, select a model loaded from your configured provider or
9Router, then click **Test Connection**. Start is enabled only after a real
streaming test succeeds; changing the model requires testing again. The selected
model is separate from Coding's global default. During the session, open
**Tuỳ chọn → choose model → Test Connection → Áp dụng model** to switch without
restarting audio. Failed tests keep the previous model; successful switches cancel
only the in-flight answer, keeping transcript/JD/CV. Completed answers retain
their original model label. Choose
**Tiếng Việt / English** for input/output. Optional Melia keeps bilingual STT
throughout; legacy backends apply the selection to STT too. Existing history is
not translated. The live view retains only the latest 300 turns; the full accepted
transcript is saved to JSONL/export. A power guard and disabled background throttling
protect idle/hidden meetings, but do not override manual sleep or lid-close.
A bounded 6s/source jitter queue absorbs short ACK stalls; Answer/Stop drain the
accepted audio boundary instead of ignoring unsent frames. Confirmed unfinished
turns survive logical close; partials do not become saved transcript.
See [implementation evidence and limits](docs/parakeet-pipeline-analysis.md) and
the [actual 15-minute synthetic cloud check](plans/reports/meeting-live-15min-review.md)
(15.01min, 151 turns, no final errors; STT-only) and the
[10-minute check with real Answers](plans/reports/meeting-live-10min-answers-review.md)
(7 streamed finals, 2 planned streaming cancellations, 101 turns saved; synthetic
main-process test, not GUI/device/human-accuracy validation).
To repeat with real Bridge/LLM calls (consumes quota; no private capture):
`npm run test:meeting-live -- --synthetic --answers --minutes=10`.
The test uses the current verified Bridge model; optional `--answer-model=ID` tests
another model for this isolated session without changing the global selection.
The test uses provider quota and reports first-text latency, not full-call latency.

Setup uses two white screens, **Thông tin → Tuỳ chọn**, followed by a compact,
dark translucent live toolbar and a large answer panel based on the supplied
references. Company, role, JD, CV, context, answer format, language, model choice
and opacity are remembered locally. Verification tokens are never persisted.
The live footer adjusts opacity (35–100%, default 86%); drag the top bar to move.
Click **Thu gọn** to reduce the app to a small bar; click the expand arrow on that bar to restore the layout.
Use **⌘⇧H** only when you want to hide the entire window; press it again or click the Dock icon to show it without ending the session.
**✕ Thoát** quits Electron entirely after bounded meeting cleanup (up to 5 seconds
for queued transcript work). In dev mode this also releases Vite's port, normally
5173. Port 3799 belongs to the Cursor Bridge and is intentionally not stopped.
See the [UI fixture previews and live-switch guide](docs/meeting-copilot.md).

Click **Answer / Gợi ý trả lời (⌘⇧M)** after a question. The app flushes unfinished speech,
waits for clips already queued, and uses both speakers' conversation context to
produce **text only**. Use the session profile field for your **JD, CV/experience
and conversation background**; it initializes the AI session on the first hint and
is only resent if changed or the bridge session expires. A separate **Format trả
lời** field (language, structure, tone, length) is sent with each hint. Recent
transcript is also sent each turn. The bridge caches session context in memory;
stateless AI providers still receive that context each generation, so this avoids
repeating JD/CV from the overlay to the bridge, not provider token usage. Profile
is saved locally (32,000 chars max), format can change per hint (4,000 chars max).
There are no automatic hints or TTS.

Source labels are not voice identification: system audio includes other apps,
so close unrelated audio and use headphones to avoid mic bleed/echo. See
[setup, limitations and verification](docs/meeting-copilot.md).

---

## Meeting: Chat + screenshot for coding questions (1.0.10)

Install **`cursor-extension/coding-support-bridge-1.0.11.vsix`** with Cursor's
**Extensions → Install from VSIX**, then **Developer: Reload Window**. Existing
provider/key/9Router settings stay unchanged. Old Bridge versions still handle
text Meeting answers but do not support Meeting image attachments.

While Meeting runs:

1. **Chat** → type a question or paste multiline code (16,000 characters max).
2. **Screenshot** → capture the display containing the overlay and open a preview.
   This captures the whole display, not a selected region/window. Review private
   content; remove or retake as needed. It does **not** send automatically.
3. Click **Gửi câu hỏi** or **⌘/Ctrl+Enter**. Enter alone inserts a newline.
   Image-only requests are allowed. Since overlay **1.0.12**, screenshots use the
   selected Meeting model/language but a **coding-only context**: no CV/JD, answer
   format, transcript, Meeting memory or interview chat history. No STT flush is
   needed. Each new image starts a fresh coding task.
4. Ask follow-ups in Chat. Only explicitly attached images are sent for that turn;
   attach again if the next question needs the original picture. Failed sends keep
   the draft/preview. After an image, text follow-ups use only bounded coding
   history until a regular **Answer** succeeds (which returns to Meeting context).
   Text questions work even before Others has spoken.

Use a model supporting vision with **Vision Supported** enabled in Provider Setup.
Catalog membership/text preflight does not prove image support; provider errors
are surfaced, never silently downgraded to text-only or another model.
One preview is held in memory (PNG, ≤8 MiB); only Send creates a private temporary
file for the existing Bridge protocol, deleted after success/failure. Chat/answer
memory is bounded and not saved to the audio transcript/export. No code is executed
or test result claimed by the app. Follow recording/interview consent policies.

Original 1.0.10 validation: **95 tests**, UI/HTTP synthetic image transport, build and three actual
Electron shutdown paths passed. No private-screen cloud upload or paid STT run was
performed for this change; model vision accuracy still needs a consented real test.
See [evidence and limits](plans/reports/meeting-chat-screenshot-review.md).

**1.0.11 timeout fix:** Chat/image generation now gets up to **180 seconds after
preparation**, regular Answer up to 60 seconds. Preparation has its own 60-second
cap (the realtime STT flush retains its shorter transport deadline). Stop/language/
model cancellation is no longer labelled as timeout; deadline errors identify
preparation versus model and whether any decoded preview arrived. No auto-retry,
no model/provider change. Audio continues until Meeting ends. Full app Quit/reopen
is required for main-process changes, not just page reload. Verification at 1.0.11:
**98 tests**, typecheck, UI smoke and build passed; no new cloud request. See
[timeout report](plans/reports/meeting-reply-timeout-review.md).

## Mic toggle and readable answers (overlay 1.0.12)

Click the **mic icon** on the Meeting toolbar to mute/unmute only **Me**. Muted
shows a red slash; Others, selected model and transcript keep running. The audio
track is disabled and outgoing mic PCM is replaced by silence, preserving the
realtime clock. Pending local voice/drafts are discarded; audio already sent may
still finalize. Muting does **not** close either STT connection or guarantee lower
billing; use **Kết thúc**, then **Thoát** to end capture and close the app. A new
Meeting starts with mic enabled. Mute survives collapse and remains usable during AI generation.

The suggestion panel has a **300px minimum height**, with at least **220px** of
scrollable answer content. Chat/preferences/transcript scroll separately; long
question previews are capped at 72px so they cannot consume the answer area.
Since **1.0.13**, expanded transcript has a separate **180px** minimum-height panel
with its own scroll outside Chat controls. Small windows scroll the workspace
rather than squash transcript or Answer. Regular Answer uses confirmed text from
**both Me and Others**, with the latest Others question as the focus; Me is context.
Screenshot coding still excludes Meeting conversation.
Overlay 1.0.12 needs full Quit/reopen; Bridge stays 1.0.10, no reinstall/key change.
Verification: **99/99 tests**, both TypeScript projects, UI smoke, build and all
three actual Electron shutdown paths passed. No new cloud/private capture test.
See [review and evidence](plans/reports/meeting-controls-coding-review.md) and
[400px local fixture](docs/visuals/meeting-controls-coding-400px.png).

## Answer pages during Meeting (overlay 1.0.14)

Each successful Answer or Chat/image response becomes a saved text page. Use
**← / →** beside the answer header, with **1 / N**, to revisit its question,
response and original model. Streaming is one temporary preview, not many pages.
You can browse previous pages while generation runs; new chunks/finals do not
steal the page you are reading. Failed/cancelled previews are discarded without
deleting completed pages. Copy copies the displayed page; Clear only hides it
(use the arrows to restore it).

Pages survive collapse, transcript History and live model/language changes.
They exist only in renderer memory for the current Meeting: End/new Meeting,
app quit/reload clears them. No screenshots are stored with pages. This viewer
does not expand the model's bounded chat context, replay images, or send all
saved pages to AI. It is not a persistent/exportable answer archive.
See [validation](plans/reports/meeting-answer-pages-review.md).

## Screenshot bug fixes (overlay 1.0.15 + Bridge 1.0.11)

- Explicit Chat/image Send no longer awaits local mic flush. Regular Answer still
  flushes it; normal Meeting text Chat still uses main's confirmed context snapshot.
- Capture has a **10-second** deadline and Stop/Quit cancellation. A still-open
  overlay is restored and the capture lock released on failure. Late native
  results are ignored, never replace a newer preview. No automatic retry/upload.
  Electron's underlying native capture promise is not forcibly cancelled.
- Bridge 1.0.11 preserves Vietnamese/emoji/code across split UTF-8 stream chunks
  for both OpenAI-compatible and Gemini providers.

End Meeting and Quit/reopen overlay, install
**cursor-extension/coding-support-bridge-1.0.11.vsix**, then explicitly run
**Developer: Reload Window** in Cursor. Reload cancels in-flight work/verification;
Test Connection again before the next Meeting. Keys, 9Router URL and model settings
are not intentionally changed by this upgrade. Nothing is auto-installed/reloaded.
Earlier 1.0.12/1.0.14 reports above are historical; the Bridge upgrade is needed for
this new streaming fix. See [validation](plans/reports/screenshot-fixes-review.md).

## Sharing this source on GitHub

The repository-root and component `.gitignore` files exclude local `.env` files,
dependencies, builds, VSIX installers, logs, app profiles, recordings and imported
screen references. Only `.env.example` with empty key fields is intended to be
committed. Do not use `git add -f` on ignored/private files. Previously tracked
secrets are not made safe by `.gitignore`: untrack them, rotate exposed keys and
clean history before publishing.

For a fresh source checkout, build the local Bridge installer first:

```bash
cd cursor-extension
npm ci
npm run package
cd ../coding-support-overlay
npm ci
# Follow the .env setup above, install the generated VSIX and verify the model.
npm run dev
```

Original imported screenshots were removed; documentation visuals use synthetic
UI fixtures instead. Shareable test evidence has personal machine paths redacted.
Historical SHA256 manifests refer to pre-redaction originals, not current copies;
see [evidence provenance](plans/reports/README.md). Private originals are archived
outside the source tree, not intended for publication. Generated native binaries
are local-only: Git ignore does not make a zip of the whole working directory safe.

Before pushing, review `git status --short`, `git diff --cached --stat` and
`git diff --cached`. Enable GitHub secret scanning/push protection where available;
this cleanup is not an absolute guarantee against every possible secret.

## Screen-sharing privacy (best-effort)

The overlay enables Electron content protection before its first visible frame,
then reapplies it on show, restore and page load. The optional macOS native addon
also sets `NSWindowSharingNone`; if it is missing or throws, built-in protection
is still attempted. These use the same underlying macOS sharing hint, not two
independent protection mechanisms.

**This does not guarantee invisibility in Teams, Zoom or Google Meet.** Modern
macOS capture apps using ScreenCaptureKit can capture the overlay despite these
flags. A successful native-addon log only confirms the sharing hint was applied,
not that another app respects it. See [Electron's documented limitation](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows).

- Prefer sharing a specific window/tab, or keep the overlay on a display you are
  not sharing. Verify the selected source before sharing sensitive content.
- Press **⌘⇧H** to hide the overlay entirely (it also disappears from your view).
  Minimizing or lowering opacity is **not** equivalent to hiding it.
- Protection is not automatic screen-share detection; no private APIs are used.

### Verify with each meeting app

1. Launch the overlay with `npm run dev` or rebuild with `npm run build` and use
   `npm start`. Join Teams/Zoom/Meet from a second account/device.
2. Observe the **receiver's video**, not only the local share preview. Test full
   display sharing, separate-window sharing, and browser-tab sharing where offered.
3. Check Coding, Meeting, settings, annotation and minimized layouts. Also check
   startup while already sharing, reload, and hide/show via **⌘⇧H**.
4. If the overlay is visible, hide it or switch to an unshared display or a
   verified window/tab source. Repeat after macOS or meeting-app updates.

Build/type checks do not verify actual capture exclusion. This requires manual
receiver-side testing on your Mac and the installed meeting-app versions.

---

## macOS Permissions

On first capture, macOS will ask for **Screen Recording** permission:

> System Settings → Privacy & Security → Screen Recording → enable **Electron** (or the app name)

After granting, restart the overlay.

---

## Troubleshooting

### "Cannot connect to Coding Support Bridge"
- Check Cursor's status bar for `⚡ Bridge :3799`
- If offline, click it to restart
- Ensure no other app is using port 3799

### "API key not configured"
- Open Cursor Settings → search "codingSupport"
- Verify API key is entered correctly (no spaces)

### Gemini "404 model not found"
- Model name must be without `models/` prefix in settings
- Use `gemini-2.5-flash` not `models/gemini-2.5-flash`
- Extension adds the prefix automatically

### Screen capture fails silently
- Grant Screen Recording permission (see above)
- Restart overlay after granting permission

---

## Architecture

```
coding-support-overlay/          ← Electron app
  src/main/
    index.ts                     ← window, IPC, shortcuts
    screenshot.ts                ← desktopCapturer
    cursor-agent.ts              ← HTTP client → :3799

cursor-extension/                ← Cursor extension
  src/extension.ts               ← HTTP server + AI API calls
  coding-support-bridge-*.vsix   ← install file
```
