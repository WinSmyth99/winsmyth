// Art pipeline stepper — Layer 2 (generation-quality architecture).
// One small unit of work per call so every invocation fits Netlify's
// sync-function budget; the machine page drives the loop:
//   phase A: generate the next missing asset via fal.ai — symbols/wild/
//            scatter/bg on the SYMBOL model (FLUX schnell by default,
//            fast and text-free), the marque on Recraft V3 (best-in-class
//            title lettering) → store in Netlify Blobs
//   phase B: critic-gate the stored asset via Claude vision (showcase
//            mode: text/hex + adult-content guard only) →
//            pass | one regen | emoji fallback for that symbol
// State lives in the Airtable record (art_json + art_status), so the
// loop is resumable by anyone who opens the machine.
//
// Cost note: ~9 schnell assets (listed ~$0.003/MP) + 3 Recraft text
// assets — marque, wild, scatter — (listed ~$0.04 each) ≈ $0.15/machine
// before reuse — verify at fal.ai/pricing. The build rate limit bounds
// worst-case spend per IP.

import { getStore } from '@netlify/blobs';

interface AssetState { key?: string; status: 'pending' | 'stored' | 'ok' | 'fallback'; attempts: number; criticAttempts?: number; criticRuns?: number; model?: string; prompt?: string; reason?: string }
interface ArtState { assets: Record<string, AssetState>; done: boolean; gen?: string }

// Player-selectable art styles. Each block is the consistent language the
// pipeline uses with the image model; the id is also written to the registry
// so reuse can NEVER cross styles.
const STYLE_BLOCKS: Record<string, string> = {
  synthwave: 'Retro-futurist synthwave emblem, electric neon glow on a dusk gradient, clean vector-adjacent rendering.',
  toon: 'Glossy 3D cartoon render, bold silhouettes, thick clean outlines, bouncy exaggerated shapes, saturated cheerful palette.',
  epic: 'Semi-realistic fantasy illustration, painterly brushwork, dramatic rim lighting, rich atmospheric depth.',
  vegas: 'Nineteen-fifties Las Vegas sign age, chrome bevels, incandescent bulb accents, halftone shading, warm americana palette.',
  pixel: 'Chunky retro pixel art, crisp 32x32-feel blocks, limited vibrant palette, subtle dithering, arcade nostalgia.',
  candy: 'Crystal candy gloss, glassy jelly surfaces, sugary specular highlights, jewel-bright colours, soft studio light.',
  anime: 'Anime illustration linework, cel shading, dynamic composition, cyber neon glow accents.',
  luxe: 'Art deco luxury, polished black and gold, engraved metallic detail, premium minimal composition.',
};
// Translate a hex colour to a human colour NAME. Critical: raw hex like
// "#FF3DA5" placed in an image prompt gets painted as literal text by the
// model. Prompts must only ever contain colour words.
function colourName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return 'neon magenta';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 510;
  if (max - min < 25) return l > 0.65 ? 'silver white' : l < 0.25 ? 'charcoal black' : 'slate grey';
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  const names: [number, string][] = [
    [15, 'red'], [40, 'orange'], [65, 'amber gold'], [150, 'emerald green'],
    [195, 'teal cyan'], [255, 'royal blue'], [290, 'violet purple'], [330, 'magenta pink'], [361, 'red'],
  ];
  const base = names.find(([lim]) => h < lim)?.[1] ?? 'magenta pink';
  return l > 0.68 ? `bright ${base}` : l < 0.3 ? `deep ${base}` : base;
}

const styleBlock = (spec: { artStyle?: string }) => STYLE_BLOCKS[spec.artStyle ?? 'synthwave'] ?? STYLE_BLOCKS.synthwave;

// HOUSE_STYLE folded into STYLE_BLOCKS.synthwave (the default style).

