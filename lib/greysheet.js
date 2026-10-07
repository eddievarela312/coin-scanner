// Greysheet (CDN) pricing by PCGS number. No text search exists in the API.
// Wholesale values (GreyVal etc.) are only returned to the owner (internal use per CDN terms).
import { env } from './env.js';
const BASE = () => env('GREYSHEET_BASE_URL') || 'https://cpgpublicapiv2.greysheet.com/api';
export const greysheetOn = () => !!(env('GREYSHEET_API_KEY', 'CDN_API_KEY') && env('GREYSHEET_API_TOKEN', 'CDN_API_TOKEN'));

async function gget(path, params) {
  const r = await fetch(`${BASE()}/${path}?${new URLSearchParams(params)}`, {
    headers: { 'x-api-key': env('GREYSHEET_API_KEY', 'CDN_API_KEY'), 'x-api-token': env('GREYSHEET_API_TOKEN', 'CDN_API_TOKEN'), Accept: 'application/json' },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(`Greysheet ${r.status}`);
  return j;
}

// Walk any response shape and collect pricing rows / a collectible name.
function collect(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  if ('CpgVal' in node || 'GradeLabel' in node || 'GreyVal' in node) out.rows.push(node);
  for (const k of ['Name', 'CollectibleName', 'Title', 'Description']) {
    if (!out.name && typeof node[k] === 'string' && node[k] && !/requires apiLevel/i.test(node[k]) && ('GsId' in node || 'Gsid' in node || 'PcgsNumber' in node || 'Id' in node)) out.name = node[k];
  }
  for (const k of ['GsId', 'Gsid', 'GSID']) if (!out.gsid && node[k]) out.gsid = node[k];
  Object.values(node).forEach((v) => { if (v && typeof v === 'object') collect(v, out); });
}

const num = (v) => (typeof v === 'number' && v > 0) ? v : (typeof v === 'string' && parseFloat(v) > 0 ? parseFloat(v) : null);

export async function greysheetPricing({ pcgs, ngc, gsid }, { owner }) {
  if (!greysheetOn() || !(pcgs || ngc || gsid)) return null;
  const params = {};
  if (gsid) params.Gsid = gsid; else if (pcgs) params.PcgsNumber = pcgs; else params.NgcId = ngc;
  if (owner) params.ApiLevel = 'advanced';
  let j;
  try { j = await gget('GetPricingRequest', params); }
  catch (e) {
    if (!owner) throw e;
    delete params.ApiLevel; j = await gget('GetPricingRequest', params); // plan may be Basic
  }
  const out = { rows: [], name: null, gsid: null };
  collect(j, out);
  const prices = out.rows.map((r) => ({
    grade: num(r.Grade), label: r.GradeLabel || null, cac: !!r.IsCac,
    cpg: num(r.CpgVal),
    ...(owner ? { grey: num(r.GreyVal), pcgs_guide: num(r.PcgsVal), ngc_guide: num(r.NgcVal), bluebook: num(r.BlueBookVal) } : {}),
  })).filter((p) => p.cpg || p.grey);
  return { name: out.name, gsid: out.gsid, pcgs: pcgs || null, prices, access_denied: j && j.PermitAccess === false && !prices.length ? (j.AccessDeniedMessage || 'access denied') : undefined };
}


/* ---------- Catalog browse: find a coin without a PCGS number ----------
   Greysheet has no text search, so walk the catalog tree:
   U.S. Coins -> denomination -> series -> ... -> collectibles, matching names.
   Catalog structure is cached in memory up to 12h (CDN allows internal caching up to 24h). */
const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 12 * 3600 * 1000) return hit.v;
  const v = await fn(); cache.set(key, { t: Date.now(), v }); return v;
}
const listOf = (j) => (j && (Array.isArray(j.Data) ? j.Data : Array.isArray(j) ? j : [])) || [];
const children = (id) => cached(`n${id}`, async () => listOf(await gget('GetNodeChildrenRequest', { NodeId: id })));
const collectibles = (id) => cached(`c${id}`, async () => listOf(await gget('GetCollectibleByNodeRequest', { NodeId: id })));

