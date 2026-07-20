// Art pipeline stepper — Layer 2 (generation-quality architecture).
// One small unit of work per call so every invocation fits Netlify's
// sync-function budget; the machine page drives the loop:
//   phase A: generate the next missing asset via fal.ai (Recraft V3 by
//            default) in the locked house style → store in Netlify Blobs
//   phase B: critic-gate the stored asset via Claude vision (reel-size
//            legibility, single subject, style coherence, no text) →
//            pass | one regen | emoji fallback for that symbol
// State lives in the Airtable record (art_json + art_status), so the
// loop is resumable by anyone who opens the machine.
//
// Cost note: ~10 raster assets per machine at Recraft V3's listed
// $0.04/image ≈ $0.40/machine (verify at fal.ai/pricing) + ~10 cheap
// vision calls. The build rate limit bounds worst-case spend per IP.

import { getStore } from '@netlify/blobs';

interface AssetState { key?: string; status: 'pending' | 'stored' | 'ok' | 'fallback'; attempts: number; criticAttempts?: number; reason?: string }
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
  'A game-title sign artwork, wide landscape composition. The sign displays ONLY the given words ' +
  'in stylish decorative lettering that matches the art treatment — no other text, no scene beyond ' +
  'the sign, no people.';

const BG_BASE =
  'Wide atmospheric landscape backdrop for a game screen, cinematic depth, composed so bright game ' +
  'UI stays legible on top. Purely pictorial with absolutely no text, no letters, no logos, no borders.';

function slotLabels(spec: { symbols: { name: string; archetype?: string }[]; wildSymbol: { name: string }; bonusSymbol: { name: string }; themeStyle?: string }) {
  const ids = spec.symbols.map((_, i) => `s${i}`).concat(['wild', 'scatter', 'marque', 'bg']);
  const names: Record<string, string> = {};
  const archs: Record<string, string> = {};
  spec.symbols.forEach((s, i) => { names[`s${i}`] = s.name; archs[`s${i}`] = s.archetype || 'other'; });
  names.wild = `${spec.wildSymbol.name}, extra ornate with golden accents`;
  names.scatter = `${spec.bonusSymbol.name}, mystical with cyan energy glow`;
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

  // Identity-bearing archetypes (a witch is not a clown): these swap only
  // on exact name, like wild/scatter. Objects and creatures stay generic.
  const CHARACTER = ['humanoid-figure', 'deity-idol', 'mythic-beast'];

  // strict, or a special/character symbol in balanced, or no archetype → name-based
  const useName = mode === 'strict'
    || (special && mode !== 'aggressive')
    || (CHARACTER.includes(arch) && mode !== 'aggressive')
    || arch === 'other';

  if (useName) return { kind: 'symbol', tag: `${prefix}:name:${norm(name)}:${ts}`, archetype: arch };
  return { kind: 'symbol', tag: `${prefix}:arch:${arch}:${ts}`, archetype: arch };
}

const STYLE_VERSION = '1';

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

async function registryRegister(base: string, token: string, fields: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`https://api.airtable.com/v0/${base}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ records: [{ fields }] }),
    });
  } catch { /* registry is an optimisation — never fail the pipeline on it */ }
}

async function registryBumpUses(base: string, token: string, recId: string, uses: number): Promise<void> {
  try {
    await fetch(`https://api.airtable.com/v0/${base}/assets/${recId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { uses: uses + 1 } }),
    });
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

async function generateImage(prompt: string, machineColor: string, imageSize = 'square_hd'): Promise<ArrayBuffer> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('fal_unconfigured');
  const model = process.env.FAL_MODEL || 'fal-ai/recraft-v3';
  const r = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${falKey}` },
    body: JSON.stringify({
      prompt,
      image_size: imageSize,
      style: 'digital_illustration',
      colors: [hexToRgb(machineColor)].filter(Boolean),
    }),
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

// Critic criteria are style-aware: the expected style passed in is the
// SAME block the generation prompt used, so the gate can never fail art
// for being exactly what was asked for.
const CRITIC_MARQUE_SYS = (style: string) => `You review a game-title SIGN image. FAIL (pass=false) if ANY of these: no legible lettering at all; the sign shows words other than, or in addition to, the given title — including any codes, hashtags or hex values; depicts a scene, people, or objects beyond the sign itself; clashes badly with the intended art treatment: "${style}"; disturbing or adult content. Minor stylised letter quirks are acceptable. Otherwise pass=true. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

const CRITIC_BG_SYS = (style: string) => `You review backdrop art for a game screen. FAIL (pass=false) if ANY of these: contains ANY letters, words, numbers or typography anywhere; so bright or busy that game UI would be illegible on top; clearly off-style for the intended art treatment: "${style}"; disturbing or adult content. Otherwise pass=true. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

const CRITIC_SYS = (style: string) => `You review slot machine symbol art. FAIL (pass=false) if ANY of these: the image contains ANY text, letters, numbers, hashtags or hex codes anywhere (symbols must be text-free); the image does NOT clearly depict the stated subject; depicts an entire slot machine, casino sign, poster or storefront rather than a single subject emblem; multiple competing subjects or a full scene; unreadable as an icon at 100px; clearly off-style for the intended art treatment: "${style}"; disturbing or adult content. Otherwise pass=true. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