// Style-neutral bases: the aesthetic comes ONLY from the machine's style
// block, so marques and backdrops match the player's selected style
// instead of always reading synthwave.
const MARQUE_BASE =
  'A video-game TITLE LOGO. The given words rendered as bold decorative themed lettering, centred, ' +
  'filling the frame as a clean wordmark. Flat graphic title-card treatment on a DEEP DARK background ' +
  '— near-black or a deep jewel tone, never white, never pale, never a daylight scene; the lettering ' +
  'glows against the darkness. This is NOT a photograph and NOT a physical object: no real sign, ' +
  'board, plaque, easel, poster or wall, no room, no environment, no scene, no people, no props ' +
  'around the text. Only the stylised title lettering itself.';

const BG_BASE =
  'Wide atmospheric landscape backdrop for a game screen, cinematic depth, composed so bright game ' +
  'UI stays legible on top. Purely pictorial with absolutely no text, no letters, no logos, no borders. ' +
  'If the scene contains any signs, marquees, screens or billboards, they are BLANK glowing shapes ' +
  'with no readable characters of any kind.';

function slotLabels(spec: { symbols: { name: string; archetype?: string }[]; wildSymbol: { name: string }; bonusSymbol: { name: string }; themeStyle?: string }) {
  const ids = spec.symbols.map((_, i) => `s${i}`).concat(['wild', 'scatter', 'marque', 'bg']);
  const names: Record<string, string> = {};
  const archs: Record<string, string> = {};
  spec.symbols.forEach((s, i) => { names[`s${i}`] = s.name; archs[`s${i}`] = s.archetype || 'other'; });
  names.wild = spec.wildSymbol.name;
  names.scatter = spec.bonusSymbol.name;
  names.marque = '';
  names.bg = '';
  return { ids, names, archs };
}

// Registry tag: kind-scoped subject, scoped within theme style. Reuse
// breadth is set by REUSE_MODE (specs/concept-tagging.md):
//   strict     — name-based (max uniqueness)
//   balanced   — archetype-based for symbols, but wild/scatter stay
//                name-based (the symbols players learn stay bespoke)
//   aggressive — archetype-based for everything incl. wild/scatter
// Backgrounds always key on theme style alone (most reusable asset).
// Falls back to name when no archetype is present, so nothing regresses.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function assetTag(
  sid: string, name: string, themeStyle: string, archetype?: string, machineId = '',
): { kind: string; tag: string; archetype: string } {
  const mode = (process.env.REUSE_MODE || 'balanced').toLowerCase();
  const arch = norm(archetype || '') || 'other';
  const ts = norm(themeStyle || 'default');

  if (sid === 'bg') {
    // Backdrops are prominent — one-per-theme reads as "every machine
    // looks the same". Reuse breadth follows REUSE_MODE:
    //   strict     — unique backdrop per machine (no reuse)
    //   balanced   — pool of 4 per theme style, deterministic per machine
    //   aggressive — single per theme style (max reuse)
    if (mode === 'strict') return { kind: 'background', tag: `bg:${ts}:m:${norm(machineId)}`, archetype: 'background' };
    if (mode === 'aggressive') return { kind: 'background', tag: `bg:${ts}`, archetype: 'background' };
    let h = 0;
    for (const c of machineId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return { kind: 'background', tag: `bg:${ts}:p${h % 4}`, archetype: 'background' };
  }
  if (sid === 'marque') return { kind: 'symbol', tag: `marque:unique`, archetype: 'marque' };

  const special = sid === 'wild' || sid === 'scatter';
  const prefix = sid === 'wild' ? 'wild' : sid === 'scatter' ? 'scatter' : 'symbol';
  // kind is the real ROLE (symbol | wild | scatter | background) so the
  // registry is filterable by role at a glance; the tag keeps its prefix
  // for uniqueness. Pre-v36 rows used kind='symbol' for wild/scatter, but
  // those are style_version 1 and already retired from lookups.
  const roleKind = special ? sid : 'symbol';

  // Identity-bearing archetypes (a witch is not a clown): these swap only
  // on exact name, like wild/scatter. Objects and creatures stay generic.
  const CHARACTER = ['humanoid-figure', 'deity-idol', 'mythic-beast'];

  // strict, or a special/character symbol in balanced, or no archetype → name-based
  const useName = mode === 'strict'
    || (special && mode !== 'aggressive')
    || (CHARACTER.includes(arch) && mode !== 'aggressive')
    || arch === 'other';

  if (useName) return { kind: roleKind, tag: `${prefix}:name:${norm(name)}:${ts}`, archetype: arch };
  return { kind: roleKind, tag: `${prefix}:arch:${arch}:${ts}`, archetype: arch };
}

// Bumped 1 → 2 with the symbol-model switch (Recraft → FLUX): reuse must
// never mix assets rendered by different generators into one machine, so
// pre-switch registry rows simply stop matching. They stay in the table
// harmlessly; clear them manually if you want a tidy base.
const STYLE_VERSION = '2';

// Hue of a #rrggbb colour (0-360), or null for achromatic/invalid.
function hueOf(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return null;
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  return (h * 60 + 360) % 360;
}

function paletteCompatible(machineColor: string, assetPalette: string): boolean {
  const a = hueOf(machineColor), b = hueOf(assetPalette);
  if (a == null || b == null) return false; // legacy/unknown palettes never reuse
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d) <= 70; // same colour family
}

