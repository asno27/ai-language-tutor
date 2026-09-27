// worker/sync.js - 기기 간 동기화 API (Phase 2.5)
//
// POST /api/sync   헤더: Authorization: Bearer <동기화 코드>
// 요청: { since, paging?, changes: [{ kind, id, data, updatedAt, deleted }] }
// 응답: { success, serverTime, hasMore, cursor, changes: [...] }
//
// - 동기화 코드 원문은 저장하지 않고 SHA-256 해시로만 사용자 구분
// - 같은 항목은 updatedAt이 더 최근인 쪽이 이김 (삭제도 deleted=1로 기록해 다른 기기에 전파)
// - server_ts(마이크로초 단위, 행마다 고유)로 "since 이후 바뀐 것"만 돌려줌

const SYNC_KINDS = new Set(['vocab', 'daily_set', 'setting']);
const MAX_CHANGES = 500;
const MAX_ITEM_CHARS = 30000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 1000;
const OVERLAP_US = 5_000_000; // 5초: 동시에 저장된 다른 기기의 변경을 놓치지 않도록 겹쳐서 조회
const MIN_CODE_CHARS = 24;

let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_items (
      sync_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      server_ts INTEGER NOT NULL,
      PRIMARY KEY (sync_hash, kind, id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sync_items_ts ON sync_items (sync_hash, server_ts)'),
  ]);
  schemaReady = true;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function handleSync(request, env, cors, json) {
  if (!env.DB) return json({ success: false, detail: 'Sync storage (D1) is not configured' }, 503, cors);

  const code = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (code.length < MIN_CODE_CHARS) return json({ success: false, detail: 'Invalid sync code' }, 401, cors);

  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
    return json({ success: false, detail: 'Request too large' }, 413, cors);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, detail: 'Invalid JSON body' }, 400, cors); }

  const since = Number.isFinite(body?.since) ? body.since : 0;
  const changes = Array.isArray(body?.changes) ? body.changes : [];
  if (changes.length > MAX_CHANGES) return json({ success: false, detail: `Too many changes (max ${MAX_CHANGES})` }, 413, cors);

  const db = env.DB;
  await ensureSchema(db);
  const hash = await sha256Hex(code);
  const nowUs = Date.now() * 1000;

  const upsert = db.prepare(`INSERT INTO sync_items (sync_hash, kind, id, data, updated_at, deleted, server_ts)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT (sync_hash, kind, id) DO UPDATE SET
      data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, server_ts = excluded.server_ts
    WHERE excluded.updated_at > sync_items.updated_at`);
  const statements = [];
  for (const c of changes) {
    if (!SYNC_KINDS.has(c?.kind) || typeof c.id !== 'string' || !c.id || c.id.length > 300) continue;
    const updatedAt = Number(c.updatedAt);
    if (!Number.isFinite(updatedAt)) continue;
    const data = c.deleted ? null : JSON.stringify(c.data ?? null);
    if (data && data.length > MAX_ITEM_CHARS) continue;
    statements.push(upsert.bind(hash, c.kind, c.id, data, Math.round(updatedAt), c.deleted ? 1 : 0, nowUs + statements.length));
  }
  if (statements.length) await db.batch(statements);

  const from = body?.paging ? since : Math.max(0, since - OVERLAP_US);
  const { results } = await db.prepare(`SELECT kind, id, data, updated_at, deleted, server_ts FROM sync_items
    WHERE sync_hash = ?1 AND server_ts > ?2 ORDER BY server_ts LIMIT ?3`).bind(hash, from, PAGE_SIZE + 1).all();
  const hasMore = results.length > PAGE_SIZE;
  const page = results.slice(0, PAGE_SIZE);

  return json({
    success: true,
    serverTime: nowUs + statements.length,
    hasMore,
    cursor: page.length ? page[page.length - 1].server_ts : from,
    changes: page.map(r => ({
      kind: r.kind,
      id: r.id,
      data: r.data ? JSON.parse(r.data) : null,
      updatedAt: r.updated_at,
      deleted: !!r.deleted,
    })),
  }, 200, cors);
}
