// Read-only scan log for accuracy review.
// Open /api/scans?code=ADMIN_CODE  (add &photos=1 for temporary photo links, &limit=50)
import { listScans, signedUrl, loggingOn } from '../lib/log.js';

export default async function handler(req, res) {
  const admin = process.env.ADMIN_CODE;
  if (!admin || req.query.code !== admin) return res.status(401).json({ error: 'Add ?code=ADMIN_CODE. Set ADMIN_CODE in Vercel first.' });
  if (!loggingOn()) return res.status(200).json({ error: 'Logging is off. Add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel.' });
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const rows = await listScans(limit);
    const total = rows.length;
    const rated = rows.filter((r) => r.correct);
    const summary = {
      scans: total,
      errors: rows.filter((r) => r.error).length,
      rated: rated.length,
      marked_correct: rated.filter((r) => r.correct === 'yes').length,
      marked_wrong: rated.filter((r) => r.correct === 'no').length,
      avg_seconds: total ? Math.round(rows.reduce((a, r) => a + (r.server_ms || 0), 0) / total / 100) / 10 : null,
    };
    const withPhotos = req.query.photos === '1';
    const scans = await Promise.all(rows.map(async (r) => ({
      when: r.created_at, tester: r.tester, said: r.coin_name, confidence: r.confidence,
      correct: r.correct, really: r.corrected_to, hints: r.hints || undefined, error: r.error || undefined,
      seconds: r.server_ms ? Math.round(r.server_ms / 100) / 10 : null,
      uncertain: r.result && r.result.uncertain_fields, candidates: r.result && (r.result.candidates || []).map((c) => c.coin_name),
      photos: withPhotos && r.photo_paths ? await Promise.all(r.photo_paths.map((p) => signedUrl(p))) : undefined,
    })));
    return res.status(200).json({ summary, scans });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
