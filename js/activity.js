// js/activity.js - 학습 활동·실수 기록, 연속 학습일(스트릭), 하루 목표 (Phase 5.1 수집 + 5.2)
//
// - study_days : { "2026-10-31": { t: { writing: 2, roleplay: 3 }, u: 수정시각 } }  날짜별·종류별 활동 횟수
// - mistake_log: [ { id, at, source, original, corrected, comment } ]  교정에서 나온 틀린 표현 (최근 200개)
// - daily_goal : 하루 목표 활동 수 (기본 5)
// 모두 이 기기의 localStorage에 저장하고, 동기화가 켜져 있으면 기기 간에 합쳐짐.
import { queueChange } from './sync.js';

const DAYS_KEY = 'study_days';
const MISTAKES_KEY = 'mistake_log';
export const GOAL_KEY = 'daily_goal';
export const DEFAULT_GOAL = 5;
export const GOAL_CHOICES = [3, 5, 10, 15];
export const MISTAKE_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

/** 이 기기 기준 날짜 문자열 'YYYY-MM-DD' */
export function dateKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' → 날짜 번호(하루 단위). 서머타임 영향을 피하려고 UTC로 계산
function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function loadStudyDays() {
  const days = readJson(DAYS_KEY, {});
  return days && typeof days === 'object' && !Array.isArray(days) ? days : {};
}

export function dayCount(entry) {
  return Object.values(entry?.t || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

function notify() {
  window.dispatchEvent(new CustomEvent('activity-changed'));
}

/** 학습 활동 1회 기록 (type: writing, translation, dictionary, review, daily, examples, roleplay, shadowing, worksheet ...) */
export function logActivity(type) {
  const days = loadStudyDays();
  const key = dateKey();
  const entry = days[key] || { t: {} };
  entry.t[type] = (entry.t[type] || 0) + 1;
  entry.u = Date.now();
  days[key] = entry;
  localStorage.setItem(DAYS_KEY, JSON.stringify(days));
  queueChange('study_day', key, { t: entry.t }, { updatedAt: entry.u });
  notify();
}

export function getGoal() {
  const n = Number(localStorage.getItem(GOAL_KEY));
  return GOAL_CHOICES.includes(n) ? n : DEFAULT_GOAL;
}

export function setGoal(n) {
  if (!GOAL_CHOICES.includes(n)) return false;
  const at = Date.now();
  localStorage.setItem(GOAL_KEY, String(n));
  localStorage.setItem(`${GOAL_KEY}_at`, String(at));
  queueChange('setting', GOAL_KEY, { value: String(n) }, { updatedAt: at });
  notify();
  return true;
}

/** 연속 학습일·오늘 활동 수·최근 7일 */
export function getStats(today = new Date()) {
  const days = loadStudyDays();
  const count = (key) => dayCount(days[key]);
  const todayKey = dateKey(today);
  const todayCount = count(todayKey);

  // 현재 연속일: 오늘 아직 안 했으면 어제부터 거꾸로 센다 (하루 놓쳤다고 바로 0이 되지 않게)
  let streak = 0;
  const cursor = new Date(today);
  if (!todayCount) cursor.setDate(cursor.getDate() - 1);
  while (count(dateKey(cursor)) > 0) { streak++; cursor.setDate(cursor.getDate() - 1); }

  // 최장 연속일
  const studied = Object.keys(days).filter(k => count(k) > 0).map(dayNumber).sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const n of studied) { run = prev !== null && n === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = n; }

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    last7.push({ key: dateKey(d), label: ['일', '월', '화', '수', '목', '금', '토'][d.getDay()], count: count(dateKey(d)), isToday: i === 0 });
  }
  const goal = getGoal();
  return { streak, best: Math.max(best, streak), todayCount, goal, goalReached: todayCount >= goal, studiedToday: todayCount > 0, last7 };
}

// === 실수 기록 ===
export function loadMistakes() {
  const list = readJson(MISTAKES_KEY, []);
  return Array.isArray(list) ? list : [];
}

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 교정 결과 중 "틀렸거나 어색했던 표현"을 기록 */
export function logMistake({ source, original, corrected, comment = '' }) {
  const o = String(original || '').trim();
  const c = String(corrected || '').trim();
  if (!o || !c || o === c) return false;
  const at = new Date().toISOString();
  const item = { id: `${at}|${hashText(o)}`, at, source, original: o.slice(0, 500), corrected: c.slice(0, 500), comment: String(comment || '').slice(0, 400) };
  const list = loadMistakes();
  list.push(item);
  localStorage.setItem(MISTAKES_KEY, JSON.stringify(list.slice(-MISTAKE_MAX)));
  queueChange('mistake', item.id, item, { updatedAt: Date.parse(at) });
  return true;
}

// === 동기화 (Phase 2.5 구조에 연결) ===
/** 다른 기기의 날짜별 활동을 합침: 종류별로 큰 값을 채택 */
export function applyRemoteStudyDays(changes) {
  const days = loadStudyDays();
  let changed = false;
  for (const c of changes) {
    if (c.deleted || !c.data?.t || !/^\d{4}-\d{2}-\d{2}$/.test(c.id)) continue;
    const entry = days[c.id] || { t: {} };
    for (const [type, n] of Object.entries(c.data.t)) {
      const v = Number(n) || 0;
      if (v > (entry.t[type] || 0)) { entry.t[type] = v; changed = true; }
    }
    entry.u = Math.max(entry.u || 0, c.updatedAt || 0);
    days[c.id] = entry;
  }
  if (changed) localStorage.setItem(DAYS_KEY, JSON.stringify(days));
  if (changed) notify();
  return changed;
}

export function collectAllStudyDays() {
  return Object.entries(loadStudyDays()).map(([key, e]) => ({ id: key, data: { t: e.t }, updatedAt: e.u || 1 }));
}

export function applyRemoteMistakes(changes) {
  const list = loadMistakes();
  const ids = new Set(list.map(m => m.id));
  let changed = false;
  for (const c of changes) {
    if (c.deleted || !c.data?.original || ids.has(c.id)) continue;
    list.push({ ...c.data, id: c.id });
    ids.add(c.id);
    changed = true;
  }
  if (changed) {
    list.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    localStorage.setItem(MISTAKES_KEY, JSON.stringify(list.slice(-MISTAKE_MAX)));
  }
  return changed;
}

export function collectAllMistakes() {
  return loadMistakes().map(m => ({ id: m.id, data: m, updatedAt: Date.parse(m.at) || 1 }));
}
