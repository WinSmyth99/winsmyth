// Netlify Function: proxies machine generation to the Anthropic API so
// the public site never sees the key. Set ANTHROPIC_API_KEY in the
// Netlify environment.
//
// Rate limiting note (honest): this limiter is in-memory and therefore
// per-function-instance — good enough to blunt casual abuse on a demo,
// NOT a real quota. Before any public launch, back it with a shared
// store (the production architecture's Redis) or a Netlify rate-limit
// rule, and set a hard daily spend cap on the API key itself.

import { SYS, validateAndClamp } from '../../src/generation/schema';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'generation_unconfigured' }, { status: 503 });

  const ip = req.headers.get('x-nf-client-connection-ip') ?? 'unknown';
  if (limited(ip)) return Response.json({ error: 'rate_limited' }, { status: 429 });

  let prompt = '';
  try {
    const body = await req.json();
    prompt = String(body.prompt ?? '').slice(0, 300);
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (prompt.trim().length < 3) return Response.json({ error: 'bad_request' }, { status: 400 });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return Response.json({ error: 'upstream', status: res.status }, { status: 502 });
    const d = await res.json();
    const text: string = d.content?.[0]?.text ?? '';
    const spec = validateAndClamp(JSON.parse(text.replace(/```json|```/g, '').trim()));
    return Response.json({ spec });
  } catch {
    return Response.json({ error: 'generation_failed' }, { status: 502 });
  }
};