async function registryLookup(
  base: string, token: string, kind: string, tag: string,
  machineColor: string, usedKeys: Set<string>, artStyle: string,
): Promise<{ recId: string; key: string; uses: number } | null> {
  try {
    const url = new URL(`https://api.airtable.com/v0/${base}/assets`);
    url.searchParams.set('filterByFormula', `AND({kind}='${kind}',{subject_tag}='${tag}',{status}='ok',{style_version}='${STYLE_VERSION}',{art_style}='${artStyle}')`);
    url.searchParams.set('maxRecords', '10');
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const d = await r.json();
    for (const rec of d.records ?? []) {
      const key = rec?.fields?.asset_key as string | undefined;
      if (!key) continue;
      if (usedKeys.has(key)) continue; // NEVER the same art twice in one machine
      if (!paletteCompatible(machineColor, String(rec.fields.palette ?? ''))) continue;
      return { recId: rec.id, key, uses: Number(rec.fields.uses ?? 0) };
    }
    return null;
  } catch { return null; }
}

async function registryRegister(base: string, token: string, fields: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`https://api.airtable.com/v0/${base}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      // typecast lets Airtable create missing select options instead of
      // rejecting the whole record — the registry write was failing
      // silently on option mismatches, so nothing persisted or got reused.
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      return { ok: false, error: `airtable_${r.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

async function registryBumpUses(base: string, token: string, recId: string, uses: number): Promise<void> {
  const patch = (fields: Record<string, unknown>) =>
    fetch(`https://api.airtable.com/v0/${base}/assets/${recId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields }),
    });
  try {
    const r = await patch({ uses: uses + 1, last_used_at: new Date().toISOString() });
    // If last_used_at doesn't exist in the base, do not lose the uses
    // increment — retry with the count alone.
    if (!r.ok) await patch({ uses: uses + 1 });
  } catch { /* non-fatal */ }
}

async function airtableGet(base: string, token: string, id: string) {
  const r = await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`airtable_get ${r.status}`);
  return r.json();
}

async function airtablePatch(base: string, token: string, id: string, fields: Record<string, unknown>) {
  const r = await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`airtable_patch ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

// MODEL SPLIT (Option B): symbols, wild, scatter and backgrounds use a
// model that does NOT render text by default (Recraft is SOTA at text
// rendering, which is exactly why it kept stamping 'MEAD'/'SCATTER' onto
// symbols). The marque keeps Recraft, because a title logo is the one
// asset that WANTS best-in-class lettering. Both are flippable per-deploy
// via env vars, no code change needed:
//   FAL_SYMBOL_MODEL  (default fal-ai/flux/schnell)
//   FAL_MARQUE_MODEL  (default fal-ai/recraft-v3)
// Legacy FAL_MODEL, if set, overrides the SYMBOL model only.
const symbolModel = () => process.env.FAL_SYMBOL_MODEL || process.env.FAL_MODEL || 'fal-ai/flux/schnell';
const marqueModel = () => process.env.FAL_MARQUE_MODEL || 'fal-ai/recraft-v3';

async function generateImage(prompt: string, machineColor: string, imageSize = 'square_hd', model?: string): Promise<ArrayBuffer> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('fal_unconfigured');
  const chosen = model || symbolModel();
  // Recraft accepts a `colors` palette hint and a `style`; FLUX and most
  // other models reject unknown fields, so only send those extras to
  // Recraft. Everything else gets the portable minimal payload.
  const isRecraft = chosen.includes('recraft');
  const body: Record<string, unknown> = { prompt, image_size: imageSize };
  if (isRecraft) {
    body.style = 'digital_illustration';
    const rgb = hexToRgb(machineColor);
    if (rgb) body.colors = [rgb];
  }
  const r = await fetch(`https://fal.run/${chosen}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${falKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`fal ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const url: string | undefined = d.images?.[0]?.url;
  if (!url) throw new Error('fal_no_image');
  const img = await fetch(url);
  if (!img.ok) throw new Error(`fal_fetch ${img.status}`);
  return img.arrayBuffer();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Showcase-mode critics ignore the style argument by design (kept in the
// signature so restoring full quality gating is a prompt-only revert).
const CRITIC_MARQUE_SYS = (_style: string) => `You review a game TITLE LOGO image. FAIL (pass=false) ONLY if: there is no legible lettering at all; or the lettering is garbled/nonsense; or it shows extra codes, hashtags or hex values in addition to the title; or the background is predominantly white, pale or a bright daylight scene (it must be dark so it sits on a dark game UI). Ignore everything else — exact wording, style and whether it looks like a photo do NOT matter. Otherwise pass=true. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

const CRITIC_BG_SYS = (_style: string) => `You review backdrop art for a game screen. FAIL (pass=false) ONLY if it contains PROMINENT, clearly readable words or numbers (small, distant or illegible sign-shapes and glyph-like glows are acceptable). Ignore everything else — style, brightness and composition do NOT matter. Otherwise pass=true. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

// SHOWCASE MODE (Option B): the critic no longer gates on aesthetics
// (scene, style, duplicates, subject-match, framing). It keeps ONLY the
// guard whose failure looks unmistakably broken — baked-in text, numbers,
// hex codes, or adult content. This maximises speed and completeness
// (almost nothing falls back) while never shipping a symbol with words or
// codes written across it. To restore full quality gating, revert the
// three CRITIC_* prompts to their pre-v33 form.
// MINIMAL MODE (Option 1): the symbol critic no longer checks subject
// accuracy or adult content (FAL filters the latter upstream). It keeps
// ONLY the guard against broken lettering — a symbol with stray words or
// garbled nonsense text is the one failure that reads as unmistakably
// broken. Everything else ships. Near-zero fallbacks.
const CRITIC_SYS = (_style: string) => `You review slot machine symbol art. FAIL (pass=false) ONLY if the image contains readable text that is NOT simply the symbol's own stated subject name — i.e. random words, codes, hashtags, hex values, or garbled/warped nonsense lettering. A clean accurate caption of the subject, or no text at all, is fine. Ignore everything else — subject accuracy, style, composition, background and duplicates do NOT matter. Otherwise pass=true. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

// Wild/scatter carry their role word by design (v39). The critic verifies
// the word is present and CORRECT — a garbled 'WILLD' is exactly the
// failure this gate exists to catch.
const CRITIC_SPECIAL_SYS = (word: string) => `You review a slot machine ${word} symbol. FAIL (pass=false) ONLY if: the word "${word}" is missing, misspelled or garbled; or the image contains readable text that is neither "${word}" nor words from the symbol's own stated name (codes, hashtags, hex values, garbled lettering or unrelated words all fail). Ignore everything else — subject accuracy, style, composition and background do NOT matter. Otherwise pass=true. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

// Critic call. Outage policy lives in the CALLER (Phase B): a failed
// critic call (error: true) is retried once, then the image ships with a
// 'shipped_unreviewed' flag rather than blanking the machine; an active
// content REJECT (pass: false) still falls back after one regeneration.
// Detect the true image media type from magic bytes. FAL/recraft can
// return PNG, JPEG or WebP; hardcoding image/png makes the vision API
// reject a mislabelled JPEG with 400 "Could not process image", which
// silently disabled the critic. Read the bytes, don't trust an extension.
function sniffMediaType(bytes: ArrayBuffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return 'image/png'; // default; if genuinely unknown the API will say so
}

async function critic(pngBytes: ArrayBuffer, sid: string, subject = '', style = ''): Promise<{ pass: boolean; reasons: string[]; error?: boolean }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { pass: false, reasons: ['critic_unconfigured'], error: true };
  const b64 = Buffer.from(pngBytes).toString('base64');
  const mediaType = sniffMediaType(pngBytes);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: sid === 'bg' ? CRITIC_BG_SYS(style) : sid === 'marque' ? CRITIC_MARQUE_SYS(style) : sid === 'wild' ? CRITIC_SPECIAL_SYS('WILD') : sid === 'scatter' ? CRITIC_SPECIAL_SYS('SCATTER') : CRITIC_SYS(style),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: sid === 'marque'
            ? `Review this title logo. The intended title is: "${subject}".`
            : subject ? `Review this image. It is supposed to depict: ${subject}.` : 'Review this image.' },
        ],
      }],
    }),
  });
  if (!r.ok) return { pass: false, reasons: [`critic_error_${r.status}`], error: true };
  try {
    const d = await r.json();
    const raw = String(d.content?.[0]?.text ?? '');
    // Extract the JSON object even if the model wraps it in prose or code
    // fences. Parsing the whole string broke on any surrounding text and
    // fell through to critic_parse_error (shipping unreviewed). Slice from
    // the first { to the last } instead.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { pass: false, reasons: ['critic_parse_error'], error: true };
    }
    const t = JSON.parse(raw.slice(start, end + 1));
    return { pass: Boolean(t.pass), reasons: Array.isArray(t.reasons) ? t.reasons.slice(0, 3).map(String) : [] };
  } catch {
    return { pass: false, reasons: ['critic_parse_error'], error: true };
  }
}

