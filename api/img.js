// Shows Numista reference images. Numista blocks images embedded on other sites,
// so the server fetches the image and passes it through (nothing is stored).
// Only Numista image URLs are allowed, so this can't be used as an open proxy.
export default async function handler(req, res) {
  const u = String(req.query.u || '');
  let url;
  try { url = new URL(u); } catch (_) { return res.status(400).end(); }
  if (url.protocol !== 'https:' || !/(^|\.)numista\.com$/.test(url.hostname) || !/\.(jpe?g|png|webp|gif)$/i.test(url.pathname)) return res.status(400).end();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'CoinScanner/1.0', Referer: 'https://en.numista.com/' } });
    if (!r.ok) return res.status(r.status).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (_) { res.status(502).end(); }
}
