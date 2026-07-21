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
      .map((r: { id: string; fields: { spec_json?: string; game_type?: string; reels?: number; house?: unknown; plays?: number; art_json?: string } }) => {
        try {
          // Surface the machine's real art for lobby cards: backdrop plus
          // the top three critic-passed symbols (s7 downward). Key strings
          // only — the client fetches via /api/art-get.
          let art: { bg?: string; symbols: string[] } | undefined;
          try {
            const st = JSON.parse(r.fields.art_json || '');
            const ok = (sid: string) => st.assets?.[sid]?.status === 'ok' ? String(st.assets[sid].key ?? '') : '';
            const symbols: string[] = [];
            for (let i = 7; i >= 0 && symbols.length < 3; i--) { const k = ok(`s${i}`); if (k) symbols.push(k); }
            const bg = ok('bg');
            if (symbols.length || bg) art = { ...(bg ? { bg } : {}), symbols };
          } catch { /* no art yet — cards fall back to emoji */ }
          return {
            id: r.id,
            spec: JSON.parse(r.fields.spec_json ?? ''),
            gameType: r.fields.game_type ?? 'paylines',
            reels: r.fields.reels === 3 ? 3 : 5,
            house: r.fields.house === true || r.fields.house === 1,
            plays: Number(r.fields.plays ?? 0),
            ...(art ? { art } : {}),
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
