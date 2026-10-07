// Coin identification: the phone sends photos here; this function adds the
// secret API key and asks Claude. The key never reaches the browser.
//
// Vercel environment variables:
//   ANTHROPIC_API_KEY  (required)  your key from console.anthropic.com
//   APP_ACCESS_CODE    (required)  a code you choose; testers type it once
//   CLAUDE_MODEL       (optional)  defaults to claude-sonnet-5-5

import { insertScan, uploadPhoto, loggingOn } from '../lib/log.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_IMAGE_B64 = 3_000_000; // ~2.2 MB per photo after JPEG re-encode

const buildPrompt = (hints, n) => `You are an expert numismatist helping a coin dealer identify a coin at a coin show.
${n >= 2 ? 'Image 1 is the obverse (front); image 2 is the reverse (back).' : n === 1 ? 'The image shows one side of the coin.' : 'No photos: identify from the dealer\'s details only.'}
The coin may be raw or in a PCGS, NGC, ANACS or other slab. If slabbed, read the label: service, grade, cert number, label text.

Read every legend, the date and the mint mark carefully. Check where the mint mark sits for this series (for example, Morgan dollars: reverse, below the wreath). Never invent a mint mark you cannot see. If no mint mark is visible where the series would show one, use "None". If you cannot read something, list it in uncertain_fields and lower your confidence. Prefer an honest "Low" over a confident wrong answer.
${hints ? '\nThe dealer has corrected or supplied these details; treat them as correct unless the photos clearly contradict them:\n' + hints + '\n' : ''}
Reply with only this JSON object:
{
 "identified": true,
 "coin_name": "e.g. 1921-S Morgan Dollar",
 "country": "", "denomination": "", "year": "",
 "mint_mark": "letter, or \"None\", or \"\" if unreadable",
 "mint_name": "e.g. San Francisco",
 "km_number": "Krause KM# if known, else \"\"",
 "series": "e.g. Morgan Dollar, Libertad, Walking Liberty Half",
 "numista_query": "2-4 words that appear in the coin's Numista catalog title, e.g. \"Morgan Dollar\" or \"Onza Libertad\"",
 "pcgs_number": "PCGS coin number for this exact date/mint/variety ONLY if you are confident, else \"\"",
 "composition": "", "fineness": "e.g. .900", "weight_g": null, "asw_oz": null, "agw_oz": null, "diameter_mm": null, "mintage": "",
 "is_bullion_like": false,
 "grade_sensitive": false,
 "slab": null,
 "suggested_grades": ["VF", "XF"],
 "grade_note": "one short sentence on visible wear",
 "uncertain_fields": ["mint_mark"],
 "confidence": "High",
 "candidates": [{"coin_name": "", "why": ""}],
 "rough_value_usd": {"VF": [60, 80]},
 "photo_feedback": ""
}
Rules:
- identified: false if you cannot tell what the coin is.
- uncertain_fields uses only: country, denomination, year, mint_mark.
- is_bullion_like: true when value is mostly metal (90% US silver in circulated grades, modern bullion, gold bullion coins). Then suggested_grades is [] and rough_value_usd uses the key "ANY".
- grade_sensitive: true when one grade step changes value a lot (key dates, mint-state Morgans, high-grade type coins).
- slab: null, or {"service": "PCGS", "grade": "MS63", "cert": "", "label_text": "", "pcgs_number": "", "ngc_id": ""}. On PCGS labels the coin number is printed with the cert (e.g. "7296.63/12345678": coin number 7296, grade 63). Copy numbers exactly as printed; leave "" if not readable.
- suggested_grades: one or two adjacent grades from VG, F, VF, XF, AU, UNC.
- candidates: 2 to 4 OTHER likely coins, including close dates, mint marks and varieties, each with a short reason.
- rough_value_usd: approximate typical US retail ranges for the grades in question, from general knowledge, only where you have a reasonable sense; otherwise {}. These are shown to the dealer labeled as rough estimates.
- weights in grams, ASW/AGW in troy ounces.
- photo_feedback: one short tip if the photos limited you (glare, blur, too small), else "".`;

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'not_configured' });
  const code = process.env.APP_ACCESS_CODE;
  if (!code || req.headers['x-access-code'] !== code) return res.status(401).json({ error: 'need_code' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch (_) { return res.status(400).json({ error: 'bad_request', detail: 'Request body was not valid JSON.' }); }
  const hints = String(body.hints || '').slice(0, 1000);
  const images = Array.isArray(body.images) ? body.images.slice(0, 2).filter((x) => typeof x === 'string') : [];
  if (images.some((x) => x.length > MAX_IMAGE_B64)) return res.status(413).json({ error: 'image_rejected' });

  const tester = String(req.headers['x-tester'] || '').slice(0, 60);
  const t0 = Date.now();
  // Save the scan (photos + result) for accuracy review. Never blocks a scan on failure.
  const log = async (fields) => {
    if (!loggingOn()) return null;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const rand = Math.random().toString(36).slice(2, 8);
    const paths = (await Promise.all(images.map((b64, i) => uploadPhoto(`${stamp}-${rand}-${i ? 'rev' : 'obv'}.jpg`, b64)))).filter(Boolean);
    return insertScan({ tester, hints, photo_paths: paths, server_ms: Date.now() - t0, ...fields });
  };

  const content = [
    ...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    { type: 'text', text: buildPrompt(hints, images.length) },
  ];

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content }] }),
    });
  } catch (e) {
    const detail = 'Could not reach Claude: ' + String(e && e.message || e);
    await log({ error: detail });
    return res.status(502).json({ error: 'upstream_error', detail });
  }
  if (r.status === 429) return res.status(429).json({ error: 'rate_limited' });
  if (r.status === 401 || r.status === 403) return res.status(500).json({ error: 'not_configured' });
  if (!r.ok) {
    const raw = await r.text();
    let detail = raw.slice(0, 300);
    try { detail = JSON.parse(raw).error.message; } catch (_) {}
    await log({ error: `Claude ${r.status}: ${detail}` });
    if (/credit balance/i.test(detail)) return res.status(402).json({ error: 'no_credit', detail });
    return res.status(502).json({ error: 'upstream_error', detail: `Claude returned ${r.status}: ${detail}` });
  }

  const out = await r.json();
  const text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const json = extractJson(text);
  if (!json) { await log({ error: 'invalid_json', result: { raw: text.slice(0, 2000) } }); return res.status(502).json({ error: 'invalid_json' }); }
  const scanId = await log({ coin_name: json.coin_name || null, confidence: json.confidence || null, result: json });
  return res.status(200).json({ ...json, scan_id: scanId });
}
