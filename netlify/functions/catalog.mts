// Community catalogue: serves ONLY status='live' machines (i.e. those
// that passed triage). Returns [] when Airtable isn't configured, so the
// client degrades to session-only gracefully.

export default async (req: Request) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) return Response.json({ machines: [] });

  try {
    // House machines show regardless of triage status; community machines
    // must be live. One formula fetches both.
    const url = new URL(`https://api.airtable.com/v0/${base}/machines`);
    url.searchParams.set('filterByFormula', "OR({house}=1,{status}='live')");
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('sort[0][field]', 'created_at');
    url.searchParams.set('sort[0][direction]', 'desc');
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return Response.json({ machines: [] });
    const d = await res.json();
    const machines = (d.records ?? [])
      .map((r: { id: string; fields: { spec_json?: string; game_type?: string; reels?: number; house?: unknown } }) => {
        try {
          return {
            id: r.id,
            spec: JSON.parse(r.fields.spec_json ?? ''),
            gameType: r.fields.game_type ?? 'paylines',
            reels: r.fields.reels === 3 ? 3 : 5,
            house: r.fields.house === true || r.fields.house === 1,
          };
        } catch { return null; }
      })
      .filter(Boolean);
    return new Response(JSON.stringify({ machines }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=60' },
    });
  } catch {
    return Response.json({ machines: [] });
  }
};
