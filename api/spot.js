// Live spot prices from metals.dev, shared by every scan.
// Cached at Vercel's edge for 10 minutes, so usage stays flat no matter how many people scan.
import { env } from '../lib/env.js';

export default async function handler(req, res) {
  // Accept the usual names, or any setting with "METAL" in its name.
  const metalNames = Object.keys(process.env).filter((k) => /METAL/i.test(k));
  const key = env('METALS_DEV_API_KEY', 'METALSDEV_API_KEY', 'METALS_API_KEY', 'METALS_DEV_KEY')
    || (metalNames.length ? String(process.env[metalNames[0]] || '').trim() : '');
  if (!key) return res.status(200).json({ ok: false, error: 'Add METALS_DEV_API_KEY in Vercel, then redeploy.', metal_settings_found: metalNames });
  try {
    const r = await fetch(`https://api.metals.dev/v1/latest?api_key=${encodeURIComponent(key)}&currency=USD&unit=toz`, { headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => null);
    const m = j && (j.metals || j.rates || {});
    const num = (v) => (typeof v === 'number' && v > 0 ? v : parseFloat(v) > 0 ? parseFloat(v) : null);
    const silver = num(m.silver), gold = num(m.gold);
    if (!r.ok || !silver || !gold) {
      return res.status(200).json({ ok: false, error: `metals.dev returned ${r.status}: ${j && (j.error_message || j.message || j.status) || 'unexpected format'}` });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=300');
    return res.status(200).json({
      ok: true, silver, gold, platinum: num(m.platinum), palladium: num(m.palladium),
      asOf: (j.timestamps && (j.timestamps.metal || j.timestamps.currency)) || new Date().toISOString(),
      source: 'metals.dev',
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Could not reach metals.dev: ' + String(e.message || e) });
  }
}
