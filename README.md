# Coding Support Overlay

Floating always-on-top overlay for coding support + meeting hints. Uses your own AI API key (Gemini / OpenAI / DeepSeek / …) and optional Speechmatics STT key — nothing secret is committed to this repo.

## What’s in this repo

| Folder | Role |
|--------|------|
| [`coding-support-overlay/`](./coding-support-overlay/) | Electron overlay app |
| [`cursor-extension/`](./cursor-extension/) | Cursor/VS Code bridge (`coding-support-bridge`) |

Full setup: see [`coding-support-overlay/README.md`](./coding-support-overlay/README.md).

## Quick start (trial)

1. **Build & install the bridge**
   ```bash
   cd cursor-extension
   npm install
   npm run compile   # or your package build script
   # Cursor: Cmd+Shift+P → “Install from VSIX” → pick the generated .vsix
   ```
2. **Run the overlay**
   ```bash
   cd coding-support-overlay
   cp .env.example .env
   # Optional Meeting STT: put YOUR Speechmatics key in .env (never commit .env)
   npm install
   npm run dev
   ```
3. On first launch, paste **your** AI API key in Provider Setup and verify connection.

## Secrets policy

- Commit only `.env.example` (empty keys).
- Local `.env` is gitignored — each user brings their own keys.
- AI keys live in the app setup / Cursor settings, not in source.
