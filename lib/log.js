// Scan logging to Supabase (optional). Uses the REST endpoints directly so no
// packages are needed. If SUPABASE_URL / SUPABASE_SERVICE_KEY are missing,
// every function quietly does nothing and scanning still works.

// Accepts the names Supabase's own Vercel integration uses, too.
const env = (...names) => { for (const n of names) { const v = (process.env[n] || '').trim(); if (v) return v; } return ''; };
const URL_ = env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_PROJECT_URL').replace(/\/$/, '');
const KEY = env('SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
export const loggingStatus = () => ({
  supabase_url_found: !!URL_,
  supabase_url_looks_right: /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(URL_),
  supabase_key_found: !!KEY,
  supabase_env_names_present: Object.keys(process.env).filter((k) => /SUPABASE/i.test(k)).sort(),
});
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
