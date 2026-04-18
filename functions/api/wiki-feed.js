// Wikipedia Feed API — fetches random articles, caches for 6 hours
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const ARTICLES_PER_FETCH = 100;

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

async function fetchRandomArticles() {
  // Fetch random article titles
  const randomUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=random&rnlimit=50&rnnamespace=0&format=json';
  const trendingUrl = 'https://en.wikipedia.org/api/rest_v1/feed/featured/2026/04/18'; // We'll generate date dynamically

  const now = new Date();
  const dateStr = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${String(now.getUTCDate()).padStart(2,'0')}`;

  const [randomRes, trendingRes] = await Promise.allSettled([
    fetch(randomUrl).then(r => r.json()),
    fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${dateStr}`).then(r => r.json()).catch(() => null),
  ]);

  const articles = [];

  // Process random articles
  if (randomRes.status === 'fulfilled' && randomRes.value?.query?.random) {
    const titles = randomRes.value.query.random.map(a => a.title);
    // Get summaries in batches of 20
    for (let i = 0; i < titles.length; i += 20) {
      const batch = titles.slice(i, i + 20);
      const summaryUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${batch.map(encodeURIComponent).join('|')}&prop=extracts|pageimages|categories&exintro=true&exsentences=3&explaintext=true&piprop=thumbnail&pithumbsize=400&cllimit=5&format=json`;
      try {
        const detailRes = await fetch(summaryUrl);
        const detailData = await detailRes.json();
        if (detailData?.query?.pages) {
          for (const page of Object.values(detailData.query.pages)) {
            if (page.missing !== undefined) continue;
            articles.push({
              id: page.pageid,
              title: page.title,
              extract: page.extract || '',
              thumbnail: page.thumbnail?.source || null,
              categories: (page.categories || []).map(c => c.title.replace('Category:', '')),
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
            });
          }
        }
      } catch (e) { /* skip batch */ }
    }
  }

  // Process trending/featured articles
  if (trendingRes.status === 'fulfilled' && trendingRes.value) {
    const tfa = trendingRes.value.tfa;
    if (tfa) {
      articles.unshift({
        id: tfa.pageid || 'featured',
        title: tfa.title,
        extract: tfa.extract || '',
        thumbnail: tfa.thumbnail?.source || tfa.originalimage?.source || null,
        categories: (tfa.categories || []).map(c => typeof c === 'string' ? c : c.title),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(tfa.title.replace(/ /g, '_'))}`,
        featured: true,
      });
    }
  }

  return articles;
}
