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
