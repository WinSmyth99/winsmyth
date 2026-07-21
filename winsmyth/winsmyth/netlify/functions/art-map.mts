// Returns a machine's PERSISTED art map (asset-id → blob key) from its
// Airtable row, so a finished machine reopened from the lobby shows its
// background, marque and symbols immediately — without re-driving the
// whole pipeline. Only assets that passed review (status 'ok') are
// exposed, matching the forge-time public map exactly.

interface AssetState { key?: string; status: string }
interface ArtState { assets: Record<string, AssetState> }

export default async (req: Request) => {
  const base = process.env.AIRTABLE_BASE_ID;
  const token = process.env.AIRTABLE_TOKEN;
  if (!token || !base) return Response.json({ artMap: {} }); // session-only mode: nothing persisted

  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!/^rec[A-Za-z0-9]{14,17}$/.test(id)) return Response.json({ error: 'bad_request' }, { status: 400 });

  try {
    const r = await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return Response.json({ artMap: {} });
    const rec = await r.json();
    let state: ArtState;
    try { state = JSON.parse(rec.fields?.art_json || ''); } catch { return Response.json({ artMap: {} }); }
    const artMap: Record<string, string> = {};
    for (const [sid, a] of Object.entries(state.assets ?? {})) {
      if (a?.status === 'ok' && a.key) artMap[sid] = a.key;
    }
    return Response.json({ artMap, status: rec.fields?.art_status ?? null });
  } catch {
    return Response.json({ artMap: {} });
  }
};
