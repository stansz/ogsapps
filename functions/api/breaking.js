export async function onRequest(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    const url = new URL(context.request.url);
    const hours = Math.min(parseInt(url.searchParams.get('hours') || '4'), 24);
    const query = url.searchParams.get('q') || '';

    let gdeltQ = 'sourcelang:english';
    if (query) gdeltQ += ` ${query}`;

    // Try GDELT directly (proxy via maps.ogsapps.cc is currently offline)
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(gdeltQ)}&mode=artlist&maxrecords=15&format=json&timespan=${hours}h`;
    const gdeltRes = await fetch(gdeltUrl, {
      headers: { 'User-Agent': 'ogsapps/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });

    if (!gdeltRes.ok) {
      return new Response(JSON.stringify({ breaking: [], error: `GDELT ${gdeltRes.status}` }), { headers });
    }

    const data = await gdeltRes.json();
    const items = (data.articles || []).map(a => ({
      title: (a.title || '').replace(/<[^>]+>/g, ''),
      link: a.url || '',
      pubDate: a.seendate || '',
      source: a.source || '',
    }));

    return new Response(JSON.stringify({ breaking: items }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ breaking: [], error: e.message }), { headers });
  }
}
