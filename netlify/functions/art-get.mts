// Serves stored machine art from Netlify Blobs with immutable caching
// (keys are versioned by attempt, so cache-forever is safe).

import { getStore } from '@netlify/blobs';

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? '';
  if (!/^art\/rec[A-Za-z0-9]{14,17}\/[a-z0-9-]+\.png$/.test(key)) {
    return new Response('Bad key', { status: 400 });
  }
  const store = getStore({ name: 'machine-art', consistency: 'strong' });
  const bytes = await store.get(key, { type: 'arrayBuffer' });
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(bytes, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
