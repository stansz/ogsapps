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
    const [weatherRes, ...newsResults] = await Promise.allSettled([
      fetchWeather(),
      ...NEWS_FEEDS.map(f => fetchFeed(f.name, f.url)),
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
async function fetchWeather() {
  const res = await fetch('https://wttr.in/Vancouver?format=j1', {
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
  { name: 'World', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB' },
  { name: 'Technology', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB' },
  { name: 'Business', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB' },
  { name: 'Canada & BC', url: 'https://news.google.com/rss/search?q=site:cbc.ca+OR+site:globalnews.ca+british+columbia&hl=en-CA&gl=CA&ceid=CA:en' },
  { name: 'Vancouver', url: 'https://dailyhive.com/feed/vancouver' },
];

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
