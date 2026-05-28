// ════════════════════════════════════════════════════════
//  /api/sitemap.js — Dynamic sitemap.xml generator
//
//  Generates a fresh sitemap on every request by querying Supabase
//  for the current list of games. Cached at the edge so Vercel
//  doesn't hammer Supabase on every search crawler hit.
//
//  Served at /sitemap.xml via the rewrite in vercel.json.
//
//  This file is a Vercel Serverless Function. It runs on Node.js,
//  not in the browser — `process.env` is available for secrets.
// ════════════════════════════════════════════════════════

// Static pages that are always present. URL relative to site root.
// `priority` and `changefreq` are hints Google mostly ignores in 2026
// but Bing/DuckDuckGo still consider; harmless to include.
const STATIC_ROUTES = [
    { path: '/',        priority: 1.0, changefreq: 'daily'   },
    { path: '/terms',   priority: 0.3, changefreq: 'monthly' },
    { path: '/privacy', priority: 0.3, changefreq: 'monthly' },
    { path: '/dmca',    priority: 0.3, changefreq: 'monthly' },
];

const SITE_URL = 'https://aigames123.com';

// Same slug logic as the client — keeps URLs in sync between sitemap
// and links the browser generates. Lowercase, alphanumeric + hyphens.
function slugify(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

// XML escape — sitemap is XML, so &, <, >, ', " need encoding.
function xmlEscape(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&apos;')
        .replace(/"/g, '&quot;');
}

export default async function handler(req, res) {
    // Vercel's automatic CORS rules don't apply to crawlers, but be explicit
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // Edge-cache for 1 hour, allow stale for 24h while revalidating.
    // Crawlers hitting in quick succession won't all bypass to Supabase.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    let games = [];
    try {
        // Direct REST call to Supabase (no SDK needed in this small function).
        // Uses the anon key, which has RLS-protected SELECT access.
        const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://shbfbsbbonepeskwpntg.supabase.co';
        const SUPABASE_ANON = process.env.SUPABASE_ANON || ''; // configure in Vercel env
        if (!SUPABASE_ANON) {
            console.warn('SUPABASE_ANON env not set; sitemap will only include static routes.');
        } else {
            // Fetch up to 5000 games. Sitemaps support up to 50K URLs; if we
            // ever pass 5K we should paginate or shard into sitemap-1.xml etc.
            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/games?select=id,name,created_at&order=created_at.desc&limit=5000`,
                {
                    headers: {
                        apikey: SUPABASE_ANON,
                        Authorization: `Bearer ${SUPABASE_ANON}`,
                    },
                }
            );
            if (r.ok) {
                games = await r.json();
            } else {
                console.error('Supabase fetch failed:', r.status, await r.text());
            }
        }
    } catch (err) {
        console.error('sitemap fetch error:', err);
        // Continue — better to return a static-only sitemap than to 500.
    }

    const today = new Date().toISOString().slice(0, 10);

    const urls = [
        // Static pages
        ...STATIC_ROUTES.map(r => `
  <url>
    <loc>${SITE_URL}${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`),
        // Each game gets its own URL using the id-slug convention.
        ...games.map(g => {
            const slug = slugify(g.name);
            const path = slug ? `/game/${g.id}-${slug}` : `/game/${g.id}`;
            const lastmod = (g.created_at || '').slice(0, 10) || today;
            return `
  <url>
    <loc>${SITE_URL}${xmlEscape(path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
        }),
    ].join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;

    res.status(200).send(xml);
}
