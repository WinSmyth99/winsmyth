// Real play counts: fire-and-forget increment when a machine is opened.
// Reads current value then writes +1 (races may undercount slightly —
// acceptable for a prototype metric; real analytics arrive with the VPS).

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) return Response.json({ ok: false });
  let id = '';
  try { id = String((await req.json()).id ?? ''); } catch { return Response.json({ ok: false }); }
  if (!/^rec[A-Za-z0-9]{14,17}$/.test(id)) return Response.json({ ok: false });
  try {
    const r = await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return Response.json({ ok: false });
    const rec = await r.json();
    const plays = Number(rec.fields?.plays ?? 0) + 1;
    await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { plays } }),
    });
    return Response.json({ ok: true, plays });
  } catch { return Response.json({ ok: false }); }
};