const SYN = {
  cent: ['cent', 'cents', 'penny', '1c'], nickel: ['nickel', 'nickels', 'five', '5c'],
  dime: ['dime', 'dimes', '10c'], quarter: ['quarter', 'quarters', '25c'], half: ['half', 'halves', '50c'],
  dollar: ['dollar', 'dollars', '$1'], eagle: ['eagle', 'eagles', 'gold'],
};
const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
function wantWords(coin) {
  const w = new Set(toks(`${coin.denomination} ${coin.series} ${coin.coin_name}`));
  const d = String(coin.denomination || '').toLowerCase();
  if (/\b1 ?cent|^cent|penny/.test(d)) {
    SYN.cent.forEach((x) => w.add(x));
    w.add(parseInt(coin.year, 10) >= 1856 ? 'small' : 'large'); // US cents went small in 1856-57
  }
  if (/5 ?cents?|nickel/.test(d)) SYN.nickel.forEach((x) => w.add(x));
  if (/10 ?cents?|dime/.test(d)) SYN.dime.forEach((x) => w.add(x));
  if (/25 ?cents?|quarter/.test(d)) SYN.quarter.forEach((x) => w.add(x));
  if (/50 ?cents?|half/.test(d)) SYN.half.forEach((x) => w.add(x));
  if (/dollar/.test(d) && !/half/.test(d)) SYN.dollar.forEach((x) => w.add(x));
  return w;
}
function nodeScore(name, want, proof) {
  const n = toks(name);
  let s = n.filter((t) => want.has(t)).length;
  if (/proof|pr\b|\bpf\b/i.test(name) && !proof) s -= 2;
  if (/pattern|error|counterfeit/i.test(name)) s -= 3;
  return s;
}
const yearMintRe = (year, mm) => mm && mm !== 'NONE'
  ? new RegExp(`\\b${year}\\s*-\\s*${mm}\\b`, 'i')
  : new RegExp(`\\b${year}\\b(?!\\s*-\\s*[A-Z]{1,2}\\b)`, 'i');

// Year range printed in a node name, e.g. "Flying Eagle Cents (1856-1858)".
function rangeOf(name) {
  const m = String(name || '').match(/(\d{4})\s*[-–]\s*(\d{2,4}|date|present)/i);
  if (!m) return null;
  let hi = m[2];
  if (/^\d{2}$/.test(hi)) hi = m[1].slice(0, 2) + hi;
  return [parseInt(m[1], 10), /^\d{4}$/.test(hi) ? parseInt(hi, 10) : 9999];
}

export async function greysheetFind(coin, { owner }) {
  if (!greysheetOn() || !/united states|^usa?$/i.test(String(coin.country || '')) || !coin.year) return null;
  const want = wantWords(coin);
  const proof = /proof/i.test(String(coin.coin_name || ''));
  const y = parseInt(coin.year, 10);
  const mm = String(coin.mint_mark || '').toUpperCase().replace(/[^A-Z]/g, '') || 'NONE';
  const re = yearMintRe(coin.year, mm);
  const tried = [];
  let visits = 0;

  // Depth-first search with backtracking: try the best few branches, skip ones whose
  // printed year range excludes the coin, stop at the first node listing the year.
  async function search(nodeId, depth, trail) {
    if (depth > 6 || visits > 14) return null;
    visits++;
    const kids = await children(nodeId).catch(() => []);
    if (!kids.length) {
      const items = await collectibles(nodeId).catch(() => []);
      let matches = items.filter((c) => re.test(String(c.Name || c.Title || '')));
      if (!proof) matches = matches.filter((c) => !/\b(PR|PF|Proof)\b/i.test(String(c.Name || '')));
      tried.push(`${trail.join(' › ')} (${items.length} items, ${matches.length} match)`);
      return matches.length ? { matches, trail } : null;
    }
    const ranked = kids
      .filter((k) => { const r = rangeOf(k.Name); return !r || (y >= r[0] && y <= r[1]); })
      .map((k) => { const r = rangeOf(k.Name); return { k, s: nodeScore(k.Name, want, proof) + (r ? 2 : 0) }; })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);
    for (const { k } of ranked) {
      // A node can hold both sub-nodes and coins; check its own coins first when it has them.
      if ((k.CollectibleChildrenCountLive || 0) > 0) {
        const items = await collectibles(k.Id).catch(() => []);
        let matches = items.filter((c) => re.test(String(c.Name || c.Title || '')));
        if (!proof) matches = matches.filter((c) => !/\b(PR|PF|Proof)\b/i.test(String(c.Name || '')));
        if (matches.length) return { matches, trail: [...trail, k.Name] };
        if (!(k.NodeChildrenCountLive > 0)) { tried.push(`${[...trail, k.Name].join(' › ')} (${items.length} items, 0 match)`); continue; }
      }
      const found = await search(k.Id, depth + 1, [...trail, k.Name]);
      if (found) return found;
    }
    if (!ranked.length) tried.push(`${trail.join(' › ') || 'U.S. Coins'} (no fitting branch)`);
    return null;
  }

  const found = await search(1, 0, []);
  const idOf = (c) => c.GsId || c.Gsid || c.GSID || c.Id;
  const matches = found ? found.matches.slice(0, 5) : [];
  const varieties = await Promise.all(matches.map(async (c) => {
    const p = await greysheetPricing({ gsid: idOf(c) }, { owner }).catch(() => null);
    return { name: c.Name, gsid: idOf(c), prices: (p && p.prices) || [] };
  }));
  return { path: found ? found.trail : tried.slice(-3), searched: visits, varieties: varieties.filter((v) => v.prices.length) };
}
