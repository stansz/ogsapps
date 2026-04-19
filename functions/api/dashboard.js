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

    // Regex-based RSS/Atom parsing (DOMParser not available in Workers)
    const items = [];
    const titles = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi)];
    // Match RSS <link>...</link> and Atom <link rel="alternate" href="..."/>
    const rssLinks = [...text.matchAll(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/gi)];
    const atomLinks = [...text.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/gi)];
    // Prefer RSS links if found, otherwise use Atom
    const links = rssLinks.length > 1 ? rssLinks : atomLinks;
    const dates = [...text.matchAll(/<(?:pubDate|published|updated)>(.*?)<\/(?:pubDate|published|updated)>/gi)];

    // Skip first title (feed title)
    for (let i = 1; i < Math.min(titles.length, 11); i++) {
      items.push({
        title: titles[i][1].trim(),
        link: links[i - 1] ? links[i - 1][1].trim() : '',
        pubDate: dates[i - 1] ? dates[i - 1][1].trim() : '',
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}

// Deprecated, kept for compatibility
async function fetchFeed(name, url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ogsapps/1.0' } });
    if (!res.ok) return [];
    const text = await res.text();

    // Regex-based RSS parsing (DOMParser not available in Workers)
    const items = [];
    const itemRegex = /<item[\s>]|<entry[\s>]/gi;
    let match;

    // Simple extraction
    const titles = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi)];
    const links = [...text.matchAll(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/gi)];
    const dates = [...text.matchAll(/<pubDate>(.*?)<\/pubDate>/gi)];

    // Skip first title (feed title)
    for (let i = 1; i < Math.min(titles.length, 11); i++) {
      items.push({
        title: titles[i][1].trim(),
        link: links[i - 1] ? links[i - 1][1].trim() : '',
        pubDate: dates[i - 1] ? dates[i - 1][1].trim() : '',
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}
