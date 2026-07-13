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

interface AssetState { key?: string; status: 'pending' | 'stored' | 'ok' | 'fallback'; attempts: number }
interface ArtState { assets: Record<string, AssetState>; done: boolean }

const HOUSE_STYLE =
  'Premium slot machine symbol tile, vice synthwave casino style: bold single centered subject, ' +
  'clean silhouette readable at small size, neon rim lighting in hot pink and violet, deep dark ' +
  'purple background, subtle retro sunset glow, high contrast, no text, no letters, no watermark, no border.';

function slotLabels(spec: { symbols: { name: string }[]; wildSymbol: { name: string }; bonusSymbol: { name: string } }) {
  const ids = spec.symbols.map((_, i) => `s${i}`).concat(['wild', 'scatter']);
  const names: Record<string, string> = {};
  spec.symbols.forEach((s, i) => { names[`s${i}`] = s.name; });
  names.wild = `${spec.wildSymbol.name} (the WILD symbol — extra ornate, golden accents)`;
  names.scatter = `${spec.bonusSymbol.name} (the SCATTER bonus symbol — mystical, cyan energy glow)`;
  return { ids, names };
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

async function generateImage(prompt: string, machineColor: string): Promise<ArrayBuffer> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('fal_unconfigured');
  const model = process.env.FAL_MODEL || 'fal-ai/recraft-v3';
  const r = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${falKey}` },
    body: JSON.stringify({
      prompt,
      image_size: 'square_hd',
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

const CRITIC_SYS = `You review slot machine symbol art. Judge the image on: (1) single clear centered subject, (2) readable as an icon at 100px, (3) coherent neon synthwave casino style, (4) contains NO text, letters, numbers, watermarks or borders, (5) not disturbing or adult. Return ONLY JSON: {"pass": true|false, "reasons": ["..."]}.`;

async function critic(pngBytes: ArrayBuffer): Promise<{ pass: boolean; reasons: string[] }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { pass: true, reasons: ['critic_unavailable'] }; // don't block art on missing critic
  const b64 = Buffer.from(pngBytes).toString('base64');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: CRITIC_SYS,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: 'Review this symbol.' },
        ],
      }],
    }),
  });
  if (!r.ok) return { pass: true, reasons: [`critic_error_${r.status}`] };
  try {
    const d = await r.json();
    const t = JSON.parse(String(d.content?.[0]?.text ?? '').replace(/```json|```/g, '').trim());
    return { pass: Boolean(t.pass), reasons: Array.isArray(t.reasons) ? t.reasons.slice(0, 3).map(String) : [] };
  } catch {
    return { pass: true, reasons: ['critic_parse_error'] };
  }
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
    if (f.status !== 'live' && f.status !== 'pending') {
      return Response.json({ error: 'not_eligible' }, { status: 403 });
    }
    const spec = JSON.parse(f.spec_json ?? '{}');
    const { ids, names } = slotLabels(spec);

    let state: ArtState;
    try { state = JSON.parse(f.art_json || ''); } catch { state = { assets: {}, done: false }; }
    ids.forEach((sid) => { if (!state.assets[sid]) state.assets[sid] = { status: 'pending', attempts: 0 }; });

    if (state.done) {
      return Response.json({ phase: 'done', total: ids.length, artMap: publicMap(state) });
    }

    const store = getStore('machine-art');

    // Phase B first: critique any stored-but-unjudged asset
    const toJudge = ids.find((sid) => state.assets[sid].status === 'stored');
    if (toJudge) {
      const a = state.assets[toJudge];
      const bytes = await store.get(a.key!, { type: 'arrayBuffer' });
      const verdict = bytes ? await critic(bytes) : { pass: false, reasons: ['blob_missing'] };
      if (verdict.pass) {
        a.status = 'ok';
      } else if (a.attempts < 2) {
        a.status = 'pending'; // one regeneration allowed
      } else {
        a.status = 'fallback'; // emoji stays for this symbol
      }
      const allSettled = ids.every((sid) => ['ok', 'fallback'].includes(state.assets[sid].status));
      state.done = allSettled;
      await airtablePatch(base, token, id, {
        art_json: JSON.stringify(state),
        art_status: allSettled ? (Object.keys(publicMap(state)).length ? 'ready' : 'fallback') : 'partial',
      });
      return Response.json({ phase: state.done ? 'done' : 'critiqued', judged: toJudge, pass: state.assets[toJudge].status === 'ok', total: ids.length, artMap: publicMap(state) });
    }

    // Phase A: generate the next pending asset
    const next = ids.find((sid) => state.assets[sid].status === 'pending');
    if (!next) {
      state.done = true;
      await airtablePatch(base, token, id, { art_json: JSON.stringify(state), art_status: Object.keys(publicMap(state)).length ? 'ready' : 'fallback' });
      return Response.json({ phase: 'done', total: ids.length, artMap: publicMap(state) });
    }
    const a = state.assets[next];
    a.attempts += 1;
    const prompt = `${HOUSE_STYLE} Theme: ${spec.name} — ${spec.tagline}. Subject: ${names[next]}.`;
    const bytes = await generateImage(prompt, String(spec.color ?? '#FF3DA5'));
    const key = `art/${id}/${next}-${a.attempts}.png`;
    await store.set(key, bytes);
    a.key = key;
    a.status = 'stored';
    await airtablePatch(base, token, id, { art_json: JSON.stringify(state), art_status: 'partial' });
    return Response.json({ phase: 'generated', generated: next, total: ids.length, artMap: publicMap(state) });
  } catch (e) {
    return Response.json({ error: 'art_step_failed', detail: String(e).slice(0, 300) }, { status: 502 });
  }
};
