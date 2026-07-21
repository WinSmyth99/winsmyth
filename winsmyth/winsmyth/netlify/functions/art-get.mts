// Serves stored machine art from Netlify Blobs with immutable caching
// (keys are versioned by attempt, so cache-forever is safe).

import { getStore } from '@netlify/blobs';

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? '';
  if (!/^art\/rec[A-Za-z0-9]{14,17}\/([a-z0-9]+\/)?[a-z0-9-]+\.png$/.test(key)) {
    return new Response('Bad key', { status: 400 });
  }
  const store = getStore({ name: 'machine-art', consistency: 'strong' });
  const bytes = await store.get(key, { type: 'arrayBuffer' });
  if (!bytes) return new Response('Not found', { status: 404 });
  // The .png key suffix is historical; the symbol model (FLUX) returns
  // JPEG bytes. Serve the TRUE type from magic bytes — mislabelled media
  // types are the exact bug class that silently broke the art critic.
  const b = new Uint8Array(bytes.slice(0, 12));
  const type =
    b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
    : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
    : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 ? 'image/webp'
    : 'image/png';
  return new Response(bytes, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
