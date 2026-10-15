// Airgem public leaderboard endpoint. Database credentials remain server-side.
const TABLE = 'airgem_score_ranking';
const TIMEOUT_MS = 6500;

function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

function safeErrorCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]{2,32}$/.test(value) ? value : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });

  const rawUrl = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!rawUrl || !key) return res.status(503).json({ error: 'Ranking database not configured', diagnostic: 'MISSING_ENV' });

  let base;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) throw new Error('Invalid URL');
    base = parsed.origin;
  } catch {
    return res.status(503).json({ error: 'Ranking temporarily unavailable', diagnostic: 'INVALID_SUPABASE_URL' });
  }

  const endpoint = `${base}/rest/v1/${TABLE}`;
  try {
    // A single request returns the leader and a total row count, even for an empty table.
    const response = await fetch(`${endpoint}?select=name,score,checked_at&order=score.desc,checked_at.desc&limit=1`, {
      headers: { ...authHeaders(key), Prefer: 'count=exact' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch { /* non-JSON upstream response */ }
      // Only expose the upstream HTTP status and machine-readable PostgREST code.
      // Never return raw upstream messages, request headers or credentials.
      return res.status(503).json({
        error: 'Ranking temporarily unavailable',
        diagnostic: 'SUPABASE_HTTP_ERROR',
        upstreamStatus: response.status,
        upstreamCode: safeErrorCode(body.code)
      });
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) return res.status(503).json({ error: 'Ranking temporarily unavailable', diagnostic: 'INVALID_RESPONSE' });
    const range = response.headers.get('content-range');
    const match = range && range.match(/\/(\d+)$/);
    const total = match ? Number(match[1]) : null;
    return res.status(200).json({ leader: rows[0] || null, total });
  } catch (error) {
    const diagnostic = error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? 'SUPABASE_TIMEOUT' : 'SUPABASE_NETWORK_ERROR';
    return res.status(503).json({ error: 'Ranking temporarily unavailable', diagnostic });
  }
};
