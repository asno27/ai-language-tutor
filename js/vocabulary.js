// js/vocabulary.js - 단어장 관리 + SM-2 간격 반복 알고리즘
import { queueChange } from './sync.js';

const STORAGE_KEY = 'ai_tutor_vocabulary';

// 동기화에서 단어를 구분하는 키. 기기마다 id가 달라도 같은 단어는 하나로 합쳐짐
const vocabKey = (word) => word.trim().toLowerCase();

function loadVocabulary() {
  try {
    const words = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    // 예전 버그로 word가 비어 저장된 항목은 제외 (미니 사전 저장 버그)
    return Array.isArray(words) ? words.filter(w => w && typeof w.word === 'string' && w.word.trim()) : [];
  } catch { return []; }
}

function touch(item) {
  item.updatedAt = Date.now();
  queueChange('vocab', vocabKey(item.word), item, { updatedAt: item.updatedAt });
}

function saveVocabulary(words) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

/**
 * SM-2 알고리즘으로 다음 복습 시점 계산
 * @param {number} quality - 0~5 (0=완전 모름, 5=완벽)
 * @param {number} repetitions - 연속 정답 횟수
 * @param {number} easeFactor - 난이도 계수 (기본 2.5)
 * @param {number} interval - 현재 간격 (일)
 */
function sm2(quality, repetitions, easeFactor, interval) {
  let newEF = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  let newInterval, newReps;

  if (quality >= 3) { // 정답
    if (repetitions === 0) newInterval = 1;
    else if (repetitions === 1) newInterval = 3;
    else newInterval = Math.round(interval * easeFactor);
    newReps = repetitions + 1;
  } else { // 오답
    newInterval = 1;
    newReps = 0;
  }

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + newInterval);

  return {
    repetitions: newReps,
    easeFactor: newEF,
    interval: newInterval,
    nextReview: nextReview.toISOString()
  };
}

export function saveWord(wordData) {
  const words = loadVocabulary();
  if (words.some(w => w.word.toLowerCase() === wordData.word.toLowerCase())) return false; // already exists

  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    word: wordData.word,
    phonetic: wordData.phonetic || '',
    meanings: wordData.meanings || [],
    audioUrl: wordData.audioUrl || '',
    customExamples: wordData.customExamples || [],
    savedAt: new Date().toISOString(),
    repetitions: 0,
    easeFactor: 2.5,
    interval: 0,
    nextReview: new Date().toISOString()
  };
  touch(item);
  words.push(item);

  saveVocabulary(words);
  return true;
}

export function deleteWord(id) {
  const all = loadVocabulary();
  const target = all.find(w => w.id === id);
  saveVocabulary(all.filter(w => w.id !== id));
  if (target) queueChange('vocab', vocabKey(target.word), null, { deleted: true });
}

export function getAllWords() {
  return loadVocabulary().sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

export function getWordsForReview() {
  const now = new Date();
  return loadVocabulary().filter(w => new Date(w.nextReview) <= now);
}

export function getMasteredCount() {
  return loadVocabulary().filter(w => w.interval >= 21).length;
}

export function updateReview(id, quality) {
  const words = loadVocabulary();
  const idx = words.findIndex(w => w.id === id);
  if (idx === -1) return null;

  const w = words[idx];
  const result = sm2(quality, w.repetitions, w.easeFactor, w.interval);
  Object.assign(words[idx], result);
  touch(words[idx]);
  saveVocabulary(words);
  return words[idx];
}

export function isWordSaved(word) {
  return loadVocabulary().some(w => w.word.toLowerCase() === word.toLowerCase());
}

export function getTotalCount() {
  return loadVocabulary().length;
}

// === 동기화 (Phase 2.5) ===
function localUpdatedAt(w) {
  return w.updatedAt || Date.parse(w.savedAt) || 1;
}

/** 다른 기기에서 받은 변경을 합침. 같은 단어는 updatedAt이 더 최근인 쪽이 이김 */
export function applyRemoteVocab(changes) {
  const words = loadVocabulary();
  let changed = false;
  for (const c of changes) {
    const idx = words.findIndex(w => vocabKey(w.word) === c.id);
    const local = idx >= 0 ? words[idx] : null;
    if (local && localUpdatedAt(local) >= c.updatedAt) continue;
    if (c.deleted) {
      if (idx >= 0) { words.splice(idx, 1); changed = true; }
    } else if (c.data && typeof c.data.word === 'string') {
      const item = { ...c.data, id: local?.id || c.data.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), updatedAt: c.updatedAt };
      if (idx >= 0) words[idx] = item; else words.push(item);
      changed = true;
    }
  }
  if (changed) saveVocabulary(words);
  return changed;
}

export function collectAllVocab() {
  return loadVocabulary().map(w => ({ id: vocabKey(w.word), data: w, updatedAt: localUpdatedAt(w) }));
}
