# Concept Tagging — Design Doc
### specs/concept-tagging.md — raising asset reuse without the VPS

**Status:** BUILT (balanced default). Vocabulary finalised at 40 buckets + 'other'.
**Problem owner:** the asset registry (mark 2, step 3) reuses on the
normalized symbol *name*. "toad" and "frog" are the same concept but
different strings, so they miss each other and both generate. Observed
live: two wizard machines shared candle/scroll/crystal-ball/wizard/bg
(identical names) but re-painted frog≠toad, elixir≠potion, dragon≠witch.
Reuse works; it's just bottlenecked by naming variance.

**Goal:** raise the reuse rate — lower cost and forge time per machine —
by matching on *concept* rather than exact name, while keeping the
visual specificity that makes each machine feel bespoke.

**Non-goal:** semantic/embedding matching. That's the correct general
solution (production-architecture §5) but needs a vector store = VPS
era. This doc is the Airtable-stage bridge that the embedding version
later supersedes cleanly.

---

## 1. Approach: model-assigned archetype from a controlled vocabulary

At generation time the model already returns the machine spec. Extend
the schema so each symbol also carries an `archetype` drawn from a fixed
controlled list (below). Reuse then keys on **`archetype + theme_style`**
instead of `name + theme_style`.

Why model-assigned rather than a hardcoded name→archetype map:
- A static map can't cover every theme's vocabulary; the model can slot
  a novel symbol ("kraken", "circuit sprite") into the nearest bucket.
- It rides the generation call already in flight — one extra field, no
  new request, no new infrastructure.
- Falls back safely: an unrecognised/blank archetype reverts to
  name-based tagging (today's behaviour), so nothing regresses.

## 2. The controlled vocabulary (v1, ~32 buckets)

Grouped for readability; the model receives the flat list and must pick
exactly one per symbol, or `other`.

- **Creatures:** `amphibian`, `reptile`, `bird`, `feline`, `canine`,
  `sea-creature`, `insect`, `mythic-beast`, `humanoid-figure`
- **Objects:** `vessel-potion`, `blade-weapon`, `blunt-weapon`,
  `tool-implement`, `book-scroll`, `key-lock`, `coin-treasure`,
  `gem-crystal`, `container-chest`
- **Nature:** `plant-flower`, `fruit`, `fungus`, `tree`, `element-fire`,
  `element-water`, `celestial`, `weather`
- **Structures/misc:** `building`, `vehicle`, `emblem-symbol`,
  `food-drink`, `mask-face`, `other`

Tiers stay orthogonal — the tag is `archetype:<value>` and reuse still
scopes within `theme_style`, so a `wizard`-style amphibian never reuses
a `vegas`-style one.

## 3. The reuse-aggressiveness knob (the product tradeoff)

Broadening the key trades cost against uniqueness. Made explicit and
tunable via one env var, `REUSE_MODE`:

| Mode | Reuse key | Effect |
|---|---|---|
| `strict` | `name + theme_style` | Today's behaviour. Max uniqueness, min reuse. |
| `balanced` *(proposed default)* | `archetype + theme_style`, but **wild/scatter stay name-scoped** | Common symbols recycle; the two symbols players notice most stay bespoke. |
| `aggressive` | `archetype + theme_style` for all | Max reuse, max cost drop, least visual specificity. |

**The honest cost:** in `balanced`, a machine's "frog" may be a previous
machine's "newt" — same archetype, same style, genuinely
interchangeable at tile size, but not literally the symbol its name
implies. For low/mid symbols glanced at during spins this is
imperceptible; for the wild and scatter — the symbols players learn and
watch for — it matters, which is why they stay name-scoped even in
balanced. `aggressive` drops that protection; only pick it if cost
dominates uniqueness for your stage.

## 4. What changes in code (when approved)

1. `schema.ts` — add optional `archetype` per symbol; `validateAndClamp`
   coerces to the vocabulary or `other`; SYS prompt gains the list and
   the "pick exactly one" instruction.
2. `art-step.mts` `assetTag()` — compute the key by `REUSE_MODE`:
   archetype-scoped for symbols (name-scoped for wild/scatter in
   balanced), unchanged for backgrounds (already theme-only).
3. `assets` table — add an `archetype` single-line-text field for
   observability (see reuse working per bucket). [DONE in setup doc]
4. No client change. No new dependency. Fully backward-compatible:
   existing name-tagged assets keep serving under `strict`, and
   `balanced` simply starts writing archetype-tagged rows alongside.

## 5. Success measure

Track mean `uses` per asset and assets-generated-per-machine before and
after. Target: the 3rd+ machine of a common theme forges the majority of
its symbols from the registry. If `balanced` produces visibly wrong
symbols in playtest, fall back to `strict` (one env var) with zero code
change — the knob is the safety net.

## 6. Handoff to the VPS embedding version

When the registry moves to Postgres with a vector index, `archetype`
becomes a coarse pre-filter and the embedding does fine matching within
it — this vocabulary doesn't get thrown away, it becomes the bucketing
layer above the embedding. So building it now is not throwaway work; it's
the first half of the eventual design.

---

**Decision needed from Samuel:**
1. Approve the vocabulary (§2) — add/remove buckets?
2. Set the default `REUSE_MODE` — `balanced` proposed.
3. Confirm wild/scatter stay name-scoped in `balanced`.


## Addendum (post-launch fixes)
Observed in production: within-machine duplicate assets (two same-archetype
symbols resolving to one asset), palette clashes on reuse, over-broad
character swapping, and subject-irrelevant art passing the critic.
Fixes: within-machine key uniqueness; `palette` field + hue-compatibility
gate (≤70°) on all reuse; humanoid-figure/deity-idol/mythic-beast are
name-scoped in balanced; critic verifies the stated subject.
