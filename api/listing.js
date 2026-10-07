// Drafts a resale listing (eBay-style) from the coin data the dealer already confirmed.
// No photos are sent, so this is fast and cheap. Prices and data sources are never written into the text.
import { env } from '../lib/env.js';
const MODEL = () => env('CLAUDE_LISTING_MODEL') || env('CLAUDE_MODEL') || 'claude-sonnet-5-5';

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const code = process.env.APP_ACCESS_CODE;
  if (!code || req.headers['x-access-code'] !== code) return res.status(401).json({ error: 'need_code' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'not_configured' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const c = body.coin || {};
  const facts = Object.entries({
    Coin: c.name, Country: c.country, Denomination: c.denomination, Year: c.year, Mint: c.mint,
    Variety: c.variety, 'Catalog number': c.km, Composition: c.composition, Fineness: c.fineness,
    Weight: c.weight, Diameter: c.diameter, 'Silver content (oz)': c.asw, 'Gold content (oz)': c.agw,
    Grade: c.grade, 'Grading service': c.slab && c.slab.service, 'Slab grade': c.slab && c.slab.grade,
    'Cert number': c.slab && c.slab.cert, 'Bullion-type coin': c.bullion ? 'yes' : undefined,
  }).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join('\n');

  const prompt = `Write an eBay listing for this coin for a professional coin dealer. Use ONLY the facts below; never invent varieties, pedigrees, mintages or grades.

${facts}

Rules:
- title: at most 80 characters. Lead with year, mint mark, country (if not US) and denomination/series. Include grade or slab (e.g. "PCGS MS63") when known, and silver/gold when relevant. No ALL CAPS words except abbreviations (PCGS, NGC, KM). No emoji, no "L@@K", no "rare" unless it is a recognized key date.
- item_specifics: an object using eBay coin fields where known: "Certification" ("Uncertified" for raw coins), "Grade", "Year", "Mint Location", "Denomination", "Composition", "Circulated/Uncirculated", "Country/Region of Manufacture", "Coin", "KM Number". Omit unknowns.
- description: 2 short paragraphs of plain text. Describe the coin factually. For raw coins, say the grade is the seller's opinion and buyers should judge from the photos. For slabbed coins, mention the service, grade and cert number. Do not mention prices, price guides, data sources, or that the text was generated.
Reply with only JSON: {"title": "...", "item_specifics": {...}, "description": "..."}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({ model: MODEL(), max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return res.status(502).json({ error: 'upstream_error', detail: `Claude ${r.status}` });
    const out = await r.json();
    const text = (out.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
    const j = extractJson(text);
    if (!j || !j.title) return res.status(502).json({ error: 'invalid_json' });
    j.title = String(j.title).slice(0, 80);
    return res.status(200).json(j);
  } catch (e) {
    return res.status(502).json({ error: 'upstream_error', detail: String(e.message || e) });
  }
}
