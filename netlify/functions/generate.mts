// Generation + triage + persistence.
// Flow: rate gate → prompt pre-check → Claude generation → validate/clamp
// → TRIAGE (pass|flag|block) → persist to Airtable → respond.
// Nothing player-generated reaches the public catalogue without passing
// triage (soft-launch architecture §4; generation-quality doc §4).
// Graceful degradation: without Airtable env vars, generation still
// works — machines just aren't persisted or shared.

import { SYS, validateAndClamp } from '../../src/generation/schema';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.GEN_RATE_LIMIT ?? 10);
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

const TRIAGE_SYS = `You are a content-safety triage for a family-friendly social casino where players name slot machines. Judge ONLY the provided machine name, tagline, symbol names, and the player's prompt. Return ONLY JSON: {"verdict":"pass"|"flag"|"block","reasons":["..."]}.
- "block": slurs, sexual content, content sexualising or endangering minors, hate/extremist references, harassment of a named real person, instructions for harm.
- "flag": borderline innuendo, real-person or real-brand/IP references, gambling-harm glorification, anything a cautious reviewer should see first.
- "pass": everything else. Ordinary casino themes (pirates, dragons, luck, riches) are pass.`;

async function anthropic(key: string, system: string, user: string, model: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1000, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const d = await res.json();
  return String(d.content?.[0]?.text ?? '');
}

async function persist(spec: unknown, extra: Record<string, unknown>): Promise<string | null> {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) return null;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${base}/machines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ records: [{ fields: { spec_json: JSON.stringify(spec), ...extra } }] }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.records?.[0]?.id ?? null;
  } catch { return null; }
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'generation_unconfigured' }, { status: 503 });

  const ip = req.headers.get('x-nf-client-connection-ip') ?? 'unknown';
  if (limited(ip)) return Response.json({ error: 'rate_limited' }, { status: 429 });

  let prompt = ''; let reels = 5; let gameType = 'paylines'; let artStyle = 'synthwave';
  try {
    const body = await req.json();
    prompt = String(body.prompt ?? '').slice(0, 300);
    reels = body.reels === 3 ? 3 : 5;
    gameType = ['paylines', 'ways', 'scatter', 'cluster'].includes(body.gameType) ? body.gameType : 'paylines';
    const STYLE_IDS = ['synthwave', 'toon', 'epic', 'vegas', 'pixel', 'candy', 'anime', 'luxe'];
    artStyle = STYLE_IDS.includes(String(body.artStyle)) ? String(body.artStyle) : 'synthwave';
  } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  if (prompt.trim().length < 3) return Response.json({ error: 'bad_request' }, { status: 400 });

  try {
    const genText = await anthropic(key, SYS, prompt, 'claude-sonnet-4-6');
    const spec = validateAndClamp(JSON.parse(genText.replace(/```json|```/g, '').trim()));
    // Player-selected art style rides on the spec so the art pipeline and
    // registry can honour it end to end.
    (spec as { artStyle?: string }).artStyle = artStyle;

    // ── Triage gate ──
    let verdict = 'flag'; let reasons: string[] = ['triage_unavailable'];
    try {
      const summary = JSON.stringify({
        prompt,
        name: spec.name,
        tagline: spec.tagline,
        symbols: spec.symbols.map((s) => s.name),
        wild: spec.wildSymbol.name,
        scatter: spec.bonusSymbol.name,
      });
      const tText = await anthropic(key, TRIAGE_SYS, summary, 'claude-haiku-4-5-20251001');
      const t = JSON.parse(tText.replace(/```json|```/g, '').trim());
      if (t.verdict === 'pass' || t.verdict === 'flag' || t.verdict === 'block') {
        verdict = t.verdict;
        reasons = Array.isArray(t.reasons) ? t.reasons.slice(0, 5).map(String) : [];
      }
    } catch { /* triage failure fails CLOSED: verdict stays 'flag' */ }

    if (verdict === 'block') {
      await persist(spec, { name: spec.name, status: 'rejected', game_type: gameType, reels, prompt, triage_reasons: reasons.join('; ') });
      return Response.json({ error: 'content_rejected' }, { status: 422 });
    }

    // pass → unlisted: the machine is approved but the CREATOR chooses
    // whether it joins the public catalogue (publish-optional flow).
    const status = verdict === 'pass' ? 'unlisted' : 'pending';
    const id = await persist(spec, { name: spec.name, status, game_type: gameType, reels, prompt, triage_reasons: reasons.join('; ') });

    return Response.json({ spec, status, persisted: id != null, id });
  } catch {
    return Response.json({ error: 'generation_failed' }, { status: 502 });
  }
};
