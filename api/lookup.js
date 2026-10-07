// After Claude identifies a coin, fetch verified specs (Numista) and pricing (Greysheet) in parallel.
import { numistaLookup } from '../lib/numista.js';
import { greysheetPricing } from '../lib/greysheet.js';

// Does Greysheet's collectible name plausibly describe the identified coin?
function nameMatches(name, coin) {
  if (!name) return null; // unknown: let the client show it with the name for the dealer to judge
  const n = name.toLowerCase();
  const year = String(coin.year || '');
  if (year && !n.includes(year)) return false;
  const mm = String(coin.mint_mark || '').toUpperCase();
  if (mm && mm !== 'NONE' && year && !new RegExp(`${year}\\s*-?\\s*${mm}\\b`, 'i').test(name)) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const code = process.env.APP_ACCESS_CODE;
  if (!code || req.headers['x-access-code'] !== code) return res.status(401).json({ error: 'need_code' });
  const owner = !!process.env.ADMIN_CODE && req.headers['x-admin-code'] === process.env.ADMIN_CODE;
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const coin = body.coin || {};

  const slab = coin.slab || {};
  const pcgs = String(slab.pcgs_number || coin.pcgs_number || '').replace(/\D/g, '') || null;
  const ngc = String(slab.ngc_id || '').replace(/\D/g, '') || null;

  const [numista, grey] = await Promise.allSettled([
    numistaLookup(coin),
    greysheetPricing({ pcgs, ngc }, { owner }),
  ]);
  const gs = grey.status === 'fulfilled' ? grey.value : { error: String(grey.reason && grey.reason.message || grey.reason) };
  if (gs && gs.prices) gs.name_check = nameMatches(gs.name, coin);
  return res.status(200).json({
    owner,
    numista: numista.status === 'fulfilled' ? numista.value : { error: String(numista.reason && numista.reason.message || numista.reason) },
    greysheet: gs,
    attribution: { numista: 'Coin data from Numista', cdn: 'CPG® values from CDN Publishing / Greysheet' },
  });
}
