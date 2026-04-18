// Wikipedia Feed API — fetches random articles, caches for 6 hours
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
let cache = { timestamp: 0, articles: [] };

export async function onRequest(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };

  try {
    const now = Date.now();
    if (now - cache.timestamp > CACHE_TTL || cache.articles.length === 0) {
      cache.articles = await fetchRandomArticles();
      cache.timestamp = now;
    }
    return new Response(JSON.stringify({ articles: cache.articles, cached: new Date(cache.timestamp).toISOString() }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, articles: cache.articles }), { status: 500, headers });
  }
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'OGSApps/1.0 (https://ogsapps.cc)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchRandomArticles() {
  const articles = [];

  // 1. Get today's featured article
  try {
    const now = new Date();
    const dateStr = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${String(now.getUTCDate()).padStart(2,'0')}`;
    const featured = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/feed/featured/${dateStr}`);
    if (featured.tfa) {
      const t = featured.tfa;
      articles.push({
        id: 'featured-' + (t.pageid || Date.now()),
        title: t.title,
        extract: (t.extract || '').slice(0, 300),
        thumbnail: t.thumbnail?.source || t.originalimage?.source || null,
        categories: [],
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(t.title.replace(/ /g, '_'))}`,
        featured: true,
      });
    }
  } catch (e) { console.error('featured error:', e.message); }

  // 2. Get random articles in batches
  try {
    const randomData = await fetchJSON('https://en.wikipedia.org/w/api.php?action=query&list=random&rnlimit=50&rnnamespace=0&format=json');
    const titles = (randomData?.query?.random || []).map(a => a.title);

    // Fetch details in batches of 10
    for (let i = 0; i < titles.length; i += 10) {
      const batch = titles.slice(i, i + 10);
      try {
        const titleStr = batch.map(t => encodeURIComponent(t)).join('|');
        const detailData = await fetchJSON(
          `https://en.wikipedia.org/w/api.php?action=query&titles=${titleStr}&prop=extracts|pageimages&exintro=true&exsentences=3&explaintext=true&piprop=thumbnail&pithumbsize=400&format=json`
        );
        if (detailData?.query?.pages) {
          for (const page of Object.values(detailData.query.pages)) {
            if (page.missing !== undefined || page.invalid !== undefined) continue;
            articles.push({
              id: page.pageid,
              title: page.title,
              extract: (page.extract || '').slice(0, 300),
              thumbnail: page.thumbnail?.source || null,
              categories: [],
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
            });
          }
        }
      } catch (e) { /* skip batch */ }
    }
  } catch (e) { console.error('random error:', e.message); }

  return articles;
}
