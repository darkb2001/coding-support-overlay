# Meeting reply timeout follow-up — overlay 1.0.11

## Observed vs unknown

User reported image Send showing generic cancellation/timeout after enabling vision.
Live Bridge metadata had already returned `visionSupported: true` and `meetingImages:
true` for `cx/gpt-5.6-luna`. No screenshot, private prompt, settings key or cloud
request was read/replayed for this investigation. No per-request trace/duration from
that failed attempt was available: cannot establish provider slowness, image support,
STT stall or user cancellation as the cause of that particular attempt.

Confirmed code issue: all requests previously shared one 60-second deadline covering
preparation + STT flush + model output. The same error described both actual timeout
and Stop/close cancellation. A thinking/vision request could be stopped by the app
before completing, but increasing the limit is not proof the provider will succeed.

## Fix

- Separate preparation budget (60s) and generation budget: regular Answer 60s,
  explicit Chat/image 180s. Generation budget starts after confirmed snapshot.
  Existing bounded realtime STT flush deadline is unchanged. Total request time can
  exceed the generation budget when preparation takes time; these are not idle timers.
- Abort reasons distinguish deadline from Stop/close/model/language changes. Normal
  cancellation returns `cancelled: true`, not a false timeout error. No stale final,
  incomplete history commit or late Listening status during Stop.
- Timeout result carries stage, budget, elapsed time and decoded-preview presence;
  user error identifies preparation vs model and incomplete vs absent reply text.
  No automatic retry; draft/preview remain for an explicit user decision.
- Unreachable Bridge no longer becomes a misleading missing-vision/capability error.
- Composer explains the 180s model wait and ongoing audio capture until Meeting End.
  Provider checkbox label now explicitly covers Coding + Meeting and explains that
  applying to Bridge requires connection-test/save, not just local draft persistence.
- No model/provider/key/STT changes. Bridge remains 1.0.10; no VSIX reinstall needed.
  Overlay must Quit/reopen to load new main code. Did not force-close user's app.

## Verification

`meeting-reply-timeout-validation.log` contains final command output:

- `npm run typecheck`: pass.
- `npm test`: **98 pass / 0 fail**.
- `npm run test:ui`: `ok: true`, production React with fixture boundaries.
- `npm run build`: pass, overlay **1.0.11**.
- LSP: no findings, 2 confirmed clean / 2 inconclusive; not all paths confirmed.

Regression tests check default 60/60/180s constants with short injected budgets:
preparation does not consume generation allowance, regular Answer uses shorter
budget, model timeout before/after preview, preparation stall before AI, no retries,
no completed history for cancelled output, cleanup/busy release and offline Bridge.
These are local deadline tests, not a 180s cloud-model benchmark. Existing local
HTTP image/context/model transport tests still pass. No paid STT/LLM generation,
private screenshot upload or actual Luna vision-quality test was performed.
Native shutdown code/Bridge were not changed or retested in a second real app
instance while investigating the user's active session; prior evidence is historical.

## Follow-up

Restart only the overlay after ending the current Meeting. If the new stage-specific
error recurs, inspect its stage/budget and whether text appeared before timing out;
provider/gateway behavior then needs a separate consented request trace/test. Do not
blindly retry private screenshots or claim the new timeout fixes backend latency.
