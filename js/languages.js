// js/languages.js - 학습 언어 설정 (Phase 4 다국어 기반 구조)
// 언어별로 달라지는 값은 모두 이곳에 모읍니다. 새 언어를 켤 때는 enabled만 true로 바꾸고,
// Phase 4 기획서(4.5~4.8)의 언어별 처리를 추가하면 됩니다.

export const LANGS = {
  en: {
    code: 'en',
    name: 'English',        // 프롬프트에 들어가는 언어 이름
    nameKo: '영어',          // 화면 표시용
    abbrKo: '영',            // "한→영" 같은 방향 표시용
    speechCode: 'en-US',    // TTS / STT 언어 코드
    levelSystem: 'CEFR',
    wordPattern: /[a-zA-Z']+/g, // 미니 사전에서 클릭 가능한 단어로 인식할 패턴
    enabled: true,
  },
  ja: {
    code: 'ja',
    name: 'Japanese',
    nameKo: '일본어',
    abbrKo: '일',
    speechCode: 'ja-JP',
    levelSystem: 'JLPT',
    wordPattern: null,      // 띄어쓰기가 없어 정규식 불가 → Phase 4.6에서 Intl.Segmenter로 처리
    enabled: false,
  },
  es: {
    code: 'es',
    name: 'Spanish',
    nameKo: '스페인어',
    abbrKo: '서',
    speechCode: 'es-ES',
    levelSystem: 'DELE',
    wordPattern: /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ']+/g,
    enabled: false,
  },
};

export const DEFAULT_LANG = 'en';
const LANG_STORAGE_KEY = 'target_lang';

/** 현재 학습 언어 코드. 저장된 값이 없거나 아직 켜지지 않은 언어면 기본값(영어) */
export function getTargetLang() {
  let stored = null;
  try { stored = localStorage.getItem(LANG_STORAGE_KEY); } catch {}
  return LANGS[stored]?.enabled ? stored : DEFAULT_LANG;
}

export function setTargetLang(lang) {
  if (!LANGS[lang]?.enabled) return false;
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  return true;
}

export function getLangConfig(lang = getTargetLang()) {
  return LANGS[lang] || LANGS[DEFAULT_LANG];
}

/** 언어별 캐시 키. 예: langKey('daily_sentence') → 'daily_sentence_en' */
export function langKey(base, lang = getTargetLang()) {
  return `${base}_${lang}`;
}

/**
 * 다국어 구조 도입 전 데이터를 새 구조로 옮깁니다. (앱 시작 시 1회)
 * - daily_sentence → daily_sentence_en
 * - 단어장: word가 비어 있는 깨진 항목 제거, lang 필드 없는 항목은 'en'으로 지정
 */
const STORAGE_VERSION_KEY = 'storage_version';
const STORAGE_VERSION = 2;

export function migrateLegacyStorage() {
  try {
    if (Number(localStorage.getItem(STORAGE_VERSION_KEY)) >= STORAGE_VERSION) return;

    const legacyDaily = localStorage.getItem('daily_sentence');
    if (legacyDaily !== null) {
      if (localStorage.getItem('daily_sentence_en') === null) {
        localStorage.setItem('daily_sentence_en', legacyDaily);
      }
      localStorage.removeItem('daily_sentence');
    }

    const vocabRaw = localStorage.getItem('ai_tutor_vocabulary');
    if (vocabRaw) {
      const words = JSON.parse(vocabRaw);
      if (Array.isArray(words)) {
        const fixed = words
          .filter(w => w && typeof w.word === 'string' && w.word.trim())
          .map(w => ({ ...w, lang: w.lang || 'en' }));
        localStorage.setItem('ai_tutor_vocabulary', JSON.stringify(fixed));
      }
    }

    localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION));
  } catch (e) {
    console.warn('Storage migration failed:', e);
  }
}
