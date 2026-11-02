# Shareable validation evidence

These reports describe tests performed at specific historical source versions;
they are not promises that every historical source hash matches the current tree.

## Privacy redaction

During source-sharing cleanup, machine-specific home/temp prefixes in nine raw
logs/transcript artifacts were replaced with `<PROJECT_ROOT>/`, `<HOME>/` or
`<TMPDIR>/`. Test outcomes and transcript text were not changed. README commands
now use repository-relative paths. Imported reference screenshots were removed;
`docs/visuals` contains synthetic UI fixtures, not private screen captures.

Original affected text artifacts were preserved locally outside this source tree
under `~/.local/share/coding-support-overlay/private-audit/`, with restricted
access and original checksums. They are not included in Git or meant to be shared.
No `.env` or credential copy was made into that archive.

Existing dated SHA256 manifests refer to the original, pre-redaction artifact
bytes/source versions. They were deliberately not rewritten to imply otherwise.
Use `privacy-cleanup-shareable-sha256.txt` for the current sanitized evidence copies.
Logs remain ignored by default; the manifest includes local sanitized log copies
which are not shipped in an ordinary Git source checkout.
Future builds/tests may produce new local machine paths in ignored output/logs;
review and redact any artifact before deliberately publishing it.

Git ignore protects ordinary Git adds, not `git add -f`, previously committed
secrets, or a zip of the entire working directory. Never publish your local app
profile, `.env`, raw recordings/screenshots or the private audit archive. If a
credential was previously published, rotate it and remove it from history.
