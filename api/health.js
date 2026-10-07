import { loggingStatus } from '../lib/log.js';
// Setup check. Open /api/health?code=YOUR_ACCESS_CODE in a browser.
// Shows whether the settings exist and whether Claude answers. Never shows the key.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

export default async function handler(req, res) {
  const out = {
    api_key_set: !!process.env.ANTHROPIC_API_KEY,
    api_key_looks_right: /^sk-ant-/.test(process.env.ANTHROPIC_API_KEY || ''),
    access_code_set: !!process.env.APP_ACCESS_CODE,
    model: MODEL,
    workspace_id_set: !!process.env.ANTHROPIC_WORKSPACE_ID,
    admin_code_set: !!process.env.ADMIN_CODE,
    ...loggingStatus(),
  };
  const code = process.env.APP_ACCESS_CODE;
  if (!code || req.query.code !== code) {
    out.claude_test = 'Add ?code=YOUR_ACCESS_CODE to the address to run the Claude test.';
    return res.status(200).json(out);
  }
  if (!out.api_key_set) { out.claude_test = 'Skipped: ANTHROPIC_API_KEY is missing.'; return res.status(200).json(out); }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}), 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }),
    });
    const text = await r.text();
    out.claude_status = r.status;
    if (r.ok) out.claude_test = 'Working';
    else {
      let msg = text.slice(0, 300);
      try { msg = JSON.parse(text).error.message; } catch (_) {}
      out.claude_test = 'Failed: ' + msg;
    }
  } catch (e) {
    out.claude_test = 'Failed to reach Claude: ' + String(e && e.message || e);
  }
  return res.status(200).json(out);
}
