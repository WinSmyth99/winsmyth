# Art pipeline setup — Layer 2 (mark 2, step 2)

Two additions: a fal.ai key and two Airtable fields. Until both exist,
machines simply stay emoji — nothing breaks.

## 1. Airtable — add two fields to `machines`
| Field name | Type |
|---|---|
| `art_status` | Single select, options: `partial`, `ready`, `fallback` |
| `art_json` | Long text |

Names lowercase, exact. (Existing records are fine — blank means no art yet.)

## 2. fal.ai — account + key
1. fal.ai → sign up → dashboard → **Keys** → create key
2. **Set a budget/spend limit in the fal dashboard billing settings before anything else** — every symbol is a billed generation (Recraft V3 listed at $0.04/image → ≈$0.40 per machine; verify current pricing at fal.ai/pricing)
3. Copy the key (into Netlify only)

## 3. Netlify env var + redeploy
- `FAL_KEY` = the fal key (All scopes, Same value all contexts)
- Optional: `FAL_MODEL` to switch models without a code change
  (default `fal-ai/recraft-v3`; e.g. a Flux endpoint id to A/B later)
- **Deploys → Trigger deploy → Deploy site**

## 4. Verify
Build a machine → stay on its page → "Painting your machine's artwork…"
appears → symbols upgrade from emoji to painted tiles one by one over
~30–60s → Airtable record shows `art_status` progressing partial → ready.
Reload the page: art loads instantly from storage. Open its share link
in incognito: art shows there too.

## How it behaves
- The loop runs while a machine page is open; closing mid-way pauses it,
  and the next visitor resumes it. Assets are permanent (Netlify Blobs).
- Every asset passes a vision critic (legibility, single subject, style,
  no text). One regeneration on failure, then that symbol stays emoji.
- Presets and pre-art machines keep emoji — only persisted machines get art.


---

# Asset registry — mark 2, step 3 addition

The recycling loop: before painting any asset, the pipeline searches the
registry for a critic-passed asset with the same subject tag (e.g. two
players both request a "Dragon" symbol → the second machine reuses the
first machine's dragon instantly: no generation cost, no wait).
Backgrounds are tagged per theme style — the most reusable asset of all.
Four asset kinds exist in the registry: background and symbol populate
today; button and animation are reserved for the motion phase.

## Add a second Airtable table: `assets`
In the Winsmyth base → **Add or import → Create blank table** → name it
exactly `assets` (lowercase). Fields (rename the primary field first):

| Field name | Type |
|---|---|
| `asset_key` | Single line text (the primary field — rename it) |
| `kind` | Single select: `background`, `symbol`, `button`, `animation` |
| `subject_tag` | Single line text |
| `theme_style` | Single line text |
| `style_version` | Single line text |
| `status` | Single select: `ok`, `retired` |
| `uses` | Number (integer) |
| `machine_id` | Single line text |
| `archetype` | Single line text |
| `created_at` | Created time |

No token changes needed (the token grants the whole base). Without this
table the pipeline still works — it just never reuses (every asset is
freshly generated).

## Re-forging a machine (e.g. after prompt/critic changes)
Open the machine's row in `machines`, clear the `art_json` and
`art_status` cells, then open the machine on the site — it re-paints
under the current rules. To retire a bad registry asset so it stops
being reused, set its `status` to `retired` in `assets`.


---

# Concept tagging — mark 2, step 3b

Asset reuse now matches on symbol *archetype* (e.g. frog and toad both →
`amphibian`), not exact name, controlled by env var `REUSE_MODE`:
- `strict` — name-based (today's behaviour)
- `balanced` — DEFAULT if unset; archetypes reuse common symbols, wild &
  scatter stay name-scoped
- `aggressive` — archetypes for everything

To change: set `REUSE_MODE` in Netlify env vars + redeploy. No value
needed to run — it defaults to `balanced`. See `specs/concept-tagging.md`.

Add one field to the `assets` table for observability: `archetype`
(single line text). Optional — reuse works without it, you just won't
see the bucket per row.

Note: existing name-tagged assets from before this change keep serving
under their old tags; new machines write archetype-tagged rows. To force
the whole catalogue onto the new scheme, bump `style_version` handling
(advanced — leave for the VPS migration).


---

# House catalogue — "Winsmyth Originals"

Curated first-party machines that pin to the top of the lobby, always
visible regardless of triage status. They ARE real forged machines
(full art, marque, backdrop, sound) — just flagged as house.

## Add one field to the `machines` table
| Field name | Type |
|---|---|
| `house` | Checkbox |

## To make a machine a house Original
1. Build the machine on the site as normal; let it fully forge (art +
   marque + backdrop all done).
2. Play it, confirm it looks great.
3. In the `machines` table, find its row and tick the `house` checkbox.
4. Within ~60s (catalogue cache) it appears in the "Winsmyth Originals"
   lobby row with an "Original" tag, and stays there permanently.

Presets (the old emoji house list) now show ONLY as a fallback when no
house machines exist — once you have Originals, presets disappear.

## Clearing the community catalogue
To wipe player machines but KEEP your Originals: in `machines`, filter
`house` is unchecked, select those rows, delete. Your ticked Originals
survive. (Deleting rows leaves their art in the registry/Blobs, which is
fine — it means rebuilds are faster.)
