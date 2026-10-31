// js/cefr.js - 영어 단어의 CEFR 레벨(A1~C2) 표시 (C-10)
// 데이터: data/cefr.json (CEFR-J Wordlist v1.5 + Octanove C1/C2). 출처는 파일 안 _source와 자료실 하단에 표기.

const LABELS = { A1: '입문', A2: '초급', B1: '중급', B2: '중상급', C1: '고급', C2: '최고급' };
let levels = null;
let loading = null;

/** 데이터를 한 번만 불러옴. 실패해도 앱은 레벨 표시만 없이 정상 동작 */
export function loadCefr() {
  if (!loading) {
    loading = fetch('data/cefr.json')
      .then(res => res.json())
      .then(data => { levels = data.levels || {}; window.dispatchEvent(new CustomEvent('cefr-loaded')); })
      .catch(err => { console.warn('CEFR 데이터를 불러오지 못했어요', err); levels = {}; });
  }
  return loading;
}

// 규칙 변화형을 원형으로 되돌린 후보 (예: goes→go, studies→study, stopped→stop, making→make)
function baseForms(w) {
  const out = [];
  if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) out.push(w.slice(0, -2));
  if (w.endsWith('s')) out.push(w.slice(0, -1));
  if (w.endsWith('ied')) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')) { out.push(w.slice(0, -2), w.slice(0, -1)); if (/(.)\1ed$/.test(w)) out.push(w.slice(0, -3)); }
  if (w.endsWith('ing')) { out.push(w.slice(0, -3), w.slice(0, -3) + 'e'); if (/(.)\1ing$/.test(w)) out.push(w.slice(0, -4)); }
  if (w.endsWith('er') || w.endsWith('est')) out.push(w.replace(/(er|est)$/, ''), w.replace(/(er|est)$/, 'e'));
  if (w.endsWith('ly')) out.push(w.slice(0, -2));
  return out;
}

/** @returns {{ level: string, label: string, exact: boolean } | null} 데이터가 없거나 목록에 없는 단어는 null */
export function cefrLevel(word) {
  if (!levels) return null;
  const w = String(word || '').trim().toLowerCase().replace(/’/g, "'");
  if (!w) return null;
  if (levels[w]) return { level: levels[w], label: LABELS[levels[w]], exact: true };
  if (!/^[a-z]+$/.test(w)) return null;
  for (const base of baseForms(w)) {
    if (base.length >= 2 && levels[base]) return { level: levels[base], label: LABELS[levels[base]], exact: false };
  }
  return null;
}

/** 단어 옆에 붙일 작은 레벨 표시 HTML (없으면 빈 문자열). level은 A1~C2 고정값이라 그대로 넣어도 안전 */
export function cefrBadgeHtml(word) {
  const info = cefrLevel(word);
  if (!info) return '';
  const tip = `CEFR-J 기준 ${info.level} (${info.label}) 단어${info.exact ? '' : ' · 변화형이라 원형 기준'}`;
  return `<span class="cefr-badge cefr-${info.level.toLowerCase()}" title="${tip}">${info.level}</span>`;
}
