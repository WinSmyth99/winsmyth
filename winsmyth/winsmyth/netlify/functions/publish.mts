// Publish-optional flow: flips an APPROVED (unlisted) machine to live.
// Hard rule: only unlisted → live. pending/rejected machines can never be
// published through this endpoint — the triage gate stays authoritative.

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) return Response.json({ error: 'persistence_unconfigured' }, { status: 503 });
  let id = '';
  try { id = String((await req.json()).id ?? ''); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  if (!/^rec[A-Za-z0-9]{14,17}$/.test(id)) return Response.json({ error: 'bad_request' }, { status: 400 });
  try {
    const r = await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return Response.json({ error: 'not_found' }, { status: 404 });
    const rec = await r.json();
    if (rec.fields?.status !== 'unlisted') return Response.json({ error: 'not_publishable' }, { status: 403 });
    const w = await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { status: 'live' } }),
    });
    if (!w.ok) return Response.json({ error: 'publish_failed' }, { status: 502 });
    // published_at is telemetry, not flow: its own best-effort patch so a
    // missing field can never break the publish itself.
    await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { published_at: new Date().toISOString() } }),
    }).catch(() => undefined);
    return Response.json({ published: true });
  } catch { return Response.json({ error: 'publish_failed' }, { status: 502 }); }
};
