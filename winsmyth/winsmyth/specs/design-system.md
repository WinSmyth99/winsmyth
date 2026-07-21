# Winsmyth Design System
### specs/design-system.md — the constraint set for all UI work

**Who this binds:** every change to `src/` UI code, whether authored by a
human or by the Build Loop (RSI) agent. This spec is why output stops
being "basic": generic happens when there is nothing to build against.

**Reference bar:** the Vice synthwave slot-branding reference (chrome
block lettering, neon script overlay, magenta-violet sunset, palm
silhouettes, confident glow). Every screen should look like it belongs
in that world. When in doubt, ask: *would this component look at home on
a neon sign on Ocean Drive at midnight?*

---

## 1. Mandatory workflow (the part that actually fixes quality)

Any agent or contributor making UI changes MUST, in order:

1. **Load** this spec and `src/styles/tokens.css` before writing code.
2. **Build** against the tokens — raw hex values in component code are a
   rejection (§6).
3. **Self-critique** the result against §6 before opening a PR. State in
   the PR description which checklist items were checked and how.
4. **PR gates:** CI runs typecheck + the engine regression suite. Style
   changes to signature elements (§4) additionally require before/after
   screenshots in the PR.

Skipping step 1 is how output regresses to the generic average. It is
not optional.

## 2. Tokens (source of truth: `src/styles/tokens.css`)

| Role | Var | Value | Use |
|---|---|---|---|
| Base | `--bg` | `#120826` | Page ground. Never pure black. |
| Raised | `--bg2` → `--card2` | violet ramp | Surfaces, one step per elevation |
| Border | `--border` / `--border2` | `#45247A` / `#5C33A0` | 1px default / emphasis |
| House neon | `--highlight` | `#FF3DA5` | THE accent. Interactive emphasis, script text |
| Electric | `--accent` | `#9D5CFF` | Secondary neon, gradients with highlight |
| Win | `--win` | `#3DE8FF` | Wins, anticipation, live states — nothing else |
| Coin | `--gc-primary` | `#FFB13D` | GC amounts, jackpot tier — nothing else |
| Text | `--text` / `--muted` / `--muted2` | lavender ramp | Copy hierarchy |
| Machine | `--mc` | per-machine | Set inline from `slot.color`; cabinet lighting |

**Colour rules:** semantic vars only — a component never invents a hex.
Cyan means win/live; amber means coin value; pink is the house voice.
Crossing those meanings is a rejection.

## 3. Type

| Face | Var | Role | Rules |
|---|---|---|---|
| Anton | `--font-display` | Display: wordmark, headings, machine names | Weight 400 ONLY (single-weight face — synthetic bold is a rejection). Letter-spacing .04–.06em. Chrome-gradient fill on hero-level text. |
| Yellowtail | `--font-script` | Neon script: taglines, one accent per view | Never for body or UI labels. Max ONE script element per view — script everywhere reads as a party invitation. |
| Outfit | `--font-body` | All body copy, buttons, cards | 400–800 |
| Chakra Petch | `--font-mono` | The machine voice: amounts, bets, badges, tags | `font-variant-numeric: tabular-nums` on anything that counts up. |

The **block + script pairing** (Anton over Yellowtail) is the brand
lockup — header and hero only. Don't repeat it on every component.

## 4. Signature elements (reuse, never reinvent)

1. **Neon horizon lines** — the pink→violet glowing rules flanking the
   reels (`.reels-area::before/::after`). The only full-width neon lines
   in the product.
2. **Retrowave sun** — striped radial rising behind win cards
   (`.win-card::before`). Reserved for celebration moments.
3. **Cabinet corner suns** — the machine frame's corner glow, lit in the
   machine's own colour (`--mc`).
4. **Synthwave floor** — the faint perspective grid at the page foot.
   Ambient only; opacity stays ≤ .35.
5. **Chrome text** — white→silver gradient clip with a coloured glow
   shadow. Hero and machine-name level only.

## 5. Glow discipline & motion

**Glow = meaning.** Idle UI is mostly matte; glow attaches to
interactivity (hover/focus), live game states (anticipation, wins), and
brand moments (logo, hero). If everything glows, nothing does — ambient
glow on static containers is a rejection.

**Motion:** interactions 150–200ms ease; game choreography uses the
established beats (settle spring `cubic-bezier(.2,1.5,.45,1)` ~380ms,
cascade highlight→pop→settle rhythm from `useGame`). New animation must
join that rhythm, not fight it. `prefers-reduced-motion` support is
mandatory on every animation — no exceptions.

## 6. Rejection checklist

A PR fails review if any of these is true:

- [ ] Raw hex in component code where a token exists
- [ ] Synthetic bold on Anton, or script type used for body/labels
- [ ] More than one script element in a single view
- [ ] Cyan/amber used outside their semantic meaning
- [ ] Glow on idle, non-interactive containers
- [ ] An animation without a reduced-motion path
- [ ] A signature element re-implemented instead of reused
- [ ] Flat default-looking cards/buttons (no elevation ramp, no press state)
- [ ] Touch targets under 44px on mobile layouts
- [ ] Any change under `src/engine/` (hard boundary — different review entirely)

## 7. Known ceilings (so nobody "fixes" them wrongly)

- **Symbols are emoji on styled plates** until the Layer 2 image
  pipeline (generation-quality architecture) exists. Do not attempt
  ad-hoc symbol art in CSS; raise plate quality only.
- **Sound is synthesized** until the Layer 3 audio library. The
  `sound.*` vocabulary is the stable interface; improve behind it.
