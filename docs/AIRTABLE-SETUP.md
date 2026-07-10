# Airtable setup — shared catalogue (mark 2, step 1)

Browser-only, ~8 minutes. Until this is done the site works exactly as
before (session-only); once done, builds persist and the lobby shows a
Community machines row.

## 1. Create the base and table
1. airtable.com → sign in → **Create a base** (from scratch) → name it `Winsmyth`
2. Rename the default table to exactly: `machines` (lowercase)
3. Delete the default fields except the first, and create these fields
   (names must match exactly, all lowercase):

| Field name | Type |
|---|---|
| `name` | Single line text (the existing primary field — rename it) |
| `spec_json` | Long text |
| `status` | Single select, options: `live`, `pending`, `rejected` |
| `game_type` | Single line text |
| `reels` | Number (integer) |
| `prompt` | Long text |
| `triage_reasons` | Long text |
| `created_at` | Created time |

## 2. Create a token
1. airtable.com/create/tokens → **Create new token**, name `winsmyth-netlify`
2. Scopes: `data.records:read` and `data.records:write`
3. Access: just the `Winsmyth` base
4. Create → copy the token (starts `pat...`) — shown once

## 3. Find the base ID
Open the base in the browser; the URL is
`airtable.com/appXXXXXXXXXXXXXX/...` — the `appXXXXXXXXXXXXXX` part is
the base ID.

## 4. Netlify environment variables
Project configuration → Environment variables → add BOTH
(same as the API key: All scopes, Same value for all deploy contexts):
- `AIRTABLE_TOKEN` = the pat... token
- `AIRTABLE_BASE_ID` = the app... id

Then **Deploys → Trigger deploy → Deploy site** (vars need a fresh build).

## 5. Verify
Build a machine on winsmyth.com → it should appear in the Airtable
`machines` table with status `live` (or `pending` if triage flagged it)
→ open winsmyth.com in an incognito window → the machine shows in the
Community machines row.

## Reviewing flagged machines
Open the base, filter `status = pending`, read `prompt` and
`triage_reasons`, and flip `status` to `live` or `rejected` by hand.
That's the entire moderation console for now — the Softr operator view
from the architecture doc replaces it later.
