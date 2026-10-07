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
    if (!issuersCache) { const j = await nget('/issuers?lang=en'); issuersCache = Array.isArray(j) ? j : (j.issuers || []); }
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
  let best = null; const tried = [];
  for (const q of [...new Set(queries)]) {
    const params = new URLSearchParams({ q, category: 'coin', count: '25', lang: 'en' });
    if (issuer) params.set('issuer', issuer);
    let j; try { j = await nget('/types?' + params); } catch (e) { tried.push({ q, error: String(e.message || e) }); continue; }
    const ranked = (j.types || []).map((t) => ({ t, s: score(t, coin) })).sort((a, b) => b.s - a.s);
    tried.push({ q, issuer, results: (j.types || []).length, top: ranked[0] ? `${ranked[0].t.title} (${ranked[0].t.min_year}-${ranked[0].t.max_year}) score ${ranked[0].s}` : null });
    if (ranked[0] && (!best || ranked[0].s > best.s)) best = ranked[0];
    if (best && best.s >= 6) break;
  }
  if (!best || best.s < 4) return { matched: false, issuer, tried };

  const type = await nget(`/types/${best.t.id}?lang=en`);
  let issue = null, prices = [];
  try {
    const issues = await nget(`/types/${best.t.id}/issues?lang=en`);
    const y = parseInt(coin.year, 10);
    const mm = String(coin.mint_mark || '').toUpperCase().replace('NONE', '');
    const sameYear = (issues || []).filter((i) => i.gregorian_year === y || i.year === y);
    const byMint = sameYear.filter((i) => String(i.mint_letter || '').toUpperCase() === mm);
    issue = byMint.length === 1 ? byMint[0] : (sameYear.length === 1 ? sameYear[0] : null);
    // Several varieties for the same year/mint (e.g. 1858 Large/Small Letters): combine their price ranges.
    const pool = issue ? [issue] : (byMint.length ? byMint : sameYear).slice(0, 4);
    const lists = await Promise.all(pool.map((i) => nget(`/types/${best.t.id}/issues/${i.id}/prices?currency=USD&lang=en`).then((p) => p.prices || []).catch(() => [])));
    const merged = {};
    for (const list of lists) for (const x of list) {
      if (!x || !(x.price > 0)) continue;
      const k = String(x.grade).toLowerCase();
      merged[k] = merged[k] ? { grade: x.grade, low: Math.min(merged[k].low, x.price), price: Math.max(merged[k].price, x.price) } : { grade: x.grade, low: x.price, price: x.price };
    }
    prices = Object.values(merged);
    if (!issue && pool.length > 1) issue = { varieties: pool.map((i) => i.comment || `${i.gregorian_year || i.year}${i.mint_letter ? ' ' + i.mint_letter : ''}`), year: pool[0].gregorian_year || pool[0].year, mint_letter: pool[0].mint_letter || null, mintage: null };
  } catch (_) {}

  const km = (type.references || []).find((r) => r.catalogue && r.catalogue.code === 'KM');
  return {
    matched: true, confidence: best.s,
    id: type.id, url: type.url || `https://en.numista.com/${type.id}`, title: type.title,
    tried,
    issuer: type.issuer && type.issuer.name, min_year: type.min_year, max_year: type.max_year,
    composition: type.composition && type.composition.text, weight_g: type.weight, size_mm: type.size, thickness_mm: type.thickness,
    km: km ? `KM# ${km.number}` : null,
    obverse_thumb: type.obverse && type.obverse.thumbnail, reverse_thumb: type.reverse && type.reverse.thumbnail,
    issue: issue ? (issue.varieties ? issue : { id: issue.id, year: issue.gregorian_year || issue.year, mint_letter: issue.mint_letter || null, mintage: issue.mintage || null, comment: issue.comment || null }) : null,
    prices, // [{grade, price}] Numista estimates, USD
  };
}
