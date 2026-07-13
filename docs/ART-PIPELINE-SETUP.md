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
