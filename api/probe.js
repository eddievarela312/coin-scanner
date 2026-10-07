// Developer probe: shows exactly what Numista and Greysheet return, using the
// keys stored in Vercel. Protected by ADMIN_CODE. Never prints keys.
//   /api/probe?code=ADMIN_CODE&what=numista&q=1921 morgan dollar
//   /api/probe?code=ADMIN_CODE&what=greysheet-spec
//   /api/probe?code=ADMIN_CODE&what=greysheet&path=GetNodeRequest&NodeId=1

import { numistaLookup } from '../lib/numista.js';
import { greysheetPricing } from '../lib/greysheet.js';

const env = (...names) => {
  for (const n of names) {
    const k = Object.keys(process.env).find((key) => key.trim().toUpperCase() === n);
    if (k && String(process.env[k]).trim()) return String(process.env[k]).trim();
  }
  return '';
};
const NUMISTA_KEY = env('NUMISTA_API_KEY', 'NUMISTA_KEY');
const GS_KEY = env('GREYSHEET_API_KEY', 'CDN_API_KEY');
const GS_TOKEN = env('GREYSHEET_API_TOKEN', 'CDN_API_TOKEN');
const GS_BASE = env('GREYSHEET_BASE_URL') || 'https://cpgpublicapiv2.greysheet.com/api';

// Shorten big responses so the page stays readable.
function trim(v, depth = 0) {
  if (typeof v === 'string') return v.length > 160 ? v.slice(0, 160) + '…' : v;
  if (Array.isArray(v)) return v.slice(0, depth > 1 ? 3 : 5).map((x) => trim(x, depth + 1)).concat(v.length > 5 ? [`…${v.length} items total`] : []);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, depth > 4 ? '…' : trim(x, depth + 1)]));
  return v;
}
async function get(url, headers) {
  try {
    const r = await fetch(url, { headers });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch (_) { body = text.slice(0, 600); }
    return { status: r.status, body };
  } catch (e) { return { status: 0, error: String(e.message || e) }; }
}

export default async function handler(req, res) {
  const admin = process.env.ADMIN_CODE;
  if (!admin || req.query.code !== admin) return res.status(401).json({ error: 'Add ?code=ADMIN_CODE' });
  const what = req.query.what || 'status';
  const out = { what, numista_key_set: !!NUMISTA_KEY, greysheet_key_set: !!GS_KEY, greysheet_token_set: !!GS_TOKEN, greysheet_base: GS_BASE };

  if (what === 'numista') {
    const H = { 'Numista-API-Key': NUMISTA_KEY };
    const base = 'https://api.numista.com/v3';
    const q = encodeURIComponent(req.query.q || '1921 morgan dollar');
    const search = await get(`${base}/types?q=${q}&category=coin&count=3&lang=en`, H);
    out.search = { status: search.status, body: trim(search.body) };
    const first = search.body && search.body.types && search.body.types[0];
    if (first && first.id) {
      const type = await get(`${base}/types/${first.id}?lang=en`, H);
      out.type = { status: type.status, body: trim(type.body) };
      const issues = await get(`${base}/types/${first.id}/issues?lang=en`, H);
      out.issues = { status: issues.status, body: trim(issues.body) };
      const issue = Array.isArray(issues.body) ? issues.body[0] : null;
      if (issue && issue.id) {
        const prices = await get(`${base}/types/${first.id}/issues/${issue.id}/prices?currency=USD&lang=en`, H);
        out.prices = { status: prices.status, body: trim(prices.body) };
      }
    }
  } else if (what === 'greysheet-spec') {
    const hosts = ['https://cpgpublicapiv2.greysheet.com', 'https://cpgpublicapiv2beta.greysheet.com', 'https://cpgpublicapiv2dev.greysheet.com', 'https://publicapiv2.greysheet.com'];
    const paths = ['/swagger/v1/swagger.json', '/swagger/v2/swagger.json', '/swagger.json', '/swagger/docs/v1', '/api/swagger.json', '/openapi.json', '/swagger-ui/swagger.json'];
    out.tried = [];
    for (const h of hosts) {
      for (const p of paths) {
        const r = await get(h + p, {});
        out.tried.push(`${r.status} ${h}${p}`);
        if (r.status === 200 && r.body && typeof r.body === 'object' && r.body.paths) {
          out.spec_url = h + p;
          out.paths = Object.fromEntries(Object.entries(r.body.paths).map(([path, ops]) => [path, Object.entries(ops).map(([m, op]) => `${m.toUpperCase()} ${(op.parameters || []).map((x) => x.name + (x.required ? '*' : '')).join(', ')}`)]));
          return res.status(200).json(out);
        }
      }
      const ui = await get(h + '/swagger-ui', {});
      if (ui.status === 200 && typeof ui.body === 'string') out.tried.push(`200 ${h}/swagger-ui (html) ${ui.body.slice(0, 200)}`);
    }
  } else if (what === 'lookup') {
    // Full pipeline test, e.g. &country=United States&year=1921&mint_mark=S&denomination=1 Dollar&series=Morgan Dollar&pcgs=7300
    const q = req.query;
    const coin = { country: q.country, year: q.year, mint_mark: q.mint_mark, denomination: q.denomination, series: q.series, numista_query: q.numista_query || q.series };
    try { out.numista = await numistaLookup(coin); } catch (e) { out.numista = { error: String(e.message || e) }; }
    try { out.greysheet = await greysheetPricing({ pcgs: q.pcgs }, { owner: true }); } catch (e) { out.greysheet = { error: String(e.message || e) }; }
    if (q.raw === '1' && q.pcgs) {
      const r = await get(`${GS_BASE}/GetPricingRequest?PcgsNumber=${encodeURIComponent(q.pcgs)}&ApiLevel=advanced`, { 'x-api-key': GS_KEY, 'x-api-token': GS_TOKEN, Accept: 'application/json' });
      out.greysheet_raw = { status: r.status, body: trim(r.body) };
    }
  } else if (what === 'greysheet') {
    const path = String(req.query.path || 'GetNodeRequest').replace(/[^A-Za-z0-9_/-]/g, '');
    const params = new URLSearchParams(Object.entries(req.query).filter(([k]) => !['code', 'what', 'path'].includes(k)));
    const r = await get(`${GS_BASE}/${path}?${params}`, { 'x-api-key': GS_KEY, 'x-api-token': GS_TOKEN, Accept: 'application/json' });
    out.request = `${path}?${params}`;
    out.response = { status: r.status, body: trim(r.body), error: r.error };
  }
  return res.status(200).json(out);
}
