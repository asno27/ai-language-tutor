// worker/ratelimit.js - IP별 요청 횟수 제한 (R-1: 주소를 아는 누구나 무료 AI 한도를 소진시키는 것을 막음)
//
// - 같은 IP에서 1분·하루 동안 보낸 요청 수를 D1에 세어, 한도를 넘으면 429를 돌려줌
// - IP 원문은 저장하지 않고 해시의 앞부분만 사용
// - 브라우저(허용된 출처)에서 온 요청과 출처 표시가 없는 요청(curl 등)의 한도를 따로 둠
// - D1 오류가 나도 사이트가 멈추지 않도록 그때는 제한하지 않고 통과시킴(fail-open)

const LIMITS = {
  llm:  { browser: { perMinute: 60,  perDay: 600  }, other: { perMinute: 10, perDay: 100 } },
  sync: { browser: { perMinute: 120, perDay: 2000 }, other: { perMinute: 20, perDay: 200 } },
};
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_CHANCE = 0.02;

let tableReady = false;

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} scope  'llm' | 'sync'
 * @param {boolean} hasOrigin  브라우저가 출처(Origin)를 붙여 보냈는지
 * @returns {null | { message: string, retryAfter: number }}  한도 초과면 안내, 아니면 null
 */
export async function checkRateLimit(env, request, scope, hasOrigin) {
  if (!env.DB || !LIMITS[scope]) return null;
  try {
    const db = env.DB;
    if (!tableReady) {
      await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (k TEXT NOT NULL, w INTEGER NOT NULL, n INTEGER NOT NULL, exp INTEGER NOT NULL, PRIMARY KEY (k, w))').run();
      tableReady = true;
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const who = (await sha256Hex('rl:' + ip)).slice(0, 24);
    const limit = LIMITS[scope][hasOrigin ? 'browser' : 'other'];
    const base = `${scope}:${hasOrigin ? 'b' : 'o'}:${who}`;
    const now = Date.now();
    const minute = Math.floor(now / MINUTE_MS);
    const day = Math.floor(now / DAY_MS);

    const upsert = db.prepare(`INSERT INTO rate_limits (k, w, n, exp) VALUES (?1, ?2, 1, ?3)
      ON CONFLICT (k, w) DO UPDATE SET n = n + 1 RETURNING n`);
    const [m, d] = await db.batch([
      upsert.bind(`${base}:m`, minute, (minute + 1) * MINUTE_MS + 3600000),
      upsert.bind(`${base}:d`, day, (day + 1) * DAY_MS + 3600000),
    ]);
    const perMinute = m?.results?.[0]?.n ?? 0;
    const perDay = d?.results?.[0]?.n ?? 0;

    if (Math.random() < CLEANUP_CHANCE) {
      await db.prepare('DELETE FROM rate_limits WHERE exp < ?1').bind(now).run();
    }

    if (perDay > limit.perDay) {
      return { message: '오늘 사용 한도를 넘었어요. 내일(한국 시간 오전 9시 이후) 다시 이용해 주세요.', retryAfter: Math.ceil(((day + 1) * DAY_MS - now) / 1000) };
    }
    if (perMinute > limit.perMinute) {
      return { message: '요청이 너무 많아요. 1분쯤 뒤에 다시 시도해 주세요.', retryAfter: Math.ceil(((minute + 1) * MINUTE_MS - now) / 1000) };
    }
    return null;
  } catch (e) {
    console.warn('rate limit check failed (allowing the request):', e);
    return null;
  }
}