function counts(state: ArtState, total: number) {
  const settled = Object.values(state.assets).filter((a) => a.status === 'ok' || a.status === 'fallback').length;
  return { completed: settled, total };
}

// Machine-level telemetry written once the forge settles. Best-effort by
// design: a missing Airtable field skips the extras without touching the
// core flow, and the health probes name exactly which field is absent.
// gen_calls goes in its OWN patch so an optional field can never block
// the agreed set.
async function writeSettleTelemetry(base: string, token: string, id: string, state: ArtState, spec: Record<string, unknown>) {
  const vals = Object.values(state.assets);
  await airtablePatch(base, token, id, {
    art_style: String((spec as { artStyle?: string }).artStyle ?? 'synthwave'),
    theme_style: String((spec as { themeStyle?: string }).themeStyle ?? 'default'),
    art_ready: vals.filter((a) => a.status === 'ok').length,
    art_fallback: vals.filter((a) => a.status === 'fallback').length,
    forged_at: new Date().toISOString(),
  }).catch(() => undefined);
  await airtablePatch(base, token, id, {
    gen_calls: vals.reduce((n, a) => n + a.attempts, 0),
  }).catch(() => undefined);
}

function publicMap(state: ArtState): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(state.assets).forEach(([id, a]) => { if (a.status === 'ok' && a.key) out[id] = a.key; });
  return out;
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) return Response.json({ error: 'persistence_unconfigured' }, { status: 503 });

  let id = '';
  try {
    const body = await req.json();
    id = String(body.id ?? '');
  } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  if (!/^rec[A-Za-z0-9]{14,17}$/.test(id)) return Response.json({ error: 'bad_request' }, { status: 400 });

  try {
    const rec = await airtableGet(base, token, id);
    const f = rec.fields ?? {};
    // 'unlisted' = approved, creator hasn't published yet — forging is
    // allowed (this is the primary build flow). Only 'rejected' and
    // unknown statuses stay blocked.
    if (!['live', 'pending', 'unlisted'].includes(String(f.status))) {
      return Response.json({ error: 'not_eligible' }, { status: 403 });
    }
    const spec = JSON.parse(f.spec_json ?? '{}');
    const { ids, names, archs } = slotLabels(spec);

    let state: ArtState;
    try { state = JSON.parse(f.art_json || ''); } catch { state = { assets: {}, done: false }; }
    // Cache-busting generation stamp: every forge run writes to UNIQUE keys,
    // so immutable caching can never serve a previous forge's art after a
    // re-forge. Minted once per run, persisted with the state.
    if (!state.gen) state.gen = Date.now().toString(36);
    ids.forEach((sid) => { if (!state.assets[sid]) state.assets[sid] = { status: 'pending', attempts: 0 }; });

    if (state.done) {
      return Response.json({ phase: 'done', ...counts(state, ids.length), artMap: publicMap(state) });
    }

    const store = getStore({ name: 'machine-art', consistency: 'strong' });

    // Phase B first: critique any stored-but-unjudged asset
    const toJudge = ids.find((sid) => state.assets[sid].status === 'stored');
    if (toJudge) {
      const a = state.assets[toJudge];
      const bytes = await store.get(a.key!, { type: 'arrayBuffer' });
      const sDesc = styleBlock(spec as { artStyle?: string });
      const subject = toJudge === 'marque' ? String(spec.name ?? '') : (names[toJudge] ?? '');
      const verdict = bytes
        ? await critic(bytes, toJudge, subject, sDesc)
        : { pass: false, reasons: ['blob_missing'] as string[], error: false };
      if (bytes) a.criticRuns = (a.criticRuns ?? 0) + 1;
      if (verdict.error) {
        // CRITIC OUTAGE (the call itself failed: HTTP error, parse error,
        // unconfigured — NOT a content reject). Retry once; if the critic
        // is still unreachable, SHIP the image with a flag rather than
        // blanking the machine. This is deliberately different from a
        // reject below: an unreachable reviewer must not take the whole
        // machine down, but an image the reviewer actively REFUSED still
        // falls back. The flag lets us find shipped-unreviewed assets and
        // is recorded in the machine row for audit.
        a.criticAttempts = (a.criticAttempts ?? 0) + 1;
        if (a.criticAttempts >= 2) {
          a.status = 'ok';
          a.reason = `shipped_unreviewed:${(verdict.reasons ?? []).join(',').slice(0, 80) || 'critic_unavailable'}`;
          // NOT registered for reuse — an unreviewed asset never enters the
          // shared registry; it serves only on this one machine.
        }
      } else if (verdict.pass) {
        a.status = 'ok';
        a.reason = undefined;
        const reg = toJudge === 'marque' ? null : assetTag(toJudge, names[toJudge] ?? '', String(spec.themeStyle ?? 'default'), archs[toJudge], id);
        if (reg) {
          // tier: low/mid/premium for pay symbols, 'special' for wild and
          // scatter; backgrounds carry no tier.
          const symIdx = /^s(\d+)$/.exec(toJudge);
          const tier = symIdx ? String(spec.symbols?.[Number(symIdx[1])]?.tier ?? '')
            : (toJudge === 'wild' || toJudge === 'scatter') ? 'special' : '';
          const regResult = await registryRegister(base, token, {
            asset_key: a.key, kind: reg.kind, subject_tag: reg.tag, archetype: reg.archetype,
            theme_style: String(spec.themeStyle ?? 'default'),
            palette: String(spec.color ?? ''),
            art_style: String((spec as { artStyle?: string }).artStyle ?? 'synthwave'),
            style_version: STYLE_VERSION, status: 'ok', uses: 1, machine_id: id,
            // Granularity columns (v36): make the registry filterable and
            // the tuning data queryable instead of buried in art_json.
            model: a.model ?? '',
            subject_name: names[toJudge] ?? '',
            ...(tier ? { tier } : {}),
            reviewed: true,
            gen_attempts: a.attempts,
            critic_attempts: a.criticRuns ?? 1,
            prompt: a.prompt ?? '',
            machine_name: String(spec.name ?? ''),
            palette_name: colourName(String(spec.color ?? '')),
            last_used_at: new Date().toISOString(),
          });
          // Surface a persistence failure without blocking: the asset still
          // serves on this machine, but we record WHY it didn't enter the
          // reuse registry so an empty assets table is diagnosable.
          if (!regResult.ok) a.reason = `registry_write_failed:${regResult.error ?? ''}`.slice(0, 160);
        }
      } else if (a.attempts < 2) {
        a.status = 'pending'; // one regeneration allowed
      } else {
        a.status = 'fallback'; // emoji stays for this symbol
        a.reason = (verdict.reasons ?? []).join('; ').slice(0, 160) || 'critic_failed';
      }
      const allSettled = ids.every((sid) => ['ok', 'fallback'].includes(state.assets[sid].status));
      state.done = allSettled;
      // Diagnostic: carry the most recent asset reason forward so it is
      // visible even if art_json is later wiped. Failures win over
      // shipped-unreviewed flags for surfacing.
      const lastReason = Object.values(state.assets).map((x) => x.reason).filter(Boolean).slice(-1)[0];
      await airtablePatch(base, token, id, {
        art_json: JSON.stringify(state),
        art_status: allSettled ? (Object.keys(publicMap(state)).length ? 'ready' : 'fallback') : 'partial',
      });
      // Best-effort diagnostic field: optional in the base. Never allowed
      // to throw — a missing 'art_note' field must not abort the pipeline.
      if (lastReason) {
        await airtablePatch(base, token, id, { art_note: String(lastReason).slice(0, 200) }).catch(() => undefined);
      }
      if (allSettled) await writeSettleTelemetry(base, token, id, state, spec);
      return Response.json({ phase: state.done ? 'done' : 'critiqued', judged: toJudge, pass: state.assets[toJudge].status === 'ok', reason: a.reason ?? null, ...counts(state, ids.length), artMap: publicMap(state) });
    }

    // Phase A: generate the next pending asset
    const next = ids.find((sid) => state.assets[sid].status === 'pending');
    if (!next) {
      state.done = true;
      await airtablePatch(base, token, id, { art_json: JSON.stringify(state), art_status: Object.keys(publicMap(state)).length ? 'ready' : 'fallback' });
      await writeSettleTelemetry(base, token, id, state, spec);
      return Response.json({ phase: 'done', ...counts(state, ids.length), artMap: publicMap(state) });
    }
    const a = state.assets[next];
    const { kind, tag } = assetTag(next, names[next] ?? '', String(spec.themeStyle ?? 'default'), archs[next], id);

    // Reuse-first: any critic-passed asset with the same subject tag and
    // style version serves immediately — no generation cost, no wait.
    // This is the recycling loop's v1 (production architecture §5).
    if (a.attempts === 0 && next !== 'marque') {
      const usedKeys = new Set(Object.values(state.assets).map((x) => x.key).filter(Boolean) as string[]);
      const hit = await registryLookup(base, token, kind, tag, String(spec.color ?? ''), usedKeys, String((spec as { artStyle?: string }).artStyle ?? 'synthwave'));
      if (hit) {
        a.key = hit.key;
        a.status = 'ok';
        await registryBumpUses(base, token, hit.recId, hit.uses);
        const allSettled = ids.every((sid) => ['ok', 'fallback'].includes(state.assets[sid].status));
        state.done = allSettled;
        await airtablePatch(base, token, id, {
          art_json: JSON.stringify(state),
          art_status: allSettled ? 'ready' : 'partial',
        });
        if (allSettled) await writeSettleTelemetry(base, token, id, state, spec);
        return Response.json({ phase: allSettled ? 'done' : 'reused', reused: next, ...counts(state, ids.length), artMap: publicMap(state) });
      }
    }

    a.attempts += 1;
    const sBlock = styleBlock(spec as { artStyle?: string });
    const accent = colourName(String(spec.color ?? ''));
    // Composition clause forces a clean reel emblem, not a scene. This is
    // the single highest-impact anti-scene guard: one subject, plain
    // ground, icon framing. The tagline is deliberately NOT passed here
    // (it drives narrative dioramas); it belongs only on the marque.
    const ICON = 'Single centred subject, ONE object only, no scene, no secondary objects, no background props. ' +
      'Plain simple solid dark background, evenly lit, generous even margin around the subject. ' +
      'The subject fills most of the frame with a bold, chunky, instantly readable silhouette — never a ' +
      'thin sliver or wispy shape; long thin objects (bows, swords, staffs, arrows) are shown large at a ' +
      'dynamic diagonal. Composed as a clean game icon that reads clearly at small size.';
    // Role treatment (v39, product direction): wild and scatter CARRY
    // their role word — standard slot convention, it's how players learn
    // the specials. These two generate on the text-capable model so the
    // lettering is reliable, and the critic verifies the word is correct.
    const roleClause =
      next === 'scatter' ? ' Give this one a distinct radiant burst treatment, a glowing halo or emanating rays. The word "SCATTER" is rendered boldly and legibly across the emblem in decorative lettering matching the art treatment — spelled exactly SCATTER, and no other text.'
      : next === 'wild' ? ' Present this one as a premium bordered medallion with an ornate frame. The word "WILD" is rendered boldly and legibly across the emblem in decorative lettering matching the art treatment — spelled exactly WILD, and no other text.'
      : '';
    const prompt = (next === 'bg'
      ? `${BG_BASE} Art treatment: ${sBlock} Atmospheric ${accent}-lit ${norm(String(spec.themeStyle ?? 'default'))} scene with depth, sits behind a frosted glass panel so gentle richness is welcome. Do not render any text, letters, numbers or codes.`
      : next === 'marque'
        ? `${MARQUE_BASE} Art treatment: ${sBlock} The title reads ONLY these exact words and nothing else: "${String(spec.name ?? '').replace(/[^a-zA-Z0-9 '!&-]/g, '').slice(0, 30)}". Do not add any codes, hashtags, hex values or extra text.`
        : `${sBlock} The subject: ${names[next]}${archs[next] && archs[next] !== 'other' ? ` — a ${archs[next].replace(/-/g, ' ')}` : ''}. ${ICON}${roleClause} Accent colour: ${accent}. ${next === 'wild' || next === 'scatter' ? 'No other text, letters, numbers or codes beyond that single word.' : 'Do not render any text, letters, numbers or codes in the image.'}`)
      // Retry nudge: the only thing that fails a tile now is stray text, so
      // a second attempt leans HARD against lettering rather than rerolling
      // the identical prompt into the same failure.
      + (a.attempts >= 2 && next !== 'marque' && next !== 'wild' && next !== 'scatter'
        ? ' ABSOLUTELY NO text, letters, words, numbers, signage, labels or watermarks anywhere in the image — a purely wordless illustration.'
        : '');
    let bytes: ArrayBuffer;
    try {
      // Text-bearing assets (marque, wild, scatter) use the text-capable
      // model; the eight pay symbols and backdrop stay on the fast
      // text-free symbol model. Right tool per tile.
      const chosenModel = next === 'marque' || next === 'wild' || next === 'scatter' ? marqueModel() : symbolModel();
      a.model = chosenModel;
      a.prompt = prompt.slice(0, 1500); // capped: keeps art_json lean
      bytes = await generateImage(
        prompt,
        String(spec.color ?? '#FF3DA5'),
        next === 'bg' || next === 'marque' ? 'landscape_16_9' : 'square_hd',
        chosenModel,
      );
    } catch (e) {
      // Provider failure (key, credits, model, network). The attempt was
      // already counted above; a transient failure gets ONE retry, and a
      // second failure falls the asset back to emoji instead of stalling.
      a.reason = String(e).slice(0, 160);
      if (a.attempts >= 2) a.status = 'fallback';
      await airtablePatch(base, token, id, { art_json: JSON.stringify(state), art_status: 'partial' }).catch(() => undefined);
      return Response.json({ phase: 'generation_error', asset: next, reason: a.reason, ...counts(state, ids.length), artMap: publicMap(state) });
    }
    const key = `art/${id}/${state.gen}/${next}-${a.attempts}.png`;
    await store.set(key, bytes);
    a.key = key;
    a.status = 'stored';
    await airtablePatch(base, token, id, { art_json: JSON.stringify(state), art_status: 'partial' });
    return Response.json({ phase: 'generated', generated: next, ...counts(state, ids.length), artMap: publicMap(state) });
  } catch (e) {
    return Response.json({ error: 'art_step_failed', detail: String(e).slice(0, 300) }, { status: 502 });
  }
};
