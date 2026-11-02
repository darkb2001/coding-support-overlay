# Public-source privacy cleanup

## Scope and changes
- No runtime/provider/model/key changes. Overlay remains 1.0.15, Bridge 1.0.11.
- Added repository-root `.gitignore` and `cursor-extension/.gitignore`; expanded overlay ignore rules. Protect local env variants, dependencies, builds, VSIX/native binaries, local app data, screenshots/recordings, logs and the independent nested toolkit checkout. Empty `.env.example` templates remain includable.
- Inspected and removed four imported `image-prefer` screenshots/photos: reference material with captured desktop/workspace background, not runtime app assets. No source link depended on their filenames. Removed root `.DS_Store`.
- Removed eight generated native build intermediates with machine-local build metadata. Kept `build/Release/hide_capture.node`, compiled overlay/Bridge, local installers and downloaded model/runtime assets for local functionality; Git excludes them.
- Replaced the personal absolute README launch command with repository-relative commands. Added fresh-checkout build and Git-sharing guidance.
- Redacted home/project/temp prefixes in nine evidence artifacts (eight logs and one synthetic transcript JSONL). Verified the resulting bytes equal only those path substitutions; transcript still parses as 102 valid JSONL records. No test outcome or transcript speech changed.
- Original affected text artifacts (including README) preserved outside the source tree under `~/.local/share/coding-support-overlay/private-audit/`, restricted directory access. No `.env` copy made. Historical fingerprints remain original; current sanitized evidence is covered by a separate shareable manifest. See reports/README.md.
- Reviewed documentation visuals: app UI fixture images are synthetic, retained; the two other staged PNGs are toolkit favicons, not private captures.

## Security verification
- Virtual Git stage created in an external temporary repository/index, with the current source as its work tree. Did **not** initialize the real project repository, commit, push or change a real index/history.
- `git add --all` simulation: **1,246 staged files**, including **1,173 UTF-8 text blobs** and 8 image files at that point. Later additions are this public review/manifest. No nested gitlink, env secret file, dependency/build/output/installers/native/model/runtime-capture category staged. `.env.example` remains staged/includable.
- Read exact staged Git blobs (not just paths): zero current local env-key matches; zero known owner identifier or machine-specific macOS temp prefixes. Credentials compared only locally; no values printed/transmitted.
- Inspected all 12 existing VSIX ZIP contents: no current local env-key or owner-identifier match. They remain ignored local installers, not published source.
- Earlier secret-pattern hits in toolkit docs/demo and test fixtures are explicit examples/test data, not the current personal key. Kept useful tests/docs instead of deleting reusable functionality. Pattern checks do not prove absence of every unknown credential format.
- Confirmed `.env` bytes match the pre-cleanup local fingerprint. No key/provider/Cursor config or user app profile changed.
- This is current-work-tree/source-sharing verification, **not** an audit of previously published Git history, private local app profiles or independent nested toolkit history. Ignore rules do not protect force-adds or an indiscriminate zip of the working directory. Rotate any previously published credential.

## Application regression checks
All exit0; sanitized output in `privacy-cleanup-validation.log`, raw local output kept outside source:

```sh
# coding-support-overlay
npm run typecheck
npx tsc -p tsconfig.node.json --noEmit
npm test
npm run test:ui
npm run build
# cursor-extension
npm run compile
```

**108/108 tests pass**, zero failures/skips; production React UI smoke, both TypeScript checks, overlay build and Bridge compile pass. Existing session pages, screenshot, STT queues, mic controls and context tests retained. No paid STT/cloud generation or private-screen upload. Native shutdown not rerun for docs/ignore/artifact cleanup. No active user Meeting stopped/reloaded. No lint script configured. Direct-parent review only; no independent reviewer claim.

## Publishing
Review `git status --short`, `git diff --cached --stat` and `git diff --cached` before the first real push. Build the ignored Bridge installer locally when cloning source. Enable GitHub secret scanning/push protection where available. Do not publish local private audit originals or `.env`; do not assume generated binaries/zipped folders are anonymized simply because Git ignores them.
