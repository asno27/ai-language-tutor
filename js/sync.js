// js/sync.js - 기기 간 동기화 클라이언트 (Phase 2.5)
// localStorage가 1차 저장소이고, 동기화가 켜져 있으면 바뀐 항목을 모아 Worker(/api/sync)와 주고받습니다.
// 각 데이터 종류(kind)는 registerSyncKind로 "받은 변경 적용"과 "전체 목록 수집" 방법을 등록합니다.
import { getWorkerOrigin } from './api.js';

const CODE_KEY = 'sync_code';
const SINCE_KEY = 'sync_since';
const PENDING_KEY = 'sync_pending';
const LAST_AT_KEY = 'sync_last_at';
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (헷갈리는 I, L, O, U 제외)
const CODE_LENGTH = 26;           // 130비트 — 추측 불가능
const BATCH_SIZE = 500;           // 서버 한 번 요청당 최대 변경 수
const DEBOUNCE_MS = 2000;
const FOCUS_SYNC_MIN_GAP_MS = 30000;

const kinds = {};                 // kind -> { apply(changes), collectAll() }
const listeners = new Set();
let timer = null;
let running = null;
let lastStatus = { state: 'idle' };

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function registerSyncKind(kind, handlers) {
  kinds[kind] = handlers;
}

export function onSyncStatus(fn) {
  listeners.add(fn);
  fn(lastStatus);
  return () => listeners.delete(fn);
}

function setStatus(status) {
  lastStatus = status;
  listeners.forEach(fn => fn(status));
}

export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
}

export function formatCode(code) {
  return normalizeCode(code).match(/.{1,4}/g)?.join('-') || '';
}

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map(b => CODE_ALPHABET[b & 31]).join('');
}

export function isSyncEnabled() {
  return !!localStorage.getItem(CODE_KEY);
}

export function getSyncCode() {
  return localStorage.getItem(CODE_KEY) || '';
}

export function getLastSyncAt() {
  return Number(localStorage.getItem(LAST_AT_KEY)) || 0;
}

export function isValidCode(input) {
  return normalizeCode(input).length === CODE_LENGTH;
}

/** 변경 기록. 동기화가 꺼져 있으면 아무것도 하지 않음 (켤 때 collectAll로 전체를 보냄) */
export function queueChange(kind, id, data, { deleted = false, updatedAt = Date.now() } = {}) {
  if (!isSyncEnabled()) return;
  const pending = readJson(PENDING_KEY, {});
  pending[`${kind}:${id}`] = { kind, id, data: deleted ? null : data, deleted, updatedAt };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), DEBOUNCE_MS);
}

function queueEverything() {
  const pending = readJson(PENDING_KEY, {});
  for (const [kind, handlers] of Object.entries(kinds)) {
    for (const item of handlers.collectAll()) {
      pending[`${kind}:${item.id}`] = { kind, id: item.id, data: item.data, deleted: false, updatedAt: item.updatedAt };
    }
  }
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

/** 새 코드를 만들거나(code 없음) 다른 기기의 코드로 연결. 이 기기의 데이터는 서버 데이터와 합쳐짐 */
export async function enableSync(code) {
  const finalCode = code ? normalizeCode(code) : generateCode();
  if (finalCode.length !== CODE_LENGTH) throw new Error('동기화 코드 형식이 올바르지 않아요.');
  localStorage.setItem(CODE_KEY, finalCode);
  localStorage.setItem(SINCE_KEY, '0');
  localStorage.removeItem(PENDING_KEY);
  queueEverything();
  return syncNow();
}

/** 이 기기만 동기화에서 빠짐. 이 기기의 데이터는 그대로 남음 */
export function disableSync() {
  clearTimeout(timer);
  [CODE_KEY, SINCE_KEY, PENDING_KEY, LAST_AT_KEY].forEach(k => localStorage.removeItem(k));
  setStatus({ state: 'off' });
}

async function postSync(body) {
  const response = await fetch(`${getWorkerOrigin()}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getSyncCode()}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.detail || `서버 오류: ${response.status}`);
  return result;
}

function applyIncoming(changes) {
  const byKind = {};
  for (const c of changes) (byKind[c.kind] ||= []).push(c);
  let changed = false;
  for (const [kind, list] of Object.entries(byKind)) {
    if (kinds[kind] && kinds[kind].apply(list)) changed = true;
  }
  return changed;
}

async function runSync() {
  setStatus({ state: 'syncing' });
  let changed = false;
  let since = Number(localStorage.getItem(SINCE_KEY)) || 0;
  let nextSince = since;

  // 1) 보낼 변경이 없어질 때까지 BATCH_SIZE씩 전송 (응답으로 다른 기기의 변경도 받음)
  do {
    const pending = readJson(PENDING_KEY, {});
    const batch = Object.values(pending).slice(0, BATCH_SIZE);
    const result = await postSync({ since, changes: batch });
    // 보내는 동안 다시 바뀐 항목은 남겨 두고, 보낸 그대로인 항목만 대기열에서 제거
    const latest = readJson(PENDING_KEY, {});
    for (const c of batch) {
      const key = `${c.kind}:${c.id}`;
      if (latest[key] && latest[key].updatedAt === c.updatedAt) delete latest[key];
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(latest));
    if (applyIncoming(result.changes)) changed = true;
    nextSince = result.serverTime;

    // 2) 받을 변경이 한 페이지를 넘으면 이어서 받기
    let cursor = result.cursor;
    let hasMore = result.hasMore;
    while (hasMore) {
      const page = await postSync({ since: cursor, paging: true, changes: [] });
      if (applyIncoming(page.changes)) changed = true;
      cursor = page.cursor;
      hasMore = page.hasMore;
    }
    since = nextSince;
  } while (Object.keys(readJson(PENDING_KEY, {})).length > 0);

  localStorage.setItem(SINCE_KEY, String(nextSince));
  localStorage.setItem(LAST_AT_KEY, String(Date.now()));
  setStatus({ state: 'ok', at: Date.now(), changed });
  return changed;
}

export function syncNow() {
  if (!isSyncEnabled()) return Promise.resolve(false);
  if (running) return running;
  clearTimeout(timer);
  running = runSync()
    .catch(e => {
      console.warn('Sync failed:', e);
      setStatus({ state: 'error', message: e.message });
      return false;
    })
    .finally(() => { running = null; });
  return running;
}

// 앱으로 돌아오거나 인터넷이 다시 연결되면 자동 동기화
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isSyncEnabled() && Date.now() - getLastSyncAt() > FOCUS_SYNC_MIN_GAP_MS) syncNow();
});
window.addEventListener('online', () => { if (isSyncEnabled()) syncNow(); });
