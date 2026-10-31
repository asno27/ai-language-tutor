// js/course.js - 단계별 학습 코스의 진행 상황 (Phase 5.4)
//
// - course_progress: { "b2-g": { d: 1, u: 수정시각 } }  단계별 완료 여부 (d=0은 완료 취소). 이 기기의 localStorage에 저장
// - course_active  : { id, type, need, base }  "시작"을 누른 단계. 연결된 활동을 need번 하면 자동 완료
// 동기화가 켜져 있으면 단계별로 더 최근에 바꾼 쪽이 이김.
import { queueChange } from './sync.js';
import { loadStudyDays } from './activity.js';

const PROGRESS_KEY = 'course_progress';
const ACTIVE_KEY = 'course_active';

// 코스 단계 종류 → logActivity 종류
export const STEP_ACTIVITY = {
  grammar: 'grammar',
  roleplay: 'roleplay',
  examples: 'examples',
  daily: 'daily',
  review: 'review',
  worksheet: 'worksheet',
  writing: 'writing',
  mistakes: 'mistake_report',
};

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function notify() {
  window.dispatchEvent(new CustomEvent('course-changed'));
}

export function loadProgress() {
  const p = readJson(PROGRESS_KEY, {});
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

export function isStepDone(id) {
  return loadProgress()[id]?.d === 1;
}

export function setStepDone(id, done) {
  const progress = loadProgress();
  if ((progress[id]?.d === 1) === done) return false;
  const u = Date.now();
  progress[id] = { d: done ? 1 : 0, u };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  queueChange('course_step', id, done ? { done: true } : null, { deleted: !done, updatedAt: u });
  notify();
  return true;
}

/** 단위 안의 완료 단계 수 */
export function unitProgress(unit) {
  const progress = loadProgress();
  const done = unit.steps.filter(s => progress[s.id]?.d === 1).length;
  return { done, total: unit.steps.length };
}

// === 활동 자동 감지 ===
function totalActivity(type) {
  return Object.values(loadStudyDays()).reduce((sum, e) => sum + (Number(e?.t?.[type]) || 0), 0);
}

export function getActiveStep() {
  const a = readJson(ACTIVE_KEY, null);
  return a && a.id && a.type ? a : null;
}

/** "시작"을 누른 단계를 기억: 이 시점 이후의 활동만 센다 */
export function startStep(step) {
  const type = STEP_ACTIVITY[step.type];
  if (!type || isStepDone(step.id)) { localStorage.removeItem(ACTIVE_KEY); return; }
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: step.id, type, need: step.need || 1, base: totalActivity(type) }));
}

/** 활동이 기록될 때 불러서, 시작한 단계의 완료 조건을 채웠으면 완료 처리. 완료한 단계 id를 돌려줌 */
export function checkActiveStep() {
  const a = getActiveStep();
  if (!a) return null;
  if (totalActivity(a.type) - a.base < a.need) return null;
  localStorage.removeItem(ACTIVE_KEY);
  setStepDone(a.id, true);
  return a.id;
}

// === 동기화 ===
export function applyRemoteCourse(changes) {
  const progress = loadProgress();
  let changed = false;
  for (const c of changes) {
    if (typeof c.id !== 'string' || !c.id) continue;
    const local = progress[c.id];
    if (local && local.u >= c.updatedAt) continue;
    progress[c.id] = { d: c.deleted ? 0 : 1, u: c.updatedAt };
    changed = true;
  }
  if (changed) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    notify();
  }
  return changed;
}

export function collectAllCourse() {
  return Object.entries(loadProgress()).map(([id, e]) =>
    e.d === 1 ? { id, data: { done: true }, updatedAt: e.u || 1 } : { id, data: null, deleted: true, updatedAt: e.u || 1 });
}
