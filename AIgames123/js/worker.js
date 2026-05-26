// ════════════════════════════════════════════════════════
//  Cloudflare Worker: Supabase Storage caching proxy
//
//  Why: Cloudflare has unlimited free egress on cached responses.
//  By fronting Supabase Storage with this Worker, the FIRST request
//  for any file goes to Supabase (counts against egress), but EVERY
//  subsequent request is served from Cloudflare's edge cache.
//
//  Result: 90%+ reduction in Supabase egress, no code changes in
//  the app beyond pointing image/iframe URLs at this CDN.
//
//  Deploy:
//    1. Edit SUPABASE_STORAGE_BASE below with your project ref
//    2. cd into this directory
//    3. npm install -g wrangler
//    4. wrangler login
//    5. wrangler deploy
//
//  Or via Cloudflare Dashboard:
//    Workers & Pages → Create → Hello World → paste this code
//    Then add a Custom Domain: cdn.aigames123.com
// ════════════════════════════════════════════════════════

// ⚠️ FILL IN with your new US Supabase project's storage base URL
const SUPABASE_STORAGE_BASE =
  'https://YOUR-NEW-PROJECT-REF.supabase.co/storage/v1/object/public/game-files';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only allow GET / HEAD for safety. POST/PUT/DELETE would let
    // someone use our cdn URL to write to Supabase, which we don't want.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Block path-traversal attempts
    if (url.pathname.includes('..') || url.pathname.includes('//')) {
      return new Response('Bad request', { status: 400 });
    }

    // Build the upstream Supabase URL
    const upstreamUrl = `${SUPABASE_STORAGE_BASE}${url.pathname}`;

    // Use Cloudflare's edge cache. The same URL = same cache entry.
    const cache = caches.default;
    const cacheKey = new Request(upstreamUrl, { method: 'GET' });

    // Try cache first
    let response = await cache.match(cacheKey);
    if (response) {
      // Add a debug header so we can verify cache hits in DevTools
      response = new Response(response.body, response);
      response.headers.set('X-Cache', 'HIT');
      return response;
    }

    // Cache miss — fetch from Supabase
    const upstream = await fetch(upstreamUrl, {
      // cf options tell Cloudflare to also cache at the edge level
      cf: {
        cacheTtl: 31536000,        // 1 year for successful responses
        cacheEverything: true,
      },
    });

    if (!upstream.ok) {
      // Don't cache errors aggressively — they may be transient
      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
        headers: { 'X-Cache': 'MISS-ERROR' },
      });
    }

    // Wrap response with strong cache headers + cache it for next time
    response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    response.headers.set('X-Cache', 'MISS');

    // Permissive CORS — these are public assets meant to be loaded
    // cross-origin (the game iframe loads from a different origin
    // than the assets in some cases).
    response.headers.set('Access-Control-Allow-Origin', '*');

    // Write to cache asynchronously so we don't slow down this response
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  },
};
