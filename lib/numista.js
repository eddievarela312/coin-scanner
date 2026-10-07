// Numista lookups. Only the N# may be stored long-term; everything else is fetched live.
import { env } from './env.js';
const BASE = 'https://api.numista.com/v3';
const KEY = () => env('NUMISTA_API_KEY', 'NUMISTA_KEY');
export const numistaOn = () => !!KEY();

async function nget(path) {
  const r = await fetch(BASE + path, { headers: { 'Numista-API-Key': KEY() } });
  if (!r.ok) throw new Error(`Numista ${r.status} ${path.split('?')[0]}`);
  return r.json();
}

let issuersCache = null; // metadata: allowed to cache up to 7 days; per-instance memory is far less
async function issuerCode(country) {
  if (!country) return null;
  try {
    if (!issuersCache) { const j = await nget('/issuers?lang=en'); issuersCache = j.issuers || j || []; }
    const c = country.toLowerCase().replace(/^the /, '').trim();
    const alias = { 'usa': 'united states', 'us': 'united states', 'united states of america': 'united states' }[c] || c;
    const exact = issuersCache.find((i) => (i.name || '').toLowerCase() === alias);
    return (exact || issuersCache.find((i) => (i.name || '').toLowerCase().startsWith(alias)) || {}).code || null;
  } catch (_) { return null; }
}

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
function score(t, coin) {
  let s = 0;
  const y = parseInt(coin.year, 10);
  if (y && t.min_year && t.max_year) s += (y >= t.min_year && y <= t.max_year) ? 5 : -5;
  const tw = new Set(words(t.title));
  for (const w of words(`${coin.denomination} ${coin.series || ''} ${coin.numista_query || ''}`)) if (tw.has(w)) s += 1;
  if (t.category && t.category !== 'coin') s -= 3;
  return s;
}

export async function numistaLookup(coin) {
  if (!numistaOn()) return null;
  const issuer = await issuerCode(coin.country);
  const queries = [coin.numista_query, [coin.denomination, coin.series].filter(Boolean).join(' '), coin.denomination].filter(Boolean);
  let best = null;
  for (const q of [...new Set(queries)]) {
    const params = new URLSearchParams({ q, category: 'coin', count: '25', lang: 'en' });
    if (issuer) params.set('issuer', issuer);
    let j; try { j = await nget('/types?' + params); } catch (_) { continue; }
    const ranked = (j.types || []).map((t) => ({ t, s: score(t, coin) })).sort((a, b) => b.s - a.s);
    if (ranked[0] && (!best || ranked[0].s > best.s)) best = ranked[0];
    if (best && best.s >= 6) break;
  }
  if (!best || best.s < 4) return { matched: false, issuer };

  const type = await nget(`/types/${best.t.id}?lang=en`);
  let issue = null, prices = [];
  try {
    const issues = await nget(`/types/${best.t.id}/issues?lang=en`);
    const y = parseInt(coin.year, 10);
    const mm = String(coin.mint_mark || '').toUpperCase().replace('NONE', '');
    const sameYear = (issues || []).filter((i) => i.gregorian_year === y || i.year === y);
    issue = sameYear.find((i) => String(i.mint_letter || '').toUpperCase() === mm) || (sameYear.length === 1 ? sameYear[0] : null);
    if (issue) {
      const p = await nget(`/types/${best.t.id}/issues/${issue.id}/prices?currency=USD&lang=en`);
      prices = (p.prices || []).filter((x) => x && x.price > 0);
    }
  } catch (_) {}

  const km = (type.references || []).find((r) => r.catalogue && r.catalogue.code === 'KM');
  return {
    matched: true, confidence: best.s,
    id: type.id, url: type.url || `https://en.numista.com/${type.id}`, title: type.title,
    issuer: type.issuer && type.issuer.name, min_year: type.min_year, max_year: type.max_year,
    composition: type.composition && type.composition.text, weight_g: type.weight, size_mm: type.size, thickness_mm: type.thickness,
    km: km ? `KM# ${km.number}` : null,
    obverse_thumb: type.obverse && type.obverse.thumbnail, reverse_thumb: type.reverse && type.reverse.thumbnail,
    issue: issue ? { id: issue.id, year: issue.gregorian_year || issue.year, mint_letter: issue.mint_letter || null, mintage: issue.mintage || null, comment: issue.comment || null } : null,
    prices, // [{grade, price}] Numista estimates, USD
  };
}
