// Diagnostic endpoint: GET /api/health
// Reports configuration and live connectivity WITHOUT exposing secrets.
// The Airtable write test creates a __healthcheck__ record (status
// 'rejected', so it can never reach the public catalogue) and deletes it
// immediately — Airtable's error body names misconfigured fields, which
// is exactly what silent-failure debugging needs.

export default async () => {
  const out: Record<string, unknown> = {
    anthropic_key_set: Boolean(process.env.ANTHROPIC_API_KEY),
    airtable_token_set: Boolean(process.env.AIRTABLE_TOKEN),
    airtable_base_id_set: Boolean(process.env.AIRTABLE_BASE_ID),
  };
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;

  if (!token || !base) {
    out.airtable = 'not configured — persistence disabled by design';
    return Response.json(out);
  }

  // Read test
  try {
    const r = await fetch(`https://api.airtable.com/v0/${base}/machines?maxRecords=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    out.airtable_read = r.ok ? 'ok' : { status: r.status, body: (await r.text()).slice(0, 400) };
  } catch (e) {
    out.airtable_read = { error: String(e).slice(0, 200) };
  }

  // Write test (self-cleaning)
  try {
    const w = await fetch(`https://api.airtable.com/v0/${base}/machines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        records: [{
          fields: {
            name: '__healthcheck__', spec_json: '{}', status: 'rejected',
            game_type: 'paylines', reels: 5, prompt: 'healthcheck', triage_reasons: 'healthcheck',
          },
        }],
      }),
    });
    if (w.ok) {
      out.airtable_write = 'ok';
      const d = await w.json();
      const id = d.records?.[0]?.id;
      if (id) {
        await fetch(`https://api.airtable.com/v0/${base}/machines/${id}`, {
          method: 'DELETE', headers: { authorization: `Bearer ${token}` },
        }).catch(() => undefined);
      }
    } else {
      out.airtable_write = { status: w.status, body: (await w.text()).slice(0, 400) };
    }
  } catch (e) {
    out.airtable_write = { error: String(e).slice(0, 200) };
  }

  return Response.json(out);
};
