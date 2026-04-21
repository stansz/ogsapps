export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // CORS
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    // Fetch all data in parallel
    const city = url.searchParams.get('city') || 'Vancouver';
    const [weatherRes, ...newsResults] = await Promise.allSettled([
      fetchWeather(city),
      ...NEWS_FEEDS.map(f => fetchFeedFromConfig(f)),
    ]);

    const weather = weatherRes.status === 'fulfilled' ? weatherRes.value : null;

    const news = {};
    newsResults.forEach((r, i) => {
      news[NEWS_FEEDS[i].name] = r.status === 'fulfilled' ? r.value : [];
    });

    return new Response(JSON.stringify({ weather, news }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}

// Weather via wttr.in
async function fetchWeather(city) {
  const location = encodeURIComponent(city || 'Vancouver');
  const res = await fetch(`https://wttr.in/${location}?format=j1`, {
    headers: { 'User-Agent': 'ogsapps/1.0' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const cur = data.current_condition?.[0];
  const forecast = (data.weather || []).slice(0, 4).map(d => ({
    date: d.date,
    high: d.maxtempC,
    low: d.mintempC,
    icon: d.hourly?.[4]?.weatherCode || '113',
  }));
  return {
    current: {
      temp: cur?.temp_C || 'N/A',
      condition: cur?.weatherDesc?.[0]?.value || '',
      icon: cur?.weatherCode || '113',
      city: data.nearest_area?.[0]?.areaName?.[0]?.value || 'Vancouver',
    },
    forecast,
  };
}

// News feeds
const NEWS_FEEDS = [
  { name: 'World', url: 'https://www.cbc.ca/webfeed/rss/rss-topstories' },
  { name: 'Technology', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB' },
  { name: 'Business', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0BtVnVHZ0pWVXlnQVAB' },
  { name: 'Canada & BC', url: 'https://news.google.com/rss/search?q=site:cbc.ca+OR+site:globalnews.ca+british+columbia&hl=en-CA&gl=CA&ceid=CA:en' },
  { name: 'Local', urls: [
    'https://dailyhive.com/feed/vancouver',
    'https://yvrdeals.com/atom/1',
    'https://narcity.com/feeds/vancouver.rss',
    'https://vancouversbestplaces.com/feed',
  ] },
];

async function fetchFeedFromConfig(feed) {
  const urls = feed.urls || [feed.url];
  const results = await Promise.allSettled(
    urls.map(url => fetchSingleFeed(url))
  );
  const allItems = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allItems.push(...r.value);
    }
  });
  // Deduplicate by title (basic)
  const seen = new Set();
  return allItems.filter(item => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15); // Limit total items per feed
}

async function fetchSingleFeed(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ogsapps/1.0' } });
    if (!res.ok) return [];
    const text = await res.text();

    // Parse by extracting <item>...</item> or <entry>...</entry> blocks
    const items = [];
    const itemBlocks = [...text.matchAll(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi)];
    for (const block of itemBlocks) {
      const content = block[0];
      const titleMatch = content.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      // RSS: <link>url</link>, Atom: <link href="url" .../>
      let linkMatch = content.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      if (!linkMatch) linkMatch = content.match(/<link[^>]+href="([^"]+)"/i);
      const dateMatch = content.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);
      if (titleMatch) {
        const link = linkMatch ? linkMatch[1].trim() : '';
        // Skip empty or feed-level links
        if (link && !link.includes('news.google.com') && link.startsWith('http')) {
          items.push({
            title: titleMatch[1].trim(),
            link,
            pubDate: dateMatch ? dateMatch[1].trim() : '',
          });
        }
      }
    }
    return items.slice(0, 15);
  } catch (e) {
    return [];
  }
}

// Deprecated fetchFeed removed — fetchFeedFromConfig handles all feeds
