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

// Denomination profiles: Greysheet names use codes like 1C, 3cS, 5C, 10C, 25C, 50C, $1.
const DENOMS = [
  { test: /half\s*cent|1\/2\s*c/i, code: /\b(1\/2C|H1C|HC)\b/i, words: ['half', 'cent', 'cents'], wrong: /\b(large|small)\s+cents?\b|\b(2|3|two|three)[ -]?cents?\b|3c[sn]?\b/i },
  { test: /^(1|one)\s*cent|^cent|penny/i, code: /\b1C\b/i, words: ['cent', 'cents'], wrong: /\b(half|2|3|two|three)[ -]?cents?\b|\b3c[sn]?\b|\b2c\b|\b1\/2c\b/i },
  { test: /^(2|two)\s*cents?/i, code: /\b2C\b/i, words: ['two', 'cent', 'cents'], wrong: /\b(half|1|3|one|three)[ -]?cents?\b|\b3c[sn]?\b|large cents?|small cents?/i },
  { test: /^(3|three)\s*cents?/i, code: /\b3c[SN]?\b/i, words: ['three', '3', 'cent', 'cents'], wrong: /\b(half|1|2|one|two)[ -]?cents?\b|large cents?|small cents?/i },
  { test: /^(5|five)\s*cents?|nickel/i, code: /\b5C\b/i, words: ['nickel', 'nickels', 'five'], wrong: /half\s*dimes?|\bh10c\b|\b3cn\b|three cent/i },
  { test: /^(10|ten)\s*cents?|^dime/i, code: /\b10C\b/i, words: ['dime', 'dimes'], wrong: /half\s*dimes?|\bh10c\b|\b20c\b|twenty/i },
  { test: /^(25|twenty[- ]five)\s*cents?|^quarter(?! eagle)/i, code: /\b25C\b/i, words: ['quarter', 'quarters'], wrong: /half|\b50c\b|\b20c\b|eagle/i },
  { test: /^(50|fifty)\s*cents?|half\s*dollar/i, code: /\b50C\b/i, words: ['half', 'halves', 'dollar', 'dollars'], wrong: /quarter|\b25c\b/i },
  { test: /^(1|one)\s*dollar|^dollar|^\$1$/i, code: /(^|\s)[SGT]?\$1\b/i, words: ['dollar', 'dollars'], wrong: /half|\b50c\b|gold|\$2\.?5|\$5\b|\$10\b|\$20\b|eagle/i },
];
const GENERIC = new Set(['cent', 'cents', 'dollar', 'dollars', 'half', 'quarter', 'dime', 'nickel', 'silver', 'gold', 'coin', 'coins', 'the', 'of', 'type', 'us', 'united', 'states', 'large', 'small', 'letters', 'head']);
const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
function profile(coin) {
  const d = String(coin.denomination || '').trim();
  const p = DENOMS.find((x) => x.test.test(d)) || null;
  const series = new Set(toks(coin.series || coin.numista_query || '').filter((t) => !GENERIC.has(t) && !/^\d+$/.test(t)));
  const words = new Set(p ? p.words : toks(d));
  if (p && p.code.source.includes('1C') && !p.test.source.includes('half')) words.add(parseInt(coin.year, 10) >= 1856 ? 'small' : 'large');
  return { p, series, words };
}
function nodeScore(name, prof, proof) {
  if (prof.p && prof.p.wrong.test(name)) return -10;
  const n = toks(name);
  let s = 0;
  for (const t of n) { if (prof.series.has(t)) s += 3; else if (prof.words.has(t)) s += 1; }
  if (/proof|\bpr\b|\bpf\b/i.test(name) && !proof) s -= 2;
  if (/pattern|error|counterfeit|commemorative/i.test(name)) s -= 3;
  return s;
}
const okCollectible = (name, prof, re, proof) => {
  const n = String(name || '');
  if (!re.test(n)) return false;
  if (/\[type\]/i.test(n) || /\b\d{4}\s*[-–]\s*\d{2,4}\b/.test(n)) return false;
  if (prof.p && !prof.p.code.test(n)) return false;
  if (!proof && /\b(PR|PF|Proof)\b/i.test(n)) return false;
  return true;
};
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
  const prof = profile(coin);
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
      const matches = items.filter((c) => okCollectible(c.Name || c.Title, prof, re, proof));
      tried.push(`${trail.join(' › ')} (${items.length} items, ${matches.length} match)`);
      return matches.length ? { matches, trail } : null;
    }
    const ranked = kids
      .filter((k) => { const r = rangeOf(k.Name); return !r || (y >= r[0] && y <= r[1]); })
      .map((k) => { const r = rangeOf(k.Name); const base = nodeScore(k.Name, prof, proof); return { k, s: base > 0 && r ? base + 2 : base }; })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);
    for (const { k } of ranked) {
      // A node can hold both sub-nodes and coins; check its own coins first when it has them.
      if ((k.CollectibleChildrenCountLive || 0) > 0) {
        const items = await collectibles(k.Id).catch(() => []);
        const matches = items.filter((c) => okCollectible(c.Name || c.Title, prof, re, proof));
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
