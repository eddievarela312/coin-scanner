// Scan logging to Supabase (optional). Uses the REST endpoints directly so no
// packages are needed. If SUPABASE_URL / SUPABASE_SERVICE_KEY are missing,
// every function quietly does nothing and scanning still works.

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
export const loggingOn = () => !!(URL_ && KEY);

const headers = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra });

export async function uploadPhoto(path, base64) {
  if (!loggingOn()) return null;
  try {
    const r = await fetch(`${URL_}/storage/v1/object/scan-photos/${path}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }),
      body: Buffer.from(base64, 'base64'),
    });
    return r.ok ? path : null;
  } catch (_) { return null; }
}

export async function insertScan(row) {
  if (!loggingOn()) return null;
  try {
    const r = await fetch(`${URL_}/rest/v1/scans`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (!r.ok) return null;
    const out = await r.json();
    return out && out[0] ? out[0].id : null;
  } catch (_) { return null; }
}

export async function updateScan(id, patch) {
  if (!loggingOn() || !id) return false;
  try {
    const r = await fetch(`${URL_}/rest/v1/scans?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    return r.ok;
  } catch (_) { return false; }
}

export async function listScans(limit = 200) {
  const r = await fetch(`${URL_}/rest/v1/scans?select=id,created_at,tester,hints,coin_name,confidence,server_ms,error,correct,corrected_to,photo_paths,result&order=created_at.desc&limit=${limit}`, { headers: headers() });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function signedUrl(path, seconds = 3600) {
  const r = await fetch(`${URL_}/storage/v1/object/sign/scan-photos/${path}`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.signedURL ? `${URL_}/storage/v1${j.signedURL}` : null;
}
