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

  // ── Required-field probes: a filterByFormula naming a missing field
  // returns 422, which tells us EXACTLY which Airtable field is absent. ──
  const probeField = async (table: string, field: string) => {
    try {
      const u = new URL(`https://api.airtable.com/v0/${base}/${table}`);
      u.searchParams.set('filterByFormula', `{${field}}=''`);
      u.searchParams.set('maxRecords', '1');
      const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
      return r.ok ? 'ok' : 'MISSING';
    } catch { return 'unreachable'; }
  };
  out.machines_fields = {
    status: await probeField('machines', 'status'),
    art_json: await probeField('machines', 'art_json'),
    art_status: await probeField('machines', 'art_status'),
    house: await probeField('machines', 'house'),
    plays: await probeField('machines', 'plays'),
    created_at: await probeField('machines', 'created_at'), // catalog sorts on it
  };
  out.assets_fields = {
    asset_key: await probeField('assets', 'asset_key'),
    kind: await probeField('assets', 'kind'),
    subject_tag: await probeField('assets', 'subject_tag'),
    archetype: await probeField('assets', 'archetype'),
    theme_style: await probeField('assets', 'theme_style'),
    style_version: await probeField('assets', 'style_version'),
    uses: await probeField('assets', 'uses'),
    palette: await probeField('assets', 'palette'),
    art_style: await probeField('assets', 'art_style'),
    status: await probeField('assets', 'status'), // registry lookups filter on it
    machine_id: await probeField('assets', 'machine_id'),
  };

  // ── Provider probes ──
  out.fal_key_set = Boolean(process.env.FAL_KEY);
  out.fal_model = process.env.FAL_MODEL || 'fal-ai/recraft-v3 (default)';
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const a = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      });
      out.anthropic_api = a.ok ? 'ok' : { status: a.status, body: (await a.text()).slice(0, 300) };
    } catch (e) { out.anthropic_api = { error: String(e).slice(0, 200) }; }
    // Critic VISION self-test: the text ping above does not prove the
    // image path. This sends a real (tiny) PNG image block on the exact
    // model the art critic uses, so /api/health surfaces a broken vision
    // call directly instead of leaving it to fail silently in the forge.
    try {
      const onePxPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const cv = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: onePxPng } },
              { type: 'text', text: 'Reply OK.' },
            ],
          }],
        }),
      });
      out.critic_vision = cv.ok ? 'ok' : { status: cv.status, body: (await cv.text()).slice(0, 300) };
    } catch (e) { out.critic_vision = { error: String(e).slice(0, 200) }; }
  }
  try {
    const { getStore } = await import('@netlify/blobs');
    const strong = getStore({ name: 'machine-art', consistency: 'strong' });
    const eventual = getStore('machine-art');
    await strong.set('__health__', 'ok');
    const vs = await strong.get('__health__', { type: 'text' });
    const ve = await eventual.get('__health__', { type: 'text' });
    const meta = await strong.getMetadata('__health__').catch(() => null);
    let keyCount = -1;
    try {
      const listing = await strong.list({ prefix: 'art/' });
      keyCount = listing.blobs?.length ?? -1;
    } catch { /* listing unsupported or failed */ }
    out.blobs = {
      strong_read: vs === 'ok' ? 'ok' : `got:${JSON.stringify(vs)?.slice(0, 60)}`,
      eventual_read: ve === 'ok' ? 'ok' : `got:${JSON.stringify(ve)?.slice(0, 60)}`,
      metadata_present: Boolean(meta),
      art_keys_visible: keyCount,
    };
    await strong.delete('__health__');
  } catch (e) { out.blobs = { error: String(e).slice(0, 250) }; }

  return Response.json(out);
};
