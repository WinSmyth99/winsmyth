# Winsmyth

Player-built social casino. Vite + React + TypeScript, Netlify Functions
for live machine generation, engine as a pure tested module.

## Run locally
```
npm install
npm run dev        # UI only — generation falls back to presets
npm test           # engine regression suite (paytable contracts included)
```
For live generation locally: `npx netlify dev` with `ANTHROPIC_API_KEY` set.

## Deploy (Netlify)
1. Push this repo to GitHub, connect it in Netlify (drag-and-drop does NOT support Functions).
2. Set `ANTHROPIC_API_KEY` in Site settings → Environment variables.
3. Build settings come from `netlify.toml` (build `npm run build`, publish `dist`).

Cost note: public generation runs on your key. The function rate-limits
per IP in-memory (per-instance — not a real quota). Set a spend cap on
the key before sharing the URL widely.

## Structure
- `src/engine/` — pure game engine: four game types, cascades, strips. No DOM. Contracts in `__tests__`.
- `src/generation/` — SYS prompt, validation/clamps (shared with the function), presets, client.
- `netlify/functions/generate.mts` — the API-key proxy.
- `specs/` — Build Loop agent specs live here (design-system spec incoming).

## Engine contracts (do not break)
- Paylines 5-of-a-kind at 300x, bet 2,500 → exactly 450,000 GC.
- Cascade ladder ×1 → ×2 → ×3 → ×5; refills never contain scatters.
- Free spins trigger from the initial drop only.
- The engine decides everything before a frame renders; presentation replays.