// Critic failure paths fail CLOSED: an unreviewed image never ships.
// Transient errors are retried (criticAttempts in the caller); a second
// failure falls the asset back to emoji.
async function critic(pngBytes: ArrayBuffer, sid: string, subject = '', style = ''): Promise<{ pass: boolean; reasons: string[]; error?: boolean }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { pass: false, reasons: ['critic_unconfigured'], error: true };
  const b64 = Buffer.from(pngBytes).toString('base64');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: sid === 'bg' ? CRITIC_BG_SYS(style) : sid === 'marque' ? CRITIC_MARQUE_SYS(style) : CRITIC_SYS(style),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: sid === 'marque'
            ? `Review this sign. It must display exactly these words and nothing else: "${subject}".`
            : subject ? `Review this image. It is supposed to depict: ${subject}.` : 'Review this image.' },
        ],
      }],
    }),
  });
  if (!r.ok) return { pass: false, reasons: [`critic_error_${r.status}`], error: true };
  try {
    const d = await r.json();
    const t = JSON.parse(String(d.content?.[0]?.text ?? '').replace(/```json|```/g, '').trim());
    return { pass: Boolean(t.pass), reasons: Array.isArray(t.reasons) ? t.reasons.slice(0, 3).map(String) : [] };
  } catch {
    return { pass: false, reasons: ['critic_parse_error'], error: true };
  }
}

function counts(state: ArtState, total: number) {
  const settled = Object.values(state.assets).filter((a) => a.status === 'ok' || a.status === 'fallback').length;
  return { completed: settled, total };
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
      if (verdict.error) {
        // Critic outage: leave the asset 'stored' and re-judge on a later
        // step; a second outage fails CLOSED to emoji — an unreviewed
        // image never ships.
        a.criticAttempts = (a.criticAttempts ?? 0) + 1;
        if (a.criticAttempts >= 2) {
          a.status = 'fallback';
          a.reason = (verdict.reasons ?? []).join('; ').slice(0, 160) || 'critic_unavailable';
        }
      } else if (verdict.pass) {
        a.status = 'ok';
        const reg = toJudge === 'marque' ? null : assetTag(toJudge, names[toJudge] ?? '', String(spec.themeStyle ?? 'default'), archs[toJudge], id);
        if (reg)
          await registryRegister(base, token, {
            asset_key: a.key, kind: reg.kind, subject_tag: reg.tag, archetype: reg.archetype,
            theme_style: String(spec.themeStyle ?? 'default'),
            palette: String(spec.color ?? ''),
            art_style: String((spec as { artStyle?: string }).artStyle ?? 'synthwave'),
            style_version: STYLE_VERSION, status: 'ok', uses: 1, machine_id: id,
          });
      } else if (a.attempts < 2) {
        a.status = 'pending'; // one regeneration allowed
      } else {
        a.status = 'fallback'; // emoji stays for this symbol
        a.reason = (verdict.reasons ?? []).join('; ').slice(0, 160) || 'critic_failed';
      }
      const allSettled = ids.every((sid) => ['ok', 'fallback'].includes(state.assets[sid].status));
      state.done = allSettled;
      await airtablePatch(base, token, id, {
        art_json: JSON.stringify(state),
        art_status: allSettled ? (Object.keys(publicMap(state)).length ? 'ready' : 'fallback') : 'partial',
      });
      return Response.json({ phase: state.done ? 'done' : 'critiqued', judged: toJudge, pass: state.assets[toJudge].status === 'ok', ...counts(state, ids.length), artMap: publicMap(state) });
    }

    // Phase A: generate the next pending asset
    const next = ids.find((sid) => state.assets[sid].status === 'pending');
    if (!next) {
      state.done = true;
      await airtablePatch(base, token, id, { art_json: JSON.stringify(state), art_status: Object.keys(publicMap(state)).length ? 'ready' : 'fallback' });
      return Response.json({ phase: 'done', ...counts(state, ids.length), artMap: publicMap(state) });
    }
    const a = state.assets[next];
    const mood = String(spec.tagline ?? '').replace(/["']/g, '');
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
        return Response.json({ phase: allSettled ? 'done' : 'reused', reused: next, ...counts(state, ids.length), artMap: publicMap(state) });
      }
    }

    a.attempts += 1;
    const sBlock = styleBlock(spec as { artStyle?: string });
    const prompt = next === 'bg'
      ? `${BG_BASE} Art treatment: ${sBlock} Mood: ${mood}. Do not render any text, letters, numbers or codes.`
      : next === 'marque'
        ? `${MARQUE_BASE} Art treatment: ${sBlock} The sign displays ONLY these exact words and nothing else: "${String(spec.name ?? '').replace(/[^a-zA-Z0-9 '!&-]/g, '').slice(0, 30)}". Do not add any codes, hashtags, hex values or extra text.`
        : `${sBlock} The object: ${names[next]}. Mood: ${mood}. Accent colour: ${colourName(String(spec.color ?? ''))}. ${norm(String(spec.themeStyle ?? 'default'))} atmosphere. Do not render any text, letters, numbers or codes in the image.`;
    let bytes: ArrayBuffer;
    try {
      bytes = await generateImage(
        prompt,
        String(spec.color ?? '#FF3DA5'),
        next === 'bg' || next === 'marque' ? 'landscape_16_9' : 'square_hd',
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
