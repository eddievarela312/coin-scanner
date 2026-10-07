// Records the tester's "Correct ID? Yes/No" answer and any correction.
import { updateScan } from '../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const code = process.env.APP_ACCESS_CODE;
  if (!code || req.headers['x-access-code'] !== code) return res.status(401).json({ error: 'need_code' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const patch = {};
  if (body.correct === 'yes' || body.correct === 'no') patch.correct = body.correct;
  if (typeof body.corrected_to === 'string') patch.corrected_to = body.corrected_to.slice(0, 300);
  const ok = await updateScan(String(body.scan_id || ''), patch);
  return res.status(200).json({ ok });
}
