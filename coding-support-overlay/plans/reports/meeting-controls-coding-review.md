# Overlay 1.0.12 — mic control, readable answer, isolated screenshot coding

## Delivered
- Toolbar mic button, pressed state, red slash, accessible name/tooltip. Controls only Me, remains available during AI work; Others unaffected. State survives collapse/History, resets on a new Meeting.
- Recorder disables audio track, clears local VAD/pre-roll, blocks pending WAV/draft jobs, substitutes zero PCM (including queued frames across a rapid mute/unmute via revision check). Silence preserves realtime timestamps and existing sessions; no reconnect/quota churn.
- Previously uploaded voice may still finalize. This is **mute**, not STT socket shutdown or a billing pause. Does not affect the user's conferencing microphone.
- Answer reserves 300px, content 220px, question preview capped at 72px; Chat/preferences/transcript controls scroll separately. Verified 400×620 with screenshot composer open. Very short windows can still require workspace scrolling.
- Screenshot requests and coding follow-ups skip STT flush/snapshot and exclude Meeting transcript, memory, CV/JD, format and interview chat history. Separate AI context instance prevents reusing cached interview system context. Image presence also forces coding context inside the suggester as defense in depth.
- New image resets coding task/history on success; text follow-ups use only bounded coding history. No implicit image replay. Successful regular Answer returns to normal Meeting context; normal text Chat before an image is unchanged.
- Both history buckets limited to six pairs/18k serialized chars each; cleared at close, never audio exports. Shared model token, vi/en selection, preview/busy/cancel/timeout and owner-bound image lifecycle retained.
- Coding preparation timeout no longer blames STT. Generic waiting text accounts for mic state. Overlay/package lock 1.0.12; Bridge remains 1.0.10. Keys/provider/9Router/.env unchanged.

## Local session/process checks
Before native smoke tests: no overlay main/audio helper/live harness or 5173 listener found. 3799 was Cursor PID 3653. Two Electron-framework matches were Cursor crashpad handlers, not overlay/recording sessions; not killed.

After final tests: zero non-Cursor Electron/capture candidates, no 5173 listener; Cursor PID 3653 still owns 127.0.0.1:3799. No user Meeting was launched or interrupted. This supports no active overlay STT connection on this machine; it does not audit Speechmatics server accounting or retroactively prove when the user's previous session stopped billing.

## Verification
Final combined command, exit 0 (complete output in meeting-controls-coding-validation.log):
```sh
npm run typecheck
npx tsc -p tsconfig.node.json --noEmit
npm test
npm run test:ui
npm run test:quit
npm run test:quit -- --action=close
npm run test:quit -- --action=signal
npm run build
```

- **99/99 tests**, zero failures/skips. Includes existing loopback Bridge/OpenAI synthetic image transport tests, language switching/queues/persistence and new isolation/cache-context/history checks.
- Mic realtime test: 100 noisy synthetic frames while muted all become zero PCM; resume emits nonzero PCM; queued rapid mute/unmute cannot replay voice; stop releases track. Legacy test: muted noisy frames emit no WAV/draft; resume works.
- Controller tests make STT flush, snapshot and memory throw to prove coding never touches them. Empty transcript/summary/brief/format and isolated coding history reach generation; selected token retained. New image clears task; Answer returns to interview profile.
- Suggester tests inject private markers into transcript/memory/CV/format; none occur in coding request/system context. Coding and interview use distinct cached context identities; returning to Answer reuses original interview context.
- UI smoke **ok:true**, no uncaught browser errors: actual React App/MeetingMode; native recorder boundary stubbed. Mute suppresses Me draft, Others continues, survives collapse, works while AI pending, new Meeting unmuted. Actual Chrome worklet separately uses synthetic oscillator.
- 400px fixture assertions: Send reachable through controls scroll, answer >=300px and visible, content >=220px. Reviewed saved fixture docs/visuals/meeting-controls-coding-400px.png; not a real private screenshot.
- Three actual hidden Electron shutdown paths: button, native close and SIGTERM, each exit0, dev/debug ports released and Bridge unchanged. **No audio session** in these smoke tests.
- Build passed, hosted worklet asset retained. No linter script configured. LSP zero reported errors: two confirmed clean, five inconclusive; both full TypeScript checks are the definitive compilation gate.
- Direct-parent code review only; prior delegated-lane infrastructure blocker remains, no independent reviewer claim. Checked privacy boundaries, stale result suppression, mute lifecycle, bounded memory and layout.
- Historical evidence/hashes left unchanged. New manifest covers current touched sources/tests/docs, final log and built main.

## Limits / unresolved validation
No private screenshot/microphone uploaded, paid STT retry or cloud AI call for this task. Native mic-device/echo behavior and real Luna vision accuracy/latency still require consented human tests. Increased timeout/coding focus does not prove provider image support. The mic device remains allocated while its track is disabled, and STT sessions remain open until End/Quit; OS mic indicator may remain visible. Forced OS kill can still bypass cleanup, as previously documented.

## Run
End/Quit any old overlay, then `cd coding-support-overlay && npm start`. Main-process changes require full reopen, not renderer refresh. Existing Bridge 1.0.10 needs no reinstall or settings change.
