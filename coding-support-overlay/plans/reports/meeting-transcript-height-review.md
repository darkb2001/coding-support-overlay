# Overlay 1.0.13 — transcript minimum height

- Request: readable expanded transcript and explain which speaker Answer sends.
- Changed `MeetingWorkspace.tsx`: expanded transcript now sits outside shrinkable Chat/preferences controls, before the answer panel.
- CSS: transcript flex basis/minimum/maximum 180px, no shrinking, its own vertical scrollbar. Answer retains 300px minimum. Constrained windows scroll the whole workspace instead of squashing either panel. No recording, model, context or provider logic changed.
- UI regression: at 400×620, transcript with long history + Chat open remains >=180px, scrolls internally, is outside controls; Answer remains >=300px. Synthetic UI screenshot manually inspected. No private screen capture or cloud request.

## Answer behavior (verified source, unchanged)
`meeting-reply.ts` flushes STT and snapshots confirmed turns from both Me and Others. Latest Others turn labels the question; `suggester.ts` includes bounded both-speaker context, opening turns, compact memory, brief/JD/CV, response format, bounded Meeting chat history and up to eight recent Others turns in QUESTION_WINDOW. Me supplies conversation context, not the default question. Partial STT text is not used as confirmed context. Raw audio goes to STT, not the Answer model. Screenshot coding uses the separate isolated context introduced in 1.0.12.

## Final verification
All commands exit 0; full output: `meeting-transcript-height-validation.log`.

```sh
npm run typecheck
npx tsc -p tsconfig.node.json --noEmit
npm test
npm run test:ui
npm run build
```

99 tests / 99 pass / 0 failures. UI smoke ok:true. LSP: zero errors reported, two files confirmed clean, one inconclusive; full TypeScript checks passed. No lint script configured. Native shutdown was not re-run for this renderer/CSS-only change; previous 1.0.12 evidence remains historical. Direct-parent review: checked hierarchy, no shrinking, existing Chat/Answer minimum sizes and small-screen workspace-scroll fallback; no independent-review claim.

Version/package-lock 1.0.13; Bridge remains 1.0.10. Existing key/9Router/provider/STT settings untouched. Restart overlay to load rebuilt renderer; no Bridge install/reload needed. Live device capture, real cloud answer quality and cloud billing were not tested in this change.
