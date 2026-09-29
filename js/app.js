import { callGemini, lookupDictionary, fetchYoutubeTranscript, getGeminiApiKey } from './api.js';
import { SpeechManager, speak } from './speech.js';
import { pickDailyScenes, ROLEPLAY_SCENARIOS, LEVELS, DEFAULT_LEVEL, EXAMPLE_TOPICS } from './prompts.js';
import { compareWords } from './shadowing.js';
import { saveWord, deleteWord, getAllWords, getWordsForReview, getMasteredCount, updateReview, isWordSaved, getTotalCount, applyRemoteVocab, collectAllVocab } from './vocabulary.js';
import { registerSyncKind, queueChange, onSyncStatus, enableSync, disableSync, syncNow, isSyncEnabled, getSyncCode, formatCode, isValidCode, getLastSyncAt } from './sync.js';

// TTS 함수를 전역으로 노출 (innerHTML onclick에서 사용)
window.speakText = speak;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// === MINI DICTIONARY ===
function makeTextClickable(container) {
  if (!container) return;
  function walk(node) {
    if (node.nodeType === 3) {
      const text = node.nodeValue;
      if (!text.trim()) return;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      const regex = /[a-zA-Z']+/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const span = document.createElement('span');
        span.className = 'clickable-word';
        span.textContent = match[0];
        fragment.appendChild(span);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      if (fragment.childNodes.length > 0) {
        node.parentNode.replaceChild(fragment, node);
      }
    } else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (['input', 'button', 'textarea', 'a', 'script', 'style'].includes(tag)) return;
      if (node.classList.contains('clickable-word')) return;
      Array.from(node.childNodes).forEach(walk);
    }
  }
  Array.from(container.childNodes).forEach(walk);
}

document.addEventListener('DOMContentLoaded', () => {
  const popup = document.getElementById('mini-dict-popup');
  const wordEl = document.getElementById('mini-dict-word');
  const phoneticEl = document.getElementById('mini-dict-phonetic');
  const meaningsEl = document.getElementById('mini-dict-meanings');
  const addBtn = document.getElementById('mini-dict-add-btn');
  let currentWord = '';
  let currentDictData = null;

  document.body.addEventListener('click', async (e) => {
    if (e.target.classList.contains('clickable-word')) {
      const word = e.target.textContent.replace(/[^a-zA-Z']/g, '');
      if (!word) return;

      currentWord = word.toLowerCase();
      const rect = e.target.getBoundingClientRect();

      popup.style.display = 'block';
      popup.style.left = (rect.left + rect.width / 2) + window.scrollX + 'px';
      popup.style.top = (rect.top + window.scrollY) + 'px';

      wordEl.textContent = word;
      phoneticEl.textContent = '';
      meaningsEl.innerHTML = '<div class="placeholder-message" style="margin:0; padding:10px 0;"><span class="placeholder-icon" style="font-size:1.2rem;">⏳</span><p style="font-size:0.8rem; margin:0;">검색 중...</p></div>';

      if (isWordSaved(currentWord)) {
        addBtn.textContent = '단어장에 있음';
        addBtn.style.background = 'var(--success)';
        addBtn.disabled = true;
      } else {
        addBtn.textContent = '+ 단어장에 추가';
        addBtn.style.background = 'var(--accent-2)';
        addBtn.disabled = false;
      }

      let dictData = null;
      currentDictData = null;
      const lookedUp = currentWord;
      try {
        dictData = await callGemini('dictionary', { word: currentWord });
      } catch (e) {
        console.error(e);
      }
      if (lookedUp === currentWord) currentDictData = dictData;

      if (!dictData) {
        meaningsEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;">결과를 찾을 수 없습니다.</div>';
        return;
      }

      phoneticEl.textContent = dictData.phonetic || '';
      if (dictData.meanings && dictData.meanings.length > 0) {
        let html = '';
        dictData.meanings.slice(0, 2).forEach(m => {
           html += `<div style="margin-bottom:6px;"><span style="color:var(--accent-2); font-size:0.8rem; font-weight:bold;">[${escapeHtml(m.partOfSpeech)}]</span><ul style="margin:3px 0; padding-left:15px; font-size:0.85rem; color:rgba(255,255,255,0.9);">`;
           m.definitions.slice(0, 2).forEach(d => {
             html += `<li>${escapeHtml(d)}</li>`;
           });
           html += `</ul></div>`;
        });
        meaningsEl.innerHTML = html;
      }

    } else if (popup && !popup.contains(e.target)) {
      popup.style.display = 'none';
    }
  });

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (currentWord && !isWordSaved(currentWord)) {
        // 예전에는 saveWord(문자열)로 호출해 단어가 빈 값으로 저장되던 버그가 있었음
        saveWord({
          word: currentWord,
          phonetic: currentDictData?.phonetic || '',
          meanings: currentDictData?.meanings || [],
        });
        updateVocabStats();
        addBtn.textContent = '저장됨 ✓';
        addBtn.style.background = 'var(--success)';
        addBtn.disabled = true;
      }
    });
  }
});

// DOM elements
window.handleNuanceSubmit = async function() {
  const nuanceInput = document.getElementById('nuance-input');
  const nuanceSubmit = document.getElementById('nuance-submit');
  const nuanceOutput = document.getElementById('nuance-output');

  if (!nuanceInput || !nuanceSubmit || !nuanceOutput) {
    console.error('Nuance DOM elements missing!');
    return;
  }

  const query = nuanceInput.value.trim();
  if (!query) return;

  nuanceSubmit.disabled = true;
  const originalBtnText = nuanceSubmit.innerHTML;
  nuanceSubmit.innerHTML = `<span class="btn-text">분석 중...</span>`;
  nuanceOutput.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">⏳</span><p>AI가 뉘앙스를 분석하고 있습니다...</p></div>`;

  try {
    // Dynamic import to avoid module issues just in case
    const { callGemini } = await import('./api.js');
    const result = await callGemini('nuance', { query });

    // Helper function for HTML escaping inside this scope
    const esc = (str) => {
      if (!str) return '';
      return String(str).replace(/[&<>'"]/g, 
        tag => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[tag] || tag)
      );
    };

    let html = `
      <div style="margin-bottom: 1rem; padding: 1rem; background: rgba(var(--accent-1-rgb), 0.1); border-radius: 10px; border-left: 4px solid var(--accent-1);">
        <strong style="color: var(--accent-1);">💡 핵심 차이:</strong><br>
        <span style="color: var(--text-primary); line-height: 1.5;">${esc(result.explanation)}</span>
      </div>
    `;

    if (result.words && Array.isArray(result.words)) {
      result.words.forEach(w => {
        html += `
          <div class="nuance-item">
            <h3 style="color: var(--accent-2); margin-bottom: 0.5rem; font-size: 1.1rem;">${esc(w.word)}</h3>
            <p style="color: var(--text-secondary); margin-bottom: 0.8rem;">${esc(w.nuance)}</p>
            <div style="background: rgba(0,0,0,0.2); padding: 0.8rem; border-radius: 8px;">
        `;
        if (w.examples && Array.isArray(w.examples)) {
          w.examples.forEach(ex => {
            html += `
              <div style="margin-bottom: 0.5rem; font-size: 0.9rem;">
                <div style="color: #fff;">• ${esc(ex.en)} <button class="audio-btn" style="padding:2px 6px;font-size:0.7rem;background:transparent;" onclick="speakText('${esc(ex.en).replace(/'/g, "\\'")}')">🔊</button></div>
                <div style="color: var(--text-muted); margin-left: 10px;">→ ${esc(ex.ko)}</div>
              </div>
            `;
          });
        }
        html += `</div></div>`;
      });
    }
    nuanceOutput.innerHTML = html;
    makeTextClickable(nuanceOutput);
  } catch (error) {
    console.error(error);
    const esc = (str) => String(str).replace(/[&<>'"]/g, tag => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[tag] || tag));
    nuanceOutput.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">⚠️</span><p>오류가 발생했습니다: ${esc(error.message)}</p></div>`;
  } finally {
    nuanceSubmit.disabled = false;
    nuanceSubmit.innerHTML = originalBtnText;
  }
};

const tabBtns = $$('.tab-btn');
const tabPanes = $$('.tab-pane');
const writingInput = $('#writing-input');
const writingSubmit = $('#writing-submit');
const writingOutput = $('#writing-output');
const writingCharCount = $('#writing-char-count');
const translationInput = $('#translation-input');
const translationSubmit = $('#translation-submit');
const translationOutput = $('#translation-output');
const translationCharCount = $('#translation-char-count');
const dictionaryInput = $('#dictionary-input');
const dictionarySubmit = $('#dictionary-submit');
const dictionaryOutput = $('#dictionary-output');
const pronunciationTarget = $('#pronunciation-target');
const micBtn = $('#mic-btn');
const micStatus = $('#mic-status');
const sttResult = $('#stt-result');
const sttText = $('#stt-text');
const pronunciationOutput = $('#pronunciation-output');
const loading = $('#loading');
const speech = new SpeechManager();

// Vocabulary DOM
const vocabTotal = $('#vocab-total');
const vocabReviewCount = $('#vocab-review-count');
const vocabMastered = $('#vocab-mastered');
const startReviewBtn = $('#start-review');
const vocabList = $('#vocab-list');
const flashcardOverlay = $('#flashcard-overlay');
const flashcard = $('#flashcard');
const flashcardWord = $('#flashcard-word');
const flashcardPhonetic = $('#flashcard-phonetic');
const flashcardMeaning = $('#flashcard-meaning');
const flashcardAudio = $('#flashcard-audio');
const flashcardCurrent = $('#flashcard-current');
const flashcardTotal = $('#flashcard-total');
const flashcardClose = $('#flashcard-close');

// Daily DOM
const dailySentence = $('#daily-sentence');
const dailyPractice = $('#daily-practice');
const dailyListenSlow = $('#daily-listen-slow');
const dailyListenNormal = $('#daily-listen-normal');
const dailyListenFast = $('#daily-listen-fast');
const dailyMicBtn = $('#daily-mic-btn');
const dailyMicStatus = $('#daily-mic-status');
const dailySttResult = $('#daily-stt-result');
const dailySttText = $('#daily-stt-text');
const dailyOutput = $('#daily-output');
const dailyNewBtn = $('#daily-new-btn');
const dailySpeech = new SpeechManager();

// Youtube DOM
const youtubeInput = $('#youtube-input');
const youtubeSubmit = $('#youtube-submit');
const youtubeOutput = $('#youtube-output');

// Tab Navigation
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tabPanes.forEach(p => p.classList.remove('active'));
    $(`#pane-${btn.dataset.tab}`).classList.add('active');
  });
});

// Character counters
writingInput.addEventListener('input', () => writingCharCount.textContent = `${writingInput.value.length}자`);
translationInput.addEventListener('input', () => translationCharCount.textContent = `${translationInput.value.length}자`);

// Helpers
function showLoading() { loading.style.display = 'flex'; }
function hideLoading() { loading.style.display = 'none'; }
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function showError(el, msg) {
  el.innerHTML = `<div class="result-section fade-in"><div class="result-label warning">⚠️ 오류</div><div class="result-text">${escapeHtml(msg)}</div></div>`;
}

// === 레벨 시스템 (Phase 3.2) ===
// user_level: 'basic' | 'intermediate' | 'advanced'. 오늘의 영어·맞춤 예문·주제별 예문·역할극 기본 난이도에 적용
const USER_LEVEL_KEY = 'user_level';
const userLevelSelect = $('#user-level');
const levelListeners = [];

function getUserLevel() {
  const v = localStorage.getItem(USER_LEVEL_KEY);
  return LEVELS[v] ? v : DEFAULT_LEVEL;
}

function onLevelChange(fn) { levelListeners.push(fn); }

function applyUserLevelUi() {
  userLevelSelect.value = getUserLevel();
  levelListeners.forEach(fn => fn(getUserLevel()));
}

userLevelSelect.addEventListener('change', () => {
  const value = userLevelSelect.value;
  const at = Date.now();
  localStorage.setItem(USER_LEVEL_KEY, value);
  localStorage.setItem(`${USER_LEVEL_KEY}_at`, String(at));
  queueChange('setting', USER_LEVEL_KEY, { value }, { updatedAt: at });
  applyUserLevelUi();
});

// === WRITING ===
function renderWritingResult(data) {
  let html = '';
  if (data.isCorrect) {
    html = `<div class="result-section fade-in"><div class="result-label correction">✨ 완벽한 문장!</div><div class="result-text highlight">${escapeHtml(data.corrected)}</div>
    <button class="audio-btn" onclick="speakText('${escapeHtml(data.corrected).replace(/'/g, "\\'")}')">🔊 들어보기</button></div>
    <div class="result-section fade-in"><div class="result-label feedback">💡 피드백</div><div class="result-text">${escapeHtml(data.feedback)}</div></div>`;
  } else {
    html = `<div class="result-section fade-in"><div class="result-label correction">🔄 교정된 문장</div><div class="result-text highlight">${escapeHtml(data.corrected)}</div>
    <button class="audio-btn" onclick="speakText('${escapeHtml(data.corrected).replace(/'/g, "\\'")}')">🔊 들어보기</button></div>
    <div class="result-section fade-in"><div class="result-label feedback">💡 피드백</div><div class="result-text">${escapeHtml(data.feedback)}</div></div>`;
    if (data.suggestion) {
      html += `<div class="result-section fade-in"><div class="result-label suggestion">🌟 더 자연스러운 표현</div><div class="result-text">${escapeHtml(data.suggestion)}</div></div>`;
    }
  }
  writingOutput.innerHTML = html;
  makeTextClickable(writingOutput);
}

async function handleWritingSubmit() {
  const text = writingInput.value.trim();
  if (!text) return;
  showLoading(); writingSubmit.disabled = true;
  try { renderWritingResult(await callGemini('writing', { text })); }
  catch (e) { showError(writingOutput, e.message); }
  finally { hideLoading(); writingSubmit.disabled = false; }
}
writingSubmit.addEventListener('click', handleWritingSubmit);
writingInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleWritingSubmit(); });

// === TRANSLATION ===
function renderTranslationResult(data) {
  const isEnglishResult = data.sourceLanguage === 'ko';
  let html = `<div class="result-section fade-in"><div class="result-label translation">🌐 번역 결과 (${data.sourceLanguage === 'ko' ? '한→영' : '영→한'})</div><div class="result-text highlight">${escapeHtml(data.translated)}</div>
  ${isEnglishResult ? `<button class="audio-btn" onclick="speakText('${escapeHtml(data.translated).replace(/'/g, "\\'")}')">🔊 영어 발음 듣기</button>` : ''}</div>`;
  if (data.note) html += `<div class="result-section fade-in"><div class="result-label note">📝 참고 사항</div><div class="result-text">${escapeHtml(data.note)}</div></div>`;
  translationOutput.innerHTML = html;
  makeTextClickable(translationOutput);
}

async function handleTranslationSubmit() {
  const text = translationInput.value.trim();
  if (!text) return;
  showLoading(); translationSubmit.disabled = true;
  try { renderTranslationResult(await callGemini('translation', { text })); }
  catch (e) { showError(translationOutput, e.message); }
  finally { hideLoading(); translationSubmit.disabled = false; }
}
translationSubmit.addEventListener('click', handleTranslationSubmit);
translationInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleTranslationSubmit(); });

// === DICTIONARY ===
function renderDictionaryResult(dictData, llmData) {
  const word = llmData?.word || dictData?.word || '';
  const phonetic = dictData?.phonetic || llmData?.phonetic || '';
  let html = `<div class="result-section fade-in"><div class="result-label word-title">📖 ${escapeHtml(word)} ${phonetic ? `<span style="font-weight:400;color:var(--text-muted);font-size:0.9rem">${escapeHtml(phonetic)}</span>` : ''}</div>`;
  // 발음 듣기: Free Dictionary API 음성 있으면 사용, 없으면 TTS
  if (dictData?.audioUrl) {
    html += `<button class="audio-btn" onclick="new Audio('${dictData.audioUrl}').play()">🔊 원어민 발음</button> `;
  }
  html += `<button class="audio-btn" onclick="speakText('${escapeHtml(word).replace(/'/g, "\\'")}')">${dictData?.audioUrl ? '🗣️ TTS 발음' : '🔊 발음 듣기'}</button>`;

  // Add save-to-vocabulary button
  const saved = isWordSaved(word);
  html += ` <button class="vocab-save-btn ${saved ? 'saved' : ''}" id="dict-save-btn" ${saved ? 'disabled' : ''} data-word="${escapeHtml(word)}" data-phonetic="${escapeHtml(phonetic)}">${saved ? '✅ 저장됨' : '⭐ 단어장에 저장'}</button>`;
  html += `</div>`;
  if (llmData?.meanings?.length) {
    html += `<div class="result-section fade-in"><div class="result-label pos">🏷️ 품사 및 뜻</div>`;
    llmData.meanings.forEach(m => { html += `<div class="result-text"><strong>${escapeHtml(m.partOfSpeech)}</strong>: ${m.definitions.map(d => escapeHtml(d)).join(', ')}</div>`; });
    html += `</div>`;
  }
  if (llmData?.examples?.length) {
    html += `<div class="result-section fade-in"><div class="result-label example">💬 예문</div>`;
    llmData.examples.forEach(ex => { html += `<div class="result-text" style="margin-bottom:8px">• ${escapeHtml(ex.en)} <button class="audio-btn" style="padding:4px 10px;font-size:0.75rem" onclick="speakText('${escapeHtml(ex.en).replace(/'/g, "\\'")}')"">🔊</button><br><span style="color:var(--text-muted);font-size:0.9rem">→ ${escapeHtml(ex.ko)}</span></div>`; });
    html += `</div>`;
  }
  dictionaryOutput.innerHTML = html;
  makeTextClickable(dictionaryOutput);

  const saveBtn = document.getElementById('dict-save-btn');
  if (saveBtn && !saveBtn.disabled) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '⏳ 맞춤 예문 생성 중...';

      let customExamples = [];
      const interests = localStorage.getItem('vocab_interests') || '';
      if (interests.trim()) {
        try {
          const res = await callGemini('custom_example', { word: word, interests: interests, level: getUserLevel() });
          if (res && res.customExamples) {
            customExamples = res.customExamples;
          }
        } catch(e) {
          console.warn("Failed to generate custom examples", e);
        }
      }

      const wordData = {
        word: word,
        phonetic: phonetic,
        meanings: llmData?.meanings || [],
        audioUrl: dictData?.audioUrl || '',
        customExamples: customExamples
      };

      if (saveWord(wordData)) {
        saveBtn.textContent = '✅ 저장됨';
        saveBtn.classList.add('saved');
        updateVocabStats();
      } else {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }
    });
  }
}

async function handleDictionarySubmit() {
  const word = dictionaryInput.value.trim();
  if (!word) return;
  showLoading(); dictionarySubmit.disabled = true;
  try {
    const [dictData, llmData] = await Promise.all([lookupDictionary(word), callGemini('dictionary', { word })]);
    renderDictionaryResult(dictData, llmData);
  } catch (e) { showError(dictionaryOutput, e.message); }
  finally { hideLoading(); dictionarySubmit.disabled = false; }
}
dictionarySubmit.addEventListener('click', handleDictionarySubmit);
dictionaryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleDictionarySubmit(); });

// === VOCABULARY ===
function updateVocabStats() {
  vocabTotal.textContent = getTotalCount();
  vocabReviewCount.textContent = getWordsForReview().length;
  vocabMastered.textContent = getMasteredCount();
}

function renderVocabList() {
  const words = getAllWords();
  updateVocabStats();

  if (words.length === 0) {
    vocabList.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">📝</span><p>사전에서 단어를 검색하고 ⭐ 버튼으로 저장하세요</p></div>`;
    return;
  }

  let html = '';
  words.forEach(w => {
    const badge = w.interval >= 21 ? 'mastered' : w.repetitions > 0 ? 'learning' : 'new';
    const badgeText = w.interval >= 21 ? '마스터' : w.repetitions > 0 ? '학습중' : '새 단어';
    const meaningText = w.meanings?.[0]?.definitions?.[0] || '';
    html += `<div class="vocab-item">
      <div class="vocab-item-info">
        <span class="vocab-item-word">${escapeHtml(w.word)}</span>
        <span class="vocab-item-badge ${badge}">${badgeText}</span>
        <div class="vocab-item-meaning">${escapeHtml(meaningText)}</div>
      </div>
      <div class="vocab-item-actions">
        <button class="audio-btn" style="padding:4px 10px;font-size:0.75rem" onclick="speakText('${escapeHtml(w.word).replace(/'/g, "\\\'")}')">🔊</button>
        <button class="vocab-delete-btn" data-id="${w.id}" title="삭제">🗑️</button>
      </div>
    </div>`;
  });
  vocabList.innerHTML = html;

  // Delete button handlers
  vocabList.querySelectorAll('.vocab-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteWord(btn.dataset.id);
      renderVocabList();
    });
  });
}

// Flashcard Review
let reviewWords = [];
let currentCardIndex = 0;

function startFlashcardReview() {
  reviewWords = getWordsForReview();
  if (reviewWords.length === 0) {
    alert('복습할 단어가 없습니다! 🎉');
    return;
  }
  currentCardIndex = 0;
  flashcardOverlay.style.display = 'flex';
  showCard();
}

function showCard() {
  if (currentCardIndex >= reviewWords.length) {
    flashcardOverlay.style.display = 'none';
    renderVocabList();
    alert(`복습 완료! 총 ${reviewWords.length}개 단어를 복습했습니다. 🎉`);
    return;
  }
  const w = reviewWords[currentCardIndex];
  flashcardCurrent.textContent = currentCardIndex + 1;
  flashcardTotal.textContent = reviewWords.length;
  flashcardWord.textContent = w.word;
  flashcardPhonetic.textContent = w.phonetic || '';
  let meaningText = w.meanings?.map(m => `${m.partOfSpeech}: ${m.definitions?.join(', ')}`).join('\n') || '뜻 정보 없음';

  if (w.customExamples && w.customExamples.length > 0) {
    meaningText += '\n\n💡 내 관심사 맞춤 예문:\n' + w.customExamples.map(ex => `• ${ex.en}\n  → ${ex.ko}`).join('\n\n');
  }

  flashcardMeaning.textContent = meaningText;
  flashcard.classList.remove('flipped');
}

flashcard.addEventListener('click', (e) => {
  if (e.target.closest('.rating-btn') || e.target.closest('.audio-btn')) return;
  flashcard.classList.toggle('flipped');
});

flashcardAudio.addEventListener('click', (e) => {
  e.stopPropagation();
  const w = reviewWords[currentCardIndex];
  if (w?.audioUrl) new Audio(w.audioUrl).play();
  else speak(w.word);
});

document.querySelectorAll('.rating-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const quality = parseInt(btn.dataset.quality);
    const w = reviewWords[currentCardIndex];
    updateReview(w.id, quality);
    currentCardIndex++;
    showCard();
  });
});

flashcardClose.addEventListener('click', () => {
  flashcardOverlay.style.display = 'none';
  renderVocabList();
});

startReviewBtn.addEventListener('click', startFlashcardReview);

// Update vocab when switching to vocabulary tab
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'vocabulary') renderVocabList();
    if (btn.dataset.tab === 'daily') loadDailySentence();
  });
});

// === DAILY SENTENCE ===
let currentDailySentence = null;

// 받은 추천을 날짜별로 보관 (달력 아카이브) + 최근 문장은 AI에게 "반복하지 말라"고 전달
// 형식: { "2026-09-27": [ { at: ISO 시각, themes: [...] }, ... ] }  ※ 이 기기(브라우저)에만 저장됨
const DAILY_ARCHIVE_KEY = 'daily_archive';
const LEGACY_HISTORY_KEY = 'daily_history'; // 아카이브 도입 전 문장 목록 (반복 방지에만 사용)
const DAILY_AVOID_COUNT = 30;

function toDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadDailyArchive() {
  try { return JSON.parse(localStorage.getItem(DAILY_ARCHIVE_KEY)) || {}; } catch { return {}; }
}

function saveToDailyArchive(data) {
  if (!data?.themes?.length) return;
  const archive = loadDailyArchive();
  const key = toDateKey(data.date || new Date());
  const sets = archive[key] || [];
  const first = data.themes[0].sentence;
  if (sets.some(s => s.themes?.[0]?.sentence === first)) return;
  const set = { at: data.date || new Date().toISOString(), themes: data.themes };
  sets.push(set);
  archive[key] = sets;
  localStorage.setItem(DAILY_ARCHIVE_KEY, JSON.stringify(archive));
  queueChange('daily_set', `${key}|${set.at}`, { date: key, ...set }, { updatedAt: Date.parse(set.at) || Date.now() });
}

function getRecentDailySentences(count) {
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY)) || []; } catch {}
  const archived = Object.values(loadDailyArchive()).flat()
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .flatMap(set => set.themes.map(t => t.sentence));
  return [...new Set([...legacy, ...archived].filter(Boolean))].slice(-count);
}

// 아카이브 도입 전에 받아 둔 오늘의 추천도 아카이브에 넣어 둠
try {
  const storedDaily = JSON.parse(localStorage.getItem('daily_sentence'));
  if (storedDaily?.themes) saveToDailyArchive(storedDaily);
} catch {}

async function loadDailySentence() {
  // Check if we already have today's sentence
  const stored = localStorage.getItem('daily_sentence');
  if (stored) {
    try {
      const data = JSON.parse(stored);
      const storedDate = new Date(data.date).toDateString();
      const today = new Date().toDateString();
      if (storedDate === today) {
        displayDailySentence(data);
        return;
      }
    } catch {}
  }
  await generateDailySentence();
}

async function generateDailySentence() {
  dailySentence.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">⏳</span><p>오늘의 추천 영어 표현들을 생성 중입니다...</p></div>`;
  dailyPractice.style.display = 'none';
  try {
    const avoid = getRecentDailySentences(DAILY_AVOID_COUNT);
    const result = await callGemini('daily', { scenes: pickDailyScenes(), avoid, level: getUserLevel() }, { temperature: 1.0 });
    const data = { ...result, date: new Date().toISOString() };
    localStorage.setItem('daily_sentence', JSON.stringify(data));
    saveToDailyArchive(data);
    if (dailyArchive.style.display !== 'none') renderArchive();
    displayDailySentence(data);
  } catch (e) {
    dailySentence.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">⚠️</span><p>생성에 실패했습니다: ${escapeHtml(e.message)}</p></div>`;
  }
}

function renderThemeCards(themes) {
  let html = '';
  themes.forEach(theme => {
      let wordsHtml = '';
      if (theme.words && theme.words.length > 0) {
        wordsHtml = '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">';
        wordsHtml += '<strong style="color:var(--accent-1); font-size:0.85rem;">📚 오늘의 단어:</strong>';
        theme.words.forEach(w => {
          wordsHtml += `<div style="font-size:0.9rem; margin-top:4px;"><span style="color:#e0e0e0;">${escapeHtml(w.word)}</span> - <span style="color:var(--text-muted);">${escapeHtml(w.meaning)}</span></div>`;
        });
        wordsHtml += '</div>';
      }

      html += `
        <div class="daily-theme-card fade-in" style="margin-bottom: 15px; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 10px;">
            <span style="background: linear-gradient(135deg, var(--accent-1), var(--accent-2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold; font-size: 0.9rem;">
              🏷️ ${escapeHtml(theme.name)}
            </span>
            <button class="audio-btn" style="padding: 4px 10px; font-size: 0.8rem;" onclick="speakText('${escapeHtml(theme.sentence).replace(/'/g, "\\'")}')">🔊 듣기</button>
          </div>
          <div class="daily-sentence-text" style="font-size: 1.1rem; margin-bottom: 5px; color: #fff;">${escapeHtml(theme.sentence)}</div>
          <div class="daily-sentence-translation" style="color: var(--text-muted); font-size: 0.95rem;">🇰🇷 ${escapeHtml(theme.translation)}</div>
          ${wordsHtml}
          <div style="margin-top: 10px; text-align: right;">
            <button class="audio-btn" style="background: rgba(255,255,255,0.1); padding: 5px 12px; font-size: 0.8rem;" onclick="setShadowingTarget('${escapeHtml(theme.sentence).replace(/'/g, "\\'")}')">🎙️ 이 문장으로 쉐도잉 연습</button>
          </div>
        </div>
      `;
  });
  return html;
}

function displayDailySentence(data) {
  currentDailySentence = data;
  let html = '';

  if (data.themes && Array.isArray(data.themes)) {
    html = renderThemeCards(data.themes);
  } else {
    // Fallback for old saved data structure
    html = `
      <div class="daily-sentence-text">${escapeHtml(data.sentence || '')}</div>
      <div class="daily-sentence-translation">🇰🇷 ${escapeHtml(data.translation || '')}</div>
      ${data.context ? `<div class="daily-sentence-context" style="margin-top: 10px; font-size: 0.9rem; color: var(--text-muted);">💡 ${escapeHtml(data.context)}</div>` : ''}
    `;
  }

  dailySentence.innerHTML = html;
  makeTextClickable(dailySentence);
  dailyPractice.style.display = 'block';

  // Initialize shadowing with the first theme if available
  if (data.themes && data.themes.length > 0) {
    setShadowingTarget(data.themes[0].sentence);
  } else if (data.sentence) {
    setShadowingTarget(data.sentence);
  }
}

// Global function so onclick works
window.setShadowingTarget = function(sentence) {
  currentDailySentence = { sentence: sentence };
  document.getElementById('daily-stt-result').style.display = 'none';
  document.getElementById('daily-stt-text').textContent = '';
  document.getElementById('daily-mic-status').textContent = '문장을 읽고 발음 평가를 받아보세요.';
};

// Daily TTS buttons
dailyListenSlow.addEventListener('click', () => {
  if (!currentDailySentence) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(currentDailySentence.sentence);
  u.lang = 'en-US'; u.rate = 0.6;
  window.speechSynthesis.speak(u);
});

dailyListenNormal.addEventListener('click', () => {
  if (!currentDailySentence) return;
  speak(currentDailySentence.sentence);
});

dailyListenFast.addEventListener('click', () => {
  if (!currentDailySentence) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(currentDailySentence.sentence);
  u.lang = 'en-US'; u.rate = 1.2;
  window.speechSynthesis.speak(u);
});

// Daily STT setup
dailySpeech.onStart = () => { 
  dailyMicBtn.classList.add('recording'); 
  dailyMicStatus.textContent = '녹음 중... (완료 시 버튼을 다시 누르세요)'; 
  dailyMicStatus.style.color = 'var(--error)'; 
  dailySttResult.style.display = 'block';
  dailySttText.textContent = '듣고 있습니다...';
};
dailySpeech.onEnd = () => { 
  dailyMicBtn.classList.remove('recording'); 
  dailyMicStatus.textContent = '녹음이 완료되었습니다.'; 
  dailyMicStatus.style.color = ''; 
};
dailySpeech.onError = (error) => {
  dailyMicBtn.classList.remove('recording');
  let msg = '음성 인식 중 오류가 발생했습니다.';
  if (error === 'no-speech') msg = '목소리가 감지되지 않았습니다.';
  else if (error === 'not-allowed') msg = '마이크 권한이 거부되었습니다.';
  dailyMicStatus.textContent = msg; dailyMicStatus.style.color = 'var(--error)';
};
dailySpeech.onInterim = (text) => {
  dailySttResult.style.display = 'block';
  dailySttText.textContent = text;
};
dailySpeech.onResult = async (text) => {
  dailySttResult.style.display = 'block';
  dailySttText.textContent = text;
  if (!currentDailySentence) return;
  renderShadowingFeedback(dailyOutput, currentDailySentence.sentence, text);
};

dailyMicBtn.addEventListener('click', () => {
  if (!currentDailySentence) {
    dailyMicStatus.textContent = '⚠️ 먼저 오늘의 문장을 불러와 주세요!';
    dailyMicStatus.style.color = 'var(--warning-1)';
    return;
  }
  dailySpeech.start();
});

dailyNewBtn.addEventListener('click', generateDailySentence);

// === DAILY ARCHIVE (달력) ===
const dailyArchive = $('#daily-archive');
const dailyArchiveBtn = $('#daily-archive-btn');
const archiveMonthEl = $('#archive-month');
const archiveGrid = $('#archive-grid');
const archiveDetail = $('#archive-detail');
let archiveMonth = new Date();          // 달력에 표시 중인 달
let archiveSelectedKey = toDateKey(new Date());

function renderArchive() {
  const archive = loadDailyArchive();
  const year = archiveMonth.getFullYear();
  const month = archiveMonth.getMonth();
  const todayKey = toDateKey(new Date());
  archiveMonthEl.textContent = `${year}년 ${month + 1}월`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let html = '<span class="archive-day empty"></span>'.repeat(firstDay);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = toDateKey(new Date(year, month, day));
    const count = archive[key]?.length || 0;
    const classes = ['archive-day'];
    if (count) classes.push('has-entry');
    if (key === todayKey) classes.push('today');
    if (key === archiveSelectedKey) classes.push('selected');
    html += `<button class="${classes.join(' ')}" data-key="${key}" ${count ? '' : 'disabled'} title="${count ? `추천 ${count}세트` : ''}">
      <span class="archive-day-num">${day}</span>${count ? `<span class="archive-day-count">${count}</span>` : ''}
    </button>`;
  }
  archiveGrid.innerHTML = html;
  renderArchiveDay(archiveSelectedKey, archive);
}

function renderArchiveDay(key, archive = loadDailyArchive()) {
  const sets = archive[key];
  const [, m, d] = key.split('-').map(Number);
  if (!sets?.length) {
    archiveDetail.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">🗓️</span><p>${m}월 ${d}일에 받은 추천이 없습니다. 점이 있는 날짜를 눌러 보세요.</p></div>`;
    return;
  }
  let html = `<h4 class="archive-detail-title">${m}월 ${d}일 · 추천 ${sets.length}세트</h4>`;
  [...sets].reverse().forEach(set => {
    const time = new Date(set.at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
    html += `<div class="archive-set"><div class="archive-set-time">🕒 ${escapeHtml(time)}</div>${renderThemeCards(set.themes)}</div>`;
  });
  archiveDetail.innerHTML = html;
  makeTextClickable(archiveDetail);
}

dailyArchiveBtn.addEventListener('click', () => {
  const open = dailyArchive.style.display === 'none';
  dailyArchive.style.display = open ? 'block' : 'none';
  dailyArchiveBtn.textContent = open ? '📅 달력 닫기' : '📅 지난 추천 보기';
  if (open) {
    archiveMonth = new Date();
    archiveSelectedKey = toDateKey(new Date());
    renderArchive();
  }
});

archiveGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.archive-day[data-key]');
  if (!cell || cell.disabled) return;
  archiveSelectedKey = cell.dataset.key;
  renderArchive();
});

$('#archive-prev').addEventListener('click', () => {
  archiveMonth = new Date(archiveMonth.getFullYear(), archiveMonth.getMonth() - 1, 1);
  renderArchive();
});
$('#archive-next').addEventListener('click', () => {
  archiveMonth = new Date(archiveMonth.getFullYear(), archiveMonth.getMonth() + 1, 1);
  renderArchive();
});

// 다운로드 헬퍼 함수
function downloadTextFile(filename, text) {
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

// === WORKSHEET & SHADOWING ===
const worksheetSelect = document.getElementById('worksheet-select');
const worksheetContent = document.getElementById('worksheet-content');
const worksheetVideo = document.getElementById('worksheet-video');
const worksheetDictation = document.getElementById('worksheet-dictation');
const worksheetCheckBtn = document.getElementById('worksheet-check-btn');
const worksheetShadowingText = document.getElementById('worksheet-shadowing-text');
const worksheetShadowingKo = document.getElementById('worksheet-shadowing-ko');
const worksheetMicBtn = document.getElementById('worksheet-mic-btn');
const worksheetMicStatus = document.getElementById('worksheet-mic-status');
const worksheetSttResult = document.getElementById('worksheet-stt-result');
const worksheetSttText = document.getElementById('worksheet-stt-text');
const worksheetOutput = document.getElementById('worksheet-output');

let worksheetData = [];
let currentWorksheet = null;
const worksheetSpeech = new SpeechManager();

if (worksheetSelect) {
  fetch('data/worksheet.json')
    .then(res => res.json())
    .then(data => {
      worksheetData = data;
      data.forEach((ws, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${ws.week}주차: ${ws.title}`;
        worksheetSelect.appendChild(option);
      });
    })
    .catch(err => console.error('Failed to load worksheet data', err));

  worksheetSelect.addEventListener('change', (e) => {
    const idx = e.target.value;
    if (idx === '') return;
    currentWorksheet = worksheetData[idx];
    renderWorksheet(currentWorksheet);
  });

  function renderWorksheet(ws) {
    worksheetContent.style.display = 'block';
    worksheetVideo.src = ws.youtubeUrl;

    worksheetDictation.innerHTML = '';
    ws.dictation.forEach((dict, i) => {
      const container = document.createElement('div');
      container.style.marginBottom = '1.5rem';

      let htmlSentence = dict.sentence;
      const blankRegex = /\{(.*?)\}/g;
      let match;
      let blankIndex = 0;
      while ((match = blankRegex.exec(dict.sentence)) !== null) {
        const answer = match[1];
        const hint = dict.hints[blankIndex] || '';
        const inputHtml = `<input type="text" class="dictation-input" data-answer="${escapeHtml(answer)}" placeholder="${escapeHtml(hint)}" style="background:transparent; border:none; border-bottom: 2px solid var(--accent-1); color:#fff; font-size:1rem; outline:none; text-align:center; min-width:80px; width: ${Math.max(answer.length * 12, 80)}px;">`;
        htmlSentence = htmlSentence.replace(match[0], inputHtml);
        blankIndex++;
      }

      container.innerHTML = `
        <div style="font-size:1.1rem; line-height:1.6; margin-bottom:5px;">${i+1}. ${htmlSentence}</div>
        <div style="color:var(--text-muted); font-size:0.95rem;">${escapeHtml(dict.ko)}</div>
      `;
      worksheetDictation.appendChild(container);
      makeTextClickable(container);
    });

    worksheetCheckBtn.style.display = 'block';
    worksheetCheckBtn.querySelector('.btn-text').textContent = '정답 확인하기';
    worksheetCheckBtn.onclick = () => {
      const inputs = worksheetDictation.querySelectorAll('.dictation-input');
      let allCorrect = true;
      inputs.forEach(input => {
        const answer = input.getAttribute('data-answer');
        if (input.value.trim().toLowerCase() === answer.toLowerCase()) {
          input.style.borderBottomColor = 'var(--success)';
          input.style.color = 'var(--success)';
        } else {
          input.style.borderBottomColor = 'var(--error)';
          input.style.color = 'var(--error)';
          input.value = answer;
          allCorrect = false;
        }
      });
      worksheetCheckBtn.querySelector('.btn-text').textContent = allCorrect ? '완벽합니다! 🎉' : '다시 복습해보세요';
    };

    worksheetShadowingText.textContent = ws.shadowing.text;
    makeTextClickable(worksheetShadowingText);
    worksheetShadowingKo.textContent = ws.shadowing.ko;
    worksheetOutput.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">🎯</span><p>낭독 후 발음과 유창성 피드백이 여기에 표시됩니다.</p></div>`;
    worksheetSttResult.style.display = 'none';
  }

  if (!worksheetSpeech.isSupported) {
    worksheetMicBtn.style.opacity = '0.5';
    worksheetMicBtn.style.cursor = 'not-allowed';
    worksheetMicStatus.textContent = '현재 브라우저에서는 음성 인식을 지원하지 않습니다.';
  }

  let worksheetRecording = false;
  worksheetSpeech.onStart = () => { 
    worksheetRecording = true;
    worksheetMicBtn.classList.add('recording'); 
    worksheetMicStatus.textContent = '듣고 있습니다... 문단을 모두 읽어주세요.'; 
    worksheetMicStatus.style.color = 'var(--error)'; 
  };
  worksheetSpeech.onEnd = () => { 
    worksheetRecording = false;
    worksheetMicBtn.classList.remove('recording'); 
    worksheetMicStatus.textContent = '버튼을 누르고 전체 요약을 낭독해 보세요'; 
    worksheetMicStatus.style.color = ''; 
  };
  worksheetSpeech.onError = (error) => {
    worksheetMicStatus.textContent = `오류 발생: ${error}`;
    setTimeout(() => {
      worksheetMicStatus.textContent = '버튼을 누르고 전체 요약을 낭독해 보세요';
    }, 3000);
  };

  worksheetSpeech.onResult = async (text) => {
    if (!text) return;
    worksheetSttResult.style.display = 'block';
    worksheetSttText.textContent = text;
    renderShadowingFeedback(worksheetOutput, currentWorksheet.shadowing.text, text);
  };

  worksheetMicBtn.addEventListener('click', () => {
    if (!currentWorksheet) return;
    if (worksheetRecording) {
      worksheetSpeech.stop();
    } else {
      worksheetSpeech.start();
    }
  });
}

// === YOUTUBE TRANSLATION ===

async function handleYoutubeSubmit() {
  const url = youtubeInput.value.trim();
  if (!url) return;
  showLoading();
  youtubeSubmit.disabled = true;
  youtubeOutput.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">⏳</span><p>서버에서 영상 스크립트를 추출 중입니다 (최대 1~2분 소요)...</p></div>`;

  try {
    const apiKey = getGeminiApiKey();
    // 1. 서버에서 스크립트 덩어리(segments) 가져오기
    const ytData = await fetchYoutubeTranscript(url, apiKey);
    const segments = ytData.segments;
    const sourceMsg = ytData.source === 'cc' ? '공식 자막 추출' : '오디오 음성 인식 추출';

    // 2. 스크립트 번역 (각 덩어리마다 번역하여 점진적 렌더링)
    youtubeOutput.innerHTML = `
      <div class="result-section fade-in" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background: transparent; padding: 0; border: none;">
        <div class="result-label note" style="margin-bottom: 0;">ℹ️ 스크립트 출처: ${sourceMsg}</div>
        <div>
          <button class="submit-btn" id="download-txt" style="padding: 8px 16px; font-size: 0.9rem;" disabled>📥 번역 중...</button>
        </div>
      </div>
      <div id="segments-container"></div>
      <div id="translating-indicator" class="placeholder-message" style="margin-top: 1rem;">
        <span class="placeholder-icon">🔄</span><p>AI가 순차적으로 번역 중입니다...</p>
      </div>
    `;

    const container = document.getElementById('segments-container');
    let textContentToDownload = "=== 유튜브 영상 번역 ===\nURL: " + url + "\n\n";

    for (const seg of segments) {
      let translated = '번역 중 오류 발생 (건너뜀)';
      try {
          const translationData = await callGemini('translation', { text: seg.text });
          if (translationData && translationData.translated) {
              translated = translationData.translated;
          }
      } catch (e) {
          console.error('Segment translation failed:', e);
      }

      const segmentHtml = `
        <div class="transcript-segment fade-in" style="margin-bottom: 1.5rem; padding: 1.2rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;">
          <div class="timecode" style="color: var(--accent-1); font-weight: 600; font-size: 0.9rem; margin-bottom: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
            <span>⏱️ [${seg.time}]</span>
            <button class="audio-btn" style="padding: 4px 8px; font-size: 0.75rem;" onclick="speakText('${escapeHtml(seg.text).replace(/'/g, "\\'")}')">🔊 듣기</button>
          </div>
          <div class="eng-text" style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 0.8rem; line-height: 1.5;">${escapeHtml(seg.text)}</div>
          <div class="kor-text" style="font-size: 1.05rem; color: #fff; line-height: 1.6;">${escapeHtml(translated)}</div>
        </div>
      `;

      container.insertAdjacentHTML('beforeend', segmentHtml);
      textContentToDownload += `[${seg.time}]\n원문: ${seg.text}\n번역: ${translated}\n\n`;

      // Groq 무료 계정의 분당 토큰 제한(TPM) 초과를 방지하기 위해 청크 사이에 2초 대기
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    document.getElementById('translating-indicator').style.display = 'none';

    const downloadBtn = document.getElementById('download-txt');
    downloadBtn.disabled = false;
    downloadBtn.textContent = '📥 텍스트 파일로 다운로드';
    downloadBtn.addEventListener('click', () => {
      downloadTextFile('youtube_translation.txt', textContentToDownload);
    });

  } catch (e) {
    showError(youtubeOutput, e.message);
  } finally {
    hideLoading();
    youtubeSubmit.disabled = false;
  }
}

youtubeSubmit.addEventListener('click', handleYoutubeSubmit);
youtubeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleYoutubeSubmit(); });



  // Vocabulary Interests Logic
  const interestsInput = document.getElementById('vocab-interests');
  if (interestsInput) {
    interestsInput.value = localStorage.getItem('vocab_interests') || '';
    interestsInput.addEventListener('change', (e) => {
      const value = e.target.value.trim();
      const at = Date.now();
      localStorage.setItem('vocab_interests', value);
      localStorage.setItem('vocab_interests_at', String(at));
      queueChange('setting', 'vocab_interests', { value }, { updatedAt: at });
    });
  }
  updateVocabStats();
// Speech setup
if (!speech.isSupported) {
  micBtn.style.opacity = '0.5'; micBtn.style.cursor = 'not-allowed';
  micStatus.textContent = '이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.';
}
speech.onStart = () => { micBtn.classList.add('recording'); micStatus.textContent = '🔴 듣고 있습니다... 말씀해 주세요'; micStatus.style.color = 'var(--error)'; };
speech.onEnd = () => { micBtn.classList.remove('recording'); micStatus.textContent = '마이크 버튼을 눌러 다시 시작하세요'; micStatus.style.color = ''; };
speech.onError = (error) => {
  micBtn.classList.remove('recording');
  let msg = '음성 인식 오류가 발생했습니다.';
  if (error === 'not-supported') msg = '이 브라우저는 음성 인식을 지원하지 않습니다.';
  else if (error === 'no-speech') msg = '음성이 감지되지 않았습니다. 다시 시도해 주세요.';
  else if (error === 'not-allowed') msg = '마이크 사용 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.';
  micStatus.textContent = msg; micStatus.style.color = 'var(--error)';
};
speech.onResult = async (text) => {
  sttResult.style.display = 'block'; sttText.textContent = text;
  const target = pronunciationTarget.value.trim();
  if (!target) { showError(pronunciationOutput, '목표 문장을 먼저 입력해 주세요.'); return; }
  renderShadowingFeedback(pronunciationOutput, target, text);
};
micBtn.addEventListener('click', () => {
  if (!pronunciationTarget.value.trim()) {
    micStatus.textContent = '⚠️ 먼저 목표 문장을 입력해 주세요!'; micStatus.style.color = 'var(--warning-1)';
    pronunciationTarget.focus(); return;
  }
  speech.start();
});

// === NUANCE CHATBOT ===
const nuanceFab = document.getElementById('nuance-fab');
const nuanceOverlay = document.getElementById('nuance-overlay');
const nuanceClose = document.getElementById('nuance-close');
const nuanceInput = document.getElementById('nuance-input');
const nuanceSubmit = document.getElementById('nuance-submit');
const nuanceOutput = document.getElementById('nuance-output');

if (nuanceFab) {
  nuanceFab.addEventListener('click', () => {
    nuanceOverlay.style.display = 'flex';
    nuanceInput.focus();
  });

  nuanceClose.addEventListener('click', () => {
    nuanceOverlay.style.display = 'none';
  });

  nuanceOverlay.addEventListener('click', (e) => {
    if (e.target === nuanceOverlay) nuanceOverlay.style.display = 'none';
  });

  nuanceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && window.handleNuanceSubmit) window.handleNuanceSubmit();
  });
}

console.log('🎓 AI Language Tutor loaded successfully!');


// === SETTINGS MODAL ===
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close');
const ngrokUrlInput = document.getElementById('ngrok-url-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');

if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    ngrokUrlInput.value = localStorage.getItem('backend_url') || '';
    const groqKeyInput = document.getElementById('groq-api-key-input');
    if(groqKeyInput) groqKeyInput.value = localStorage.getItem('groq_api_key') || '';
    settingsModal.style.display = 'block';
  });
}

if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', () => {
    const url = ngrokUrlInput.value.trim();
    if (url) {
      localStorage.setItem('backend_url', url);
    } else {
      localStorage.removeItem('backend_url');
    }
    const groqKeyInput = document.getElementById('groq-api-key-input');
    if(groqKeyInput) {
        if(groqKeyInput.value.trim()) localStorage.setItem('groq_api_key', groqKeyInput.value.trim());
        else localStorage.removeItem('groq_api_key');
    }
    settingsModal.style.display = 'none';
    alert('백엔드 서버 주소가 저장되었습니다.');
  });
}

window.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = 'none';
  }
});

// === ROLE-PLAY (Phase 2.1) ===
const roleplaySetup = $('#roleplay-setup');
const roleplayScenarios = $('#roleplay-scenarios');
const roleplayCustom = $('#roleplay-custom');
const roleplayLevel = $('#roleplay-level');
const roleplayAutoSpeak = $('#roleplay-autospeak');
const roleplayStart = $('#roleplay-start');
const roleplayChatCard = $('#roleplay-chat-card');
const roleplayTitle = $('#roleplay-title');
const roleplayChat = $('#roleplay-chat');
const roleplaySuggestions = $('#roleplay-suggestions');
const roleplayInput = $('#roleplay-input');
const roleplaySend = $('#roleplay-send');
const roleplayMic = $('#roleplay-mic');
const roleplayEnd = $('#roleplay-end');
const roleplaySpeech = new SpeechManager();

const ROLEPLAY_HISTORY_LIMIT = 12; // AI에게 보내는 최근 대화 수 (요청 크기 제한)
let roleplayScenarioId = ROLEPLAY_SCENARIOS[0].id;
let roleplaySession = null;        // { scenario, aiRole, userRole, level, title, history: [{role, text}], ended }
let roleplayBusy = false;

// 역할극 난이도는 내 레벨을 기본값으로 (대화마다 바꿀 수 있음)
onLevelChange(level => { if (!roleplaySession) roleplayLevel.value = level; });

roleplayScenarios.innerHTML = ROLEPLAY_SCENARIOS.map(s =>
  `<button class="roleplay-chip${s.id === roleplayScenarioId ? ' active' : ''}" data-id="${s.id}">${escapeHtml(s.label)}</button>`
).join('');

roleplayScenarios.addEventListener('click', (e) => {
  const chip = e.target.closest('.roleplay-chip');
  if (!chip) return;
  roleplayScenarioId = chip.dataset.id;
  roleplayScenarios.querySelectorAll('.roleplay-chip').forEach(c => c.classList.toggle('active', c === chip));
  roleplayCustom.style.display = roleplayScenarioId === 'custom' ? 'block' : 'none';
  if (roleplayScenarioId === 'custom') roleplayCustom.focus();
});

function scrollRoleplayToBottom() {
  roleplayChat.scrollTop = roleplayChat.scrollHeight;
}

function addRoleplayAiMessage(reply, replyKo) {
  const msg = document.createElement('div');
  msg.className = 'rp-msg ai fade-in';
  msg.innerHTML = `
    <div class="rp-bubble"><span class="rp-text">${escapeHtml(reply)}</span></div>
    <div class="rp-tools">
      <button class="rp-tool" data-action="speak">🔊 듣기</button>
      ${replyKo ? '<button class="rp-tool" data-action="ko">해석 보기</button>' : ''}
    </div>
    ${replyKo ? `<div class="rp-ko" style="display:none;">${escapeHtml(replyKo)}</div>` : ''}`;
  msg.querySelector('[data-action="speak"]').addEventListener('click', () => speak(reply));
  const koBtn = msg.querySelector('[data-action="ko"]');
  if (koBtn) koBtn.addEventListener('click', () => {
    const ko = msg.querySelector('.rp-ko');
    const show = ko.style.display === 'none';
    ko.style.display = show ? 'block' : 'none';
    koBtn.textContent = show ? '해석 숨기기' : '해석 보기';
  });
  roleplayChat.appendChild(msg);
  makeTextClickable(msg.querySelector('.rp-text'));
  scrollRoleplayToBottom();
  if (roleplayAutoSpeak.checked) speak(reply);
}

function addRoleplayUserMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'rp-msg user fade-in';
  msg.innerHTML = `<div class="rp-bubble">${escapeHtml(text)}</div><div class="rp-feedback pending">⏳ 표현 확인 중...</div>`;
  roleplayChat.appendChild(msg);
  scrollRoleplayToBottom();
  return msg.querySelector('.rp-feedback');
}

function renderRoleplayFeedback(el, feedback, userText) {
  if (!feedback) { el.remove(); return; }
  el.classList.remove('pending');
  // 한국어로 쓴 경우는 채점하지 않고 "영어로는 이렇게" 안내만 보여줌
  const wroteKorean = /[가-힣]/.test(userText);
  const score = !wroteKorean && Number.isFinite(feedback.score) ? feedback.score : null;
  if (!wroteKorean && feedback.isNatural && (score === null || score >= 85)) {
    el.className = 'rp-feedback good';
    el.innerHTML = `✅ 자연스러워요!${score !== null ? ` <span class="rp-score">${score}점</span>` : ''}${feedback.comment ? `<div class="rp-comment">${escapeHtml(feedback.comment)}</div>` : ''}`;
  } else {
    el.className = 'rp-feedback improve';
    el.innerHTML = `${wroteKorean ? '🇺🇸 영어로는 이렇게 말해요' : '💡 이렇게 말하면 더 자연스러워요'}${score !== null ? ` <span class="rp-score">${score}점</span>` : ''}
      <div class="rp-corrected"><span class="rp-corrected-text">${escapeHtml(feedback.corrected || '')}</span> <button class="rp-tool" data-action="speak">🔊</button></div>
      ${feedback.comment ? `<div class="rp-comment">${escapeHtml(feedback.comment)}</div>` : ''}`;
    el.querySelector('[data-action="speak"]').addEventListener('click', () => speak(feedback.corrected || ''));
    makeTextClickable(el.querySelector('.rp-corrected-text'));
  }
  scrollRoleplayToBottom();
}

function renderRoleplaySuggestions(list) {
  const items = (list || []).filter(Boolean).slice(0, 3);
  roleplaySuggestions.innerHTML = items.length
    ? `<span class="rp-suggest-label">💬 이렇게 대답해 볼 수 있어요:</span>` + items.map(s => `<button class="roleplay-chip rp-suggest">${escapeHtml(s)}</button>`).join('')
    : '';
}

roleplaySuggestions.addEventListener('click', (e) => {
  const chip = e.target.closest('.rp-suggest');
  if (!chip) return;
  roleplayInput.value = chip.textContent;
  roleplayInput.focus();
});

function setRoleplayBusy(busy) {
  roleplayBusy = busy;
  const ended = roleplaySession?.ended;
  roleplaySend.disabled = busy || ended;
  roleplayInput.disabled = busy || ended;
  roleplayMic.disabled = busy || ended;
}

async function requestRoleplayTurn(message) {
  const s = roleplaySession;
  return callGemini('roleplay', {
    scenario: s.scenario, aiRole: s.aiRole, userRole: s.userRole, level: s.level,
    history: s.history.slice(-ROLEPLAY_HISTORY_LIMIT),
    message,
  }, { temperature: 0.8 });
}

function finishRoleplayIfEnded(result) {
  if (!result.ended) return;
  roleplaySession.ended = true;
  roleplaySuggestions.innerHTML = '';
  const done = document.createElement('div');
  done.className = 'rp-system';
  done.textContent = '🎉 대화가 자연스럽게 마무리됐어요! [다른 상황 고르기]로 새 대화를 시작해 보세요.';
  roleplayChat.appendChild(done);
  scrollRoleplayToBottom();
}

async function startRoleplay() {
  const preset = ROLEPLAY_SCENARIOS.find(s => s.id === roleplayScenarioId);
  const customText = roleplayCustom.value.trim();
  if (preset.id === 'custom' && !customText) {
    roleplayCustom.focus();
    roleplayCustom.placeholder = '⚠️ 상황을 먼저 입력해 주세요 (예: 이웃에게 택배를 대신 받아 달라고 부탁하기)';
    return;
  }
  roleplaySession = {
    scenario: preset.id === 'custom' ? customText : preset.scenario,
    aiRole: preset.aiRole,
    userRole: preset.userRole,
    level: roleplayLevel.value,
    title: preset.id === 'custom' ? `✏️ ${customText}` : preset.label,
    history: [],
    ended: false,
  };
  roleplayTitle.textContent = `${roleplaySession.title} · ${roleplayLevel.options[roleplayLevel.selectedIndex].text.split(' ')[0]}`;
  roleplayChat.innerHTML = '<div class="rp-system">⏳ AI가 상대역을 준비하고 있어요...</div>';
  roleplaySuggestions.innerHTML = '';
  roleplaySetup.style.display = 'none';
  roleplayChatCard.style.display = 'block';
  setRoleplayBusy(true);
  try {
    const result = await requestRoleplayTurn('');
    roleplayChat.innerHTML = '';
    roleplaySession.history.push({ role: 'ai', text: result.reply });
    addRoleplayAiMessage(result.reply, result.replyKo);
    renderRoleplaySuggestions(result.suggestions);
    finishRoleplayIfEnded(result);
  } catch (e) {
    roleplayChat.innerHTML = `<div class="rp-system error">⚠️ 대화를 시작하지 못했어요: ${escapeHtml(e.message)}</div>`;
  } finally {
    setRoleplayBusy(false);
    roleplayInput.focus();
  }
}

async function sendRoleplayMessage() {
  const text = roleplayInput.value.trim();
  if (!text || roleplayBusy || !roleplaySession || roleplaySession.ended) return;
  roleplaySpeech.stop();
  roleplayInput.value = '';
  roleplaySuggestions.innerHTML = '';
  const feedbackEl = addRoleplayUserMessage(text);
  setRoleplayBusy(true);
  try {
    const result = await requestRoleplayTurn(text);
    roleplaySession.history.push({ role: 'user', text }, { role: 'ai', text: result.reply });
    renderRoleplayFeedback(feedbackEl, result.feedback, text);
    addRoleplayAiMessage(result.reply, result.replyKo);
    renderRoleplaySuggestions(result.suggestions);
    finishRoleplayIfEnded(result);
  } catch (e) {
    // 실패한 메시지는 대화 기록에 넣지 않고 입력창에 돌려놓아 다시 보낼 수 있게 함
    feedbackEl.className = 'rp-feedback error';
    feedbackEl.textContent = `⚠️ 전송 실패: ${e.message} — 다시 보내 주세요.`;
    roleplayInput.value = text;
  } finally {
    setRoleplayBusy(false);
    roleplayInput.focus();
  }
}

roleplayStart.addEventListener('click', startRoleplay);
roleplaySend.addEventListener('click', sendRoleplayMessage);
roleplayInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) sendRoleplayMessage();
});
roleplayEnd.addEventListener('click', () => {
  roleplaySpeech.stop();
  window.speechSynthesis?.cancel();
  roleplaySession = null;
  roleplayChatCard.style.display = 'none';
  roleplaySetup.style.display = 'block';
});

// 말로 대답하기: 인식된 문장을 입력창에 넣고, 확인 후 직접 보내도록 함
if (!roleplaySpeech.isSupported) {
  roleplayMic.style.display = 'none';
}
roleplaySpeech.onStart = () => { roleplayMic.classList.add('recording'); roleplayInput.placeholder = '🔴 듣고 있어요... 다 말했으면 🎤를 다시 누르세요'; };
roleplaySpeech.onInterim = (text) => { roleplayInput.value = text; };
roleplaySpeech.onResult = (text) => { roleplayInput.value = text; roleplayInput.focus(); };
roleplaySpeech.onEnd = () => { roleplayMic.classList.remove('recording'); roleplayInput.placeholder = '영어로 대답해 보세요 (한국어로 쓰면 영어 표현을 알려드려요)'; };
roleplaySpeech.onError = (error) => {
  roleplayMic.classList.remove('recording');
  roleplayInput.placeholder = error === 'not-allowed' ? '⚠️ 마이크 권한이 필요합니다' : '⚠️ 음성이 인식되지 않았어요. 다시 시도해 주세요';
};
roleplayMic.addEventListener('click', () => {
  if (roleplaySpeech.isListening) roleplaySpeech.stop();
  else { window.speechSynthesis?.cancel(); roleplaySpeech.start(); }
});

// === PDF WORKSHEET (Phase 2.2) ===
// PDF에서 글자를 뽑아 구간별로 AI 분석 → 핵심 단어 / 빈칸 퀴즈 / 쉐도잉. 결과는 파일 해시 기준으로 localStorage에 캐시
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs';
const PDF_CHUNK_CHARS = 1500;     // AI에 한 번에 보내는 글자 수
const PDF_MAX_CHUNKS = 10;        // 문서당 최대 분석 구간 (API 한도 보호)
const PDF_MAX_FILE_MB = 30;
const PDF_REQUEST_GAP_MS = 1500;  // 구간 사이 대기 (분당 요청 한도 보호)
const PDF_INDEX_KEY = 'pdf_ws_index';
const PDF_DOC_PREFIX = 'pdf_ws_';
const PDF_MAX_DOCS = 8;

const pdfFileInput = $('#pdf-file');
const pdfDrop = $('#pdf-drop');
const pdfRecent = $('#pdf-recent');
const pdfStatus = $('#pdf-status');
const pdfOutput = $('#pdf-ws-output');
const pdfSpeech = new SpeechManager();
let pdfjsPromise = null;
let pdfRunId = 0;                 // 새 PDF를 열면 이전 분석 루프를 멈추기 위한 번호
let pdfShadowTarget = null;       // { text, resultEl, btn }
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then(mod => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    }).catch(e => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}

function setPdfStatus(text, isError = false) {
  pdfStatus.textContent = text;
  pdfStatus.classList.toggle('error', isError);
}

async function hashArrayBuffer(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function extractPdfText(buf) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const limit = PDF_CHUNK_CHARS * PDF_MAX_CHUNKS * 1.2;
  let text = '';
  for (let p = 1; p <= pdf.numPages && text.length < limit; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join('') + '\n';
  }
  return { text, pages: pdf.numPages };
}

function splitPdfText(raw) {
  const text = raw
    .replace(/(\w)-\n(\w)/g, '$1$2')   // 줄 끝 하이픈으로 끊긴 단어 잇기
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const sentences = text.split(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/);
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if (current && (current.length + s.length + 1) > PDF_CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${s}` : s;
    // 문장 부호가 없어 한 문장이 너무 긴 경우 강제로 자름
    while (current.length > PDF_CHUNK_CHARS * 1.5) {
      chunks.push(current.slice(0, PDF_CHUNK_CHARS));
      current = current.slice(PDF_CHUNK_CHARS);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter(c => c.trim().length >= 40);
}

// --- 캐시
function loadPdfIndex() {
  try { return JSON.parse(localStorage.getItem(PDF_INDEX_KEY)) || []; } catch { return []; }
}
function loadPdfDoc(hash) {
  try { return JSON.parse(localStorage.getItem(PDF_DOC_PREFIX + hash)); } catch { return null; }
}
function savePdfDoc(hash, doc) {
  const index = loadPdfIndex().filter(d => d.hash !== hash);
  index.unshift({ hash, name: doc.name, createdAt: doc.createdAt, total: doc.chunks.length });
  while (index.length > PDF_MAX_DOCS) localStorage.removeItem(PDF_DOC_PREFIX + index.pop().hash);
  try {
    localStorage.setItem(PDF_DOC_PREFIX + hash, JSON.stringify(doc));
    localStorage.setItem(PDF_INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.warn('PDF cache save failed:', e);
    setPdfStatus('⚠️ 저장 공간이 부족해 분석 결과를 저장하지 못했어요. 최근 PDF 목록에서 오래된 항목을 지워 주세요.', true);
  }
}
function deletePdfDoc(hash) {
  localStorage.removeItem(PDF_DOC_PREFIX + hash);
  localStorage.setItem(PDF_INDEX_KEY, JSON.stringify(loadPdfIndex().filter(d => d.hash !== hash)));
}

function renderPdfRecent() {
  const index = loadPdfIndex();
  if (!index.length) { pdfRecent.innerHTML = ''; return; }
  pdfRecent.innerHTML = '<div class="pdf-recent-label">🕘 최근 PDF</div>' + index.map(d => {
    const date = new Date(d.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
    return `<div class="pdf-recent-item" data-hash="${d.hash}">
      <button class="pdf-recent-open" data-hash="${d.hash}">📄 ${escapeHtml(d.name)} <span class="pdf-recent-meta">${date} · ${d.total}구간</span></button>
      <button class="pdf-recent-del" data-hash="${d.hash}" title="목록에서 지우기">✕</button>
    </div>`;
  }).join('');
}

pdfRecent.addEventListener('click', (e) => {
  const del = e.target.closest('.pdf-recent-del');
  if (del) { deletePdfDoc(del.dataset.hash); renderPdfRecent(); return; }
  const open = e.target.closest('.pdf-recent-open');
  if (open) {
    const doc = loadPdfDoc(open.dataset.hash);
    if (doc) runPdfWorksheet(open.dataset.hash, doc);
    else { deletePdfDoc(open.dataset.hash); renderPdfRecent(); }
  }
});

// --- 렌더링
function highlightPassage(text, vocab) {
  const words = (vocab || []).map(v => v.word).filter(w => w && w.length > 1)
    .sort((a, b) => b.length - a.length)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return escapeHtml(text);
  const meaningOf = Object.fromEntries((vocab || []).map(v => [v.word.toLowerCase(), v.meaning]));
  const re = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
  let html = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    html += escapeHtml(text.slice(last, m.index));
    html += `<mark class="pdf-key" title="${escapeAttr(meaningOf[m[0].toLowerCase()] || '')}">${escapeHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

function renderPdfSection(el, index, total, chunk, result) {
  if (!result) {
    el.innerHTML = `<div class="pdf-section-head">구간 ${index + 1} / ${total}</div><div class="pdf-section-msg error">⚠️ 이 구간은 분석하지 못했어요. PDF를 다시 열면 이 구간만 다시 시도해요.</div>`;
    return;
  }
  const vocab = Array.isArray(result.keyVocabulary) ? result.keyVocabulary : [];
  const blanks = Array.isArray(result.blanks) ? result.blanks : [];
  const shadow = result.shadowing?.text ? result.shadowing : null;

  let html = `<div class="pdf-section-head">구간 ${index + 1} / ${total}</div>`;
  if (result.summaryKo) html += `<div class="pdf-summary">📝 ${escapeHtml(result.summaryKo)}</div>`;
  html += `<details class="pdf-passage"><summary>📖 지문 보기 (핵심 단어 표시)</summary><div class="pdf-passage-text">${highlightPassage(chunk, vocab)}</div></details>`;

  if (vocab.length) {
    html += `<div class="pdf-block"><div class="pdf-block-title">📚 핵심 단어</div>` + vocab.map((v, i) => {
      const saved = isWordSaved(v.word);
      return `<div class="pdf-vocab-row">
        <span class="pdf-vocab-word">${escapeHtml(v.word)}</span>
        <span class="pdf-vocab-meaning">${escapeHtml(v.meaning || '')}</span>
        <button class="rp-tool" data-action="speak-word" data-i="${i}">🔊</button>
        <button class="pdf-save-btn${saved ? ' saved' : ''}" data-i="${i}" ${saved ? 'disabled' : ''}>${saved ? '✅ 저장됨' : '⭐ 단어장'}</button>
      </div>`;
    }).join('') + `</div>`;
  }

  if (blanks.length) {
    html += `<div class="pdf-block"><div class="pdf-block-title">✏️ 빈칸 채우기</div>` + blanks.map((b, i) => {
      let sentence = String(b.sentence || '');
      const answer = String(b.answer || '');
      const input = `<input type="text" class="dictation-input pdf-blank" data-answer="${escapeAttr(answer)}" placeholder="${escapeAttr(b.hint || '')}" style="width:${Math.max(answer.length * 11, 90)}px">`;
      let body;
      if (/_{2,}/.test(sentence)) {
        const [before, ...rest] = sentence.split(/_{2,}/);
        body = escapeHtml(before) + input + escapeHtml(rest.join('____'));
      } else {
        const pos = answer ? sentence.toLowerCase().indexOf(answer.toLowerCase()) : -1;
        body = pos >= 0 ? escapeHtml(sentence.slice(0, pos)) + input + escapeHtml(sentence.slice(pos + answer.length)) : escapeHtml(sentence) + ' ' + input;
      }
      return `<div class="pdf-blank-row">${i + 1}. ${body}</div>`;
    }).join('') + `<button class="audio-btn pdf-check-btn">정답 확인하기</button></div>`;
  }

  if (shadow) {
    html += `<div class="pdf-block"><div class="pdf-block-title">🎙️ 쉐도잉</div>
      <div class="pdf-shadow-text">${escapeHtml(shadow.text)}</div>
      ${shadow.ko ? `<div class="pdf-shadow-ko">${escapeHtml(shadow.ko)}</div>` : ''}
      <div class="pdf-shadow-actions">
        <button class="audio-btn" data-action="speak-shadow">🔊 듣기</button>
        <button class="audio-btn pdf-shadow-mic" data-action="record">🎤 따라 읽기</button>
      </div>
      <div class="pdf-shadow-result"></div>
    </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.pdf-passage-text, .pdf-shadow-text').forEach(n => makeTextClickable(n));

  el.querySelectorAll('[data-action="speak-word"]').forEach(btn => btn.addEventListener('click', () => speak(vocab[btn.dataset.i].word)));
  el.querySelectorAll('.pdf-save-btn').forEach(btn => btn.addEventListener('click', () => {
    const v = vocab[btn.dataset.i];
    if (saveWord({ word: v.word, meanings: [{ partOfSpeech: '뜻', definitions: [v.meaning || ''] }] })) {
      btn.textContent = '✅ 저장됨'; btn.classList.add('saved'); btn.disabled = true;
      updateVocabStats();
    }
  }));
  const checkBtn = el.querySelector('.pdf-check-btn');
  if (checkBtn) checkBtn.addEventListener('click', () => {
    let allCorrect = true;
    el.querySelectorAll('.pdf-blank').forEach(input => {
      const answer = input.dataset.answer;
      const ok = input.value.trim().toLowerCase() === answer.trim().toLowerCase();
      input.style.borderBottomColor = ok ? 'var(--success-1)' : 'var(--error)';
      input.style.color = ok ? 'var(--success-1)' : 'var(--error)';
      if (!ok) { input.value = answer; allCorrect = false; }
    });
    checkBtn.textContent = allCorrect ? '완벽해요! 🎉' : '틀린 칸에 정답을 채워 뒀어요';
  });
  if (shadow) {
    el.querySelector('[data-action="speak-shadow"]').addEventListener('click', () => speak(shadow.text));
    const micBtn = el.querySelector('[data-action="record"]');
    const resultEl = el.querySelector('.pdf-shadow-result');
    if (!pdfSpeech.isSupported) micBtn.style.display = 'none';
    micBtn.addEventListener('click', () => {
      if (pdfSpeech.isListening) { pdfSpeech.stop(); return; }
      pdfShadowTarget = { text: shadow.text, resultEl, btn: micBtn };
      window.speechSynthesis?.cancel();
      pdfSpeech.start();
    });
  }
}

pdfSpeech.onStart = () => {
  if (!pdfShadowTarget) return;
  pdfShadowTarget.btn.classList.add('recording');
  pdfShadowTarget.btn.textContent = '⏹️ 다 읽었어요';
  pdfShadowTarget.resultEl.innerHTML = '<div class="pdf-section-msg">🔴 듣고 있어요... 문장을 소리 내어 읽어 주세요</div>';
};
pdfSpeech.onInterim = (text) => {
  if (pdfShadowTarget) pdfShadowTarget.resultEl.innerHTML = `<div class="pdf-section-msg">🎙️ ${escapeHtml(text)}</div>`;
};
pdfSpeech.onEnd = () => {
  if (!pdfShadowTarget) return;
  pdfShadowTarget.btn.classList.remove('recording');
  pdfShadowTarget.btn.textContent = '🎤 따라 읽기';
};
pdfSpeech.onError = (error) => {
  if (!pdfShadowTarget) return;
  pdfShadowTarget.btn.classList.remove('recording');
  pdfShadowTarget.btn.textContent = '🎤 따라 읽기';
  pdfShadowTarget.resultEl.innerHTML = `<div class="pdf-section-msg error">${error === 'not-allowed' ? '⚠️ 마이크 권한이 필요합니다.' : '⚠️ 음성이 인식되지 않았어요. 다시 시도해 주세요.'}</div>`;
};
pdfSpeech.onResult = async (text) => {
  const target = pdfShadowTarget;
  if (!target) return;
  renderShadowingFeedback(target.resultEl, target.text, text);
};

// === 쉐도잉 결과 (Phase 2.3) — 발음 탭 / 오늘의 영어 / 학습지 / PDF 공통 ===
// 브라우저에서 바로 단어별 채점(API 호출 없음) → 원하면 [AI 발음 팁]으로 자세한 조언
const SHADOW_LABELS = { correct: '정확', close: '비슷함', wrong: '틀림', missed: '빠짐' };

function renderShadowingFeedback(container, target, recognized) {
  const { words, extra, score } = compareWords(target, recognized);
  const count = (st) => words.filter(w => w.status === st).length;
  const grade = score >= 90 ? 'good' : score >= 60 ? 'ok' : 'needs-work';
  const wordsHtml = words.map(w => {
    const tip = w.status === 'wrong' || w.status === 'close' ? `들린 말: ${w.heard}` : w.status === 'missed' ? '인식되지 않음' : '';
    const clickable = w.status !== 'correct' ? ' data-speak="1"' : '';
    return `<span class="sh-word ${w.status}"${clickable} title="${escapeHtml(tip).replace(/"/g, '&quot;')}">${escapeHtml(w.text)}</span>`;
  }).join(' ');

  container.innerHTML = `
    <div class="sh-result fade-in">
      <div class="sh-score ${grade}">🎯 ${score}점</div>
      <div class="sh-counts">정확 ${count('correct')} · 비슷함 ${count('close')} · 틀림 ${count('wrong')} · 빠짐 ${count('missed')}</div>
      <div class="sh-words">${wordsHtml}</div>
      <div class="sh-legend"><span class="sh-dot correct"></span>정확 <span class="sh-dot close"></span>비슷함 <span class="sh-dot wrong"></span>틀림·빠짐 · 색이 있는 단어를 누르면 원어민 발음을 들려줘요</div>
      ${words.some(w => w.status === 'wrong' || w.status === 'close') ? `<div class="sh-detail">${words.filter(w => w.status === 'wrong' || w.status === 'close').map(w => `<span><b>${escapeHtml(w.text)}</b> → ${escapeHtml(w.heard)}</span>`).join('')}</div>` : ''}
      ${extra.length ? `<div class="sh-extra">➕ 원문에 없는 말: ${escapeHtml(extra.join(' '))}</div>` : ''}
      <div class="sh-heard">🎙️ 인식된 문장: ${escapeHtml(recognized)}</div>
      <button class="audio-btn sh-ai-btn">💡 AI 발음 팁 받기</button>
      <div class="sh-ai"></div>
    </div>`;

  container.querySelectorAll('.sh-word[data-speak]').forEach(el => el.addEventListener('click', () => speak(el.textContent.replace(/^[^\w']+|[^\w']+$/g, ''))));
  const aiBtn = container.querySelector('.sh-ai-btn');
  const aiBox = container.querySelector('.sh-ai');
  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    aiBox.innerHTML = '<div class="sh-heard">⏳ AI가 발음을 분석하고 있어요...</div>';
    try {
      const r = await callGemini('pronunciation', { target, recognized });
      let html = '';
      if (r.tips) html += `<div class="result-section fade-in"><div class="result-label tip">🗣️ 발음 팁</div><div class="result-text">${escapeHtml(r.tips)}</div></div>`;
      if (r.overallComment) html += `<div class="result-section fade-in"><div class="result-label overall">👏 총평</div><div class="result-text">${escapeHtml(r.overallComment)}</div></div>`;
      aiBox.innerHTML = html || '<div class="sh-heard">추가 조언이 없어요. 잘하셨어요!</div>';
      aiBtn.style.display = 'none';
    } catch (e) {
      aiBox.innerHTML = `<div class="sh-heard" style="color:var(--error)">⚠️ AI 분석 실패: ${escapeHtml(e.message)}</div>`;
      aiBtn.disabled = false;
    }
  });
}

// --- 분석 실행
async function runPdfWorksheet(hash, doc) {
  const runId = ++pdfRunId;
  const total = doc.chunks.length;
  pdfOutput.style.display = 'block';
  pdfOutput.innerHTML = `<div class="pdf-doc-title">📄 ${escapeHtml(doc.name)}${doc.truncated ? ' <span class="pdf-recent-meta">(앞부분만 분석)</span>' : ''}</div>`;
  const sectionEls = doc.chunks.map((chunk, i) => {
    const el = document.createElement('div');
    el.className = 'pdf-section';
    pdfOutput.appendChild(el);
    if (doc.sections[i]) renderPdfSection(el, i, total, chunk, doc.sections[i]);
    else el.innerHTML = `<div class="pdf-section-head">구간 ${i + 1} / ${total}</div><div class="pdf-section-msg">⏳ 분석 대기 중...</div>`;
    return el;
  });
  renderPdfRecent();

  const pending = doc.chunks.map((_, i) => i).filter(i => !doc.sections[i]);
  if (!pending.length) { setPdfStatus(`✅ 저장된 분석 결과를 불러왔어요 (${total}구간).`); return; }

  let failed = 0;
  for (const [n, i] of pending.entries()) {
    if (runId !== pdfRunId) return; // 다른 PDF를 열었으면 중단
    setPdfStatus(`🔍 AI가 분석하고 있어요... (${n + 1}/${pending.length})`);
    sectionEls[i].querySelector('.pdf-section-msg').textContent = '🔍 분석 중...';
    try {
      const result = await callGemini('pdf_worksheet', { text: doc.chunks[i] });
      if (runId !== pdfRunId) return;
      doc.sections[i] = result;
      savePdfDoc(hash, doc);
      renderPdfSection(sectionEls[i], i, total, doc.chunks[i], result);
    } catch (e) {
      console.warn('PDF section failed:', e);
      failed++;
      renderPdfSection(sectionEls[i], i, total, doc.chunks[i], null);
    }
    if (n < pending.length - 1) await new Promise(r => setTimeout(r, PDF_REQUEST_GAP_MS));
  }
  if (runId === pdfRunId) {
    setPdfStatus(failed ? `⚠️ ${failed}개 구간은 분석하지 못했어요. 최근 PDF에서 다시 열면 그 구간만 다시 시도해요.` : `✅ 분석 완료! (${total}구간)`, failed > 0);
  }
}

async function handlePdfFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    setPdfStatus('⚠️ PDF 파일만 올릴 수 있어요.', true); return;
  }
  if (file.size > PDF_MAX_FILE_MB * 1024 * 1024) {
    setPdfStatus(`⚠️ ${PDF_MAX_FILE_MB}MB 이하의 PDF만 올릴 수 있어요.`, true); return;
  }
  try {
    setPdfStatus('📖 PDF를 읽고 있어요...');
    const buf = await file.arrayBuffer();
    const hash = await hashArrayBuffer(buf);
    const cached = loadPdfDoc(hash);
    if (cached) { runPdfWorksheet(hash, cached); return; }

    const { text } = await extractPdfText(buf);
    let chunks = splitPdfText(text);
    if (!chunks.length) {
      setPdfStatus('⚠️ PDF에서 글자를 찾지 못했어요. 스캔한 이미지 PDF는 지원하지 않아요.', true); return;
    }
    const truncated = chunks.length > PDF_MAX_CHUNKS;
    chunks = chunks.slice(0, PDF_MAX_CHUNKS);
    const doc = { name: file.name, createdAt: new Date().toISOString(), truncated, chunks, sections: chunks.map(() => null) };
    savePdfDoc(hash, doc);
    runPdfWorksheet(hash, doc);
  } catch (e) {
    console.error(e);
    setPdfStatus(`⚠️ PDF를 읽지 못했어요: ${e.message}`, true);
  } finally {
    pdfFileInput.value = '';
  }
}

pdfFileInput.addEventListener('change', () => handlePdfFile(pdfFileInput.files[0]));
['dragenter', 'dragover'].forEach(ev => pdfDrop.addEventListener(ev, (e) => { e.preventDefault(); pdfDrop.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(ev => pdfDrop.addEventListener(ev, (e) => { e.preventDefault(); pdfDrop.classList.remove('dragging'); }));
pdfDrop.addEventListener('drop', (e) => handlePdfFile(e.dataTransfer.files[0]));
renderPdfRecent();

// === 기기 간 동기화 (Phase 2.5) ===
function refreshAfterSync() {
  updateVocabStats();
  if ($('#pane-vocabulary').classList.contains('active')) renderVocabList();
  if (dailyArchive.style.display !== 'none') renderArchive();
  const interests = document.getElementById('vocab-interests');
  if (interests && document.activeElement !== interests) interests.value = localStorage.getItem('vocab_interests') || '';
  applyUserLevelUi();
}

registerSyncKind('vocab', {
  apply: applyRemoteVocab,
  collectAll: collectAllVocab,
});

registerSyncKind('daily_set', {
  apply(changes) {
    const archive = loadDailyArchive();
    let changed = false;
    for (const c of changes) {
      if (c.deleted || !c.data?.themes?.length || !c.data.date) continue;
      const sets = archive[c.data.date] || [];
      const first = c.data.themes[0].sentence;
      if (sets.some(s => s.at === c.data.at || s.themes?.[0]?.sentence === first)) continue;
      sets.push({ at: c.data.at, themes: c.data.themes });
      sets.sort((a, b) => new Date(a.at) - new Date(b.at));
      archive[c.data.date] = sets;
      changed = true;
    }
    if (changed) localStorage.setItem(DAILY_ARCHIVE_KEY, JSON.stringify(archive));
    return changed;
  },
  collectAll() {
    return Object.entries(loadDailyArchive()).flatMap(([date, sets]) =>
      sets.map(set => ({ id: `${date}|${set.at}`, data: { date, ...set }, updatedAt: Date.parse(set.at) || 1 })));
  },
});

// 설정 값: 키별로 더 최근에 바꾼 쪽이 이김. 수정 시각은 `${키}_at`에 보관
const SYNCED_SETTINGS = ['vocab_interests', USER_LEVEL_KEY];

registerSyncKind('setting', {
  apply(changes) {
    let changed = false;
    for (const c of changes) {
      if (!SYNCED_SETTINGS.includes(c.id) || c.deleted) continue;
      const localAt = Number(localStorage.getItem(`${c.id}_at`)) || 0;
      if (localAt >= c.updatedAt) continue;
      localStorage.setItem(c.id, c.data?.value || '');
      localStorage.setItem(`${c.id}_at`, String(c.updatedAt));
      changed = true;
    }
    return changed;
  },
  collectAll() {
    return SYNCED_SETTINGS.flatMap(key => {
      const value = localStorage.getItem(key) || '';
      return value ? [{ id: key, data: { value }, updatedAt: Number(localStorage.getItem(`${key}_at`)) || 1 }] : [];
    });
  },
});

const QRCODE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const syncOff = $('#sync-off');
const syncOn = $('#sync-on');
const syncStatusEl = $('#sync-status');
const syncCodeEl = $('#sync-code');
const syncCodeToggle = $('#sync-code-toggle');
const syncQr = $('#sync-qr');
const syncJoinInput = $('#sync-join-input');
let syncCodeVisible = false;

function renderSyncCard() {
  const enabled = isSyncEnabled();
  syncOff.style.display = enabled ? 'none' : 'block';
  syncOn.style.display = enabled ? 'block' : 'none';
  if (!enabled) { syncQr.style.display = 'none'; syncQr.innerHTML = ''; return; }
  const code = formatCode(getSyncCode());
  syncCodeEl.textContent = syncCodeVisible ? code : code.replace(/[0-9A-Z]/g, '•');
  syncCodeToggle.textContent = syncCodeVisible ? '숨기기' : '보기';
}

onSyncStatus((status) => {
  if (!syncStatusEl) return;
  const last = getLastSyncAt();
  const lastText = last ? new Date(last).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '아직 없음';
  if (status.state === 'syncing') syncStatusEl.textContent = '🔄 동기화 중...';
  else if (status.state === 'error') syncStatusEl.textContent = `⚠️ 동기화 실패: ${status.message} (마지막 성공: ${lastText})`;
  else syncStatusEl.textContent = `✅ 동기화 켜짐 · 마지막 동기화: ${lastText}`;
  syncStatusEl.classList.toggle('error', status.state === 'error');
  if (status.state === 'ok' && status.changed) refreshAfterSync();
});

async function startSyncWith(code) {
  syncStatusEl.textContent = '🔄 연결하는 중...';
  syncCodeVisible = !code; // 새로 만든 코드는 바로 보여 줌
  try {
    await enableSync(code);
  } catch (e) {
    disableSync();
    alert(e.message);
  }
  renderSyncCard();
  refreshAfterSync();
}

$('#sync-enable').addEventListener('click', () => startSyncWith());
$('#sync-join-btn').addEventListener('click', () => {
  const code = syncJoinInput.value;
  if (!isValidCode(code)) { alert('동기화 코드는 26자리예요. 다른 기기에 표시된 코드를 그대로 입력해 주세요.'); return; }
  syncJoinInput.value = '';
  startSyncWith(code);
});
$('#sync-now').addEventListener('click', () => syncNow());
syncCodeToggle.addEventListener('click', () => { syncCodeVisible = !syncCodeVisible; renderSyncCard(); });
$('#sync-code-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(formatCode(getSyncCode())); $('#sync-code-copy').textContent = '복사됨 ✓'; }
  catch { syncCodeVisible = true; renderSyncCard(); }
  setTimeout(() => { $('#sync-code-copy').textContent = '복사'; }, 1500);
});
$('#sync-disable').addEventListener('click', () => {
  if (!confirm('이 기기의 동기화를 끌까요? 이 기기에 있는 단어장과 기록은 그대로 남아요.')) return;
  disableSync();
  renderSyncCard();
});

function loadQrLibrary() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QRCODE_URL;
    script.onload = () => resolve(window.qrcode);
    script.onerror = () => reject(new Error('QR 코드 라이브러리를 불러오지 못했어요.'));
    document.head.appendChild(script);
  });
}

$('#sync-qr-btn').addEventListener('click', async () => {
  if (syncQr.style.display !== 'none') { syncQr.style.display = 'none'; syncQr.innerHTML = ''; return; }
  try {
    const qrcode = await loadQrLibrary();
    // 코드는 주소의 # 뒤에 넣음: # 뒤는 서버로 전송되지 않고, 연결 후 주소창에서 바로 지움
    const link = `${location.origin}${location.pathname}#sync=${formatCode(getSyncCode())}`;
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    syncQr.innerHTML = `${qr.createSvgTag(5, 10)}<p>다른 기기의 카메라로 찍으면 이 동기화에 연결돼요.<br>이 화면을 다른 사람에게 보여주지 마세요.</p>`;
    syncQr.style.display = 'block';
  } catch (e) {
    alert(e.message);
  }
});

// QR 링크(#sync=코드)로 열었을 때: 주소창에서 코드를 지우고, 확인 후 연결
(function handleSyncLink() {
  const match = location.hash.match(/^#sync=([0-9A-Za-z-]+)$/);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  const code = match[1];
  if (!isValidCode(code)) return;
  if (isSyncEnabled() && formatCode(getSyncCode()) === formatCode(code)) return;
  const msg = isSyncEnabled()
    ? '다른 동기화 코드로 연결할까요? 이 기기의 기존 동기화 연결은 해제되고, 이 기기의 데이터는 새 동기화와 합쳐져요.'
    : '이 기기를 동기화에 연결할까요? 이 기기의 단어장과 기록이 다른 기기의 데이터와 합쳐져요.';
  if (confirm(msg)) startSyncWith(code);
})();

renderSyncCard();
if (isSyncEnabled()) syncNow();

// === 주제별 예문 (Phase 3.3) ===
// 레벨 × 주제별로 예문 5개. 결과는 examples_en_{레벨}_{주제} 키로 이 기기에 저장하고, [새 예문 받기] 때만 다시 호출
const examplesTopics = $('#examples-topics');
const examplesCustom = $('#examples-custom');
const examplesLevelEl = $('#examples-level');
const examplesSubmit = $('#examples-submit');
const examplesOutput = $('#examples-output');
const examplesSpeech = new SpeechManager();
const EXAMPLES_INDEX_KEY = 'examples_index';
const EXAMPLES_MAX_CACHED = 30;   // 저장해 두는 주제 수 (오래된 것부터 삭제)
const EXAMPLES_AVOID_COUNT = 30;  // AI에게 "반복하지 말라"고 보내는 이전 예문 수
let examplesTopicId = EXAMPLE_TOPICS[0].id;
let examplesBusy = false;
let examplesShadowTarget = null;  // { text, resultEl, btn }

examplesTopics.innerHTML = EXAMPLE_TOPICS.map(t =>
  `<button class="roleplay-chip${t.id === examplesTopicId ? ' active' : ''}" data-id="${t.id}">${escapeHtml(t.label)}</button>`
).join('');

examplesTopics.addEventListener('click', (e) => {
  const chip = e.target.closest('.roleplay-chip');
  if (!chip || examplesBusy) return;
  examplesTopicId = chip.dataset.id;
  examplesTopics.querySelectorAll('.roleplay-chip').forEach(c => c.classList.toggle('active', c === chip));
  examplesCustom.style.display = examplesTopicId === 'custom' ? 'block' : 'none';
  if (examplesTopicId === 'custom') { examplesCustom.focus(); return; }
  showExamples(false);
});
examplesCustom.addEventListener('keydown', (e) => { if (e.key === 'Enter') showExamples(false); });
examplesSubmit.addEventListener('click', () => showExamples(false));

onLevelChange(level => {
  examplesLevelEl.textContent = `📶 ${LEVELS[level].label} 레벨 (${LEVELS[level].exams.en}) 예문`;
});

function resolveExampleTopic() {
  const preset = EXAMPLE_TOPICS.find(t => t.id === examplesTopicId);
  if (preset.id === 'custom') {
    const text = examplesCustom.value.trim();
    if (!text) return { error: '주제를 먼저 입력해 주세요 (예: 헬스장, 이사, 주식 투자)' };
    return { key: `custom:${text.toLowerCase().slice(0, 60)}`, topic: text, title: `✏️ ${text}` };
  }
  if (preset.id === 'interests') {
    const text = (localStorage.getItem('vocab_interests') || '').trim();
    if (!text) return { error: '단어장 탭의 🎯 내 관심사를 먼저 입력해 주세요 (예: IT, 요리, 게임)' };
    return { key: `interests:${text.toLowerCase().slice(0, 60)}`, topic: `the learner's personal interests: ${text}`, title: `🎯 ${text}` };
  }
  return { key: preset.id, topic: preset.topic, title: preset.label };
}

const examplesCacheKey = (level, key) => `examples_en_${level}_${key}`;

function loadExamples(cacheKey) {
  try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; }
}

function saveExamples(cacheKey, entry) {
  let index = [];
  try { index = JSON.parse(localStorage.getItem(EXAMPLES_INDEX_KEY)) || []; } catch {}
  index = [cacheKey, ...index.filter(k => k !== cacheKey)];
  index.slice(EXAMPLES_MAX_CACHED).forEach(k => localStorage.removeItem(k));
  index = index.slice(0, EXAMPLES_MAX_CACHED);
  try {
    localStorage.setItem(cacheKey, JSON.stringify(entry));
    localStorage.setItem(EXAMPLES_INDEX_KEY, JSON.stringify(index));
  } catch (e) { console.warn('예문 저장 실패', e); }
}

function showExamplesMessage(icon, text) {
  examplesOutput.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">${icon}</span><p>${escapeHtml(text)}</p></div>`;
}

async function showExamples(forceNew) {
  if (examplesBusy) return;
  const t = resolveExampleTopic();
  if (t.error) { showExamplesMessage('✏️', t.error); return; }
  const level = getUserLevel();
  const cacheKey = examplesCacheKey(level, t.key);
  const cached = loadExamples(cacheKey);
  if (cached?.examples?.length && !forceNew) { renderExamples(cached, cacheKey); return; }

  examplesBusy = true;
  examplesSubmit.disabled = true;
  showExamplesMessage('⏳', `${LEVELS[level].label} 레벨 예문을 만들고 있어요...`);
  try {
    const avoid = (cached?.seen || []).slice(-EXAMPLES_AVOID_COUNT);
    const result = await callGemini('examples', { topic: t.topic, level, avoid }, { temperature: 0.9 });
    const examples = (result?.examples || []).filter(ex => ex?.sentence).slice(0, 5);
    if (!examples.length) throw new Error('예문을 받지 못했어요. 다시 시도해 주세요.');
    const entry = {
      at: new Date().toISOString(), title: t.title, level, examples,
      seen: [...(cached?.seen || []), ...examples.map(ex => ex.sentence)].slice(-EXAMPLES_AVOID_COUNT * 2),
    };
    saveExamples(cacheKey, entry);
    renderExamples(entry, cacheKey);
  } catch (e) {
    if (cached?.examples?.length) {
      renderExamples(cached, cacheKey);
      examplesOutput.insertAdjacentHTML('afterbegin', `<div class="pdf-section-msg error">⚠️ 새 예문을 받지 못해 저장된 예문을 보여드려요: ${escapeHtml(e.message)}</div>`);
    } else {
      showExamplesMessage('⚠️', `예문 생성에 실패했습니다: ${e.message}`);
    }
  } finally {
    examplesBusy = false;
    examplesSubmit.disabled = false;
  }
}

function renderExamples(entry, cacheKey) {
  examplesShadowTarget = null;
  const level = LEVELS[entry.level] || LEVELS[DEFAULT_LEVEL];
  const when = new Date(entry.at);
  let html = `
    <div class="ex-head">
      <div>
        <div class="ex-title">${escapeHtml(entry.title)}</div>
        <div class="ex-meta">${escapeHtml(level.label)} 레벨 · ${when.getMonth() + 1}월 ${when.getDate()}일에 받은 예문</div>
      </div>
      <button class="audio-btn ex-refresh">🎲 새 예문 받기</button>
    </div>`;
  entry.examples.forEach((ex, i) => {
    const vocab = (ex.keyVocabulary || []).filter(v => v?.word);
    html += `
      <div class="ex-card fade-in" data-i="${i}">
        <div class="ex-sentence"><span class="ex-num">${i + 1}</span><span class="ex-text">${highlightPassage(ex.sentence, vocab)}</span></div>
        ${ex.ko ? `<div class="ex-ko">${escapeHtml(ex.ko)}</div>` : ''}
        <div class="ex-actions">
          <button class="rp-tool" data-action="speak">🔊 듣기</button>
          <button class="rp-tool" data-action="record">🎤 따라 읽기</button>
        </div>
        ${vocab.map((v, j) => `
          <div class="pdf-vocab-row">
            <span class="pdf-vocab-word">${escapeHtml(v.word)}</span>
            <span class="pdf-vocab-meaning">${escapeHtml(v.meaning || '')}</span>
            <button class="pdf-save-btn${isWordSaved(v.word) ? ' saved' : ''}" data-j="${j}"${isWordSaved(v.word) ? ' disabled' : ''}>${isWordSaved(v.word) ? '✅ 저장됨' : '+ 단어장'}</button>
          </div>`).join('')}
        <div class="ex-shadow-result"></div>
      </div>`;
  });
  examplesOutput.innerHTML = html;
  examplesOutput.querySelectorAll('.ex-text').forEach(n => makeTextClickable(n));
  examplesOutput.querySelector('.ex-refresh').addEventListener('click', () => showExamples(true));

  examplesOutput.querySelectorAll('.ex-card').forEach(card => {
    const ex = entry.examples[card.dataset.i];
    const vocab = (ex.keyVocabulary || []).filter(v => v?.word);
    card.querySelector('[data-action="speak"]').addEventListener('click', () => speak(ex.sentence));
    const micBtn = card.querySelector('[data-action="record"]');
    if (!examplesSpeech.isSupported) micBtn.style.display = 'none';
    micBtn.addEventListener('click', () => {
      if (examplesSpeech.isListening) { examplesSpeech.stop(); return; }
      examplesShadowTarget = { text: ex.sentence, resultEl: card.querySelector('.ex-shadow-result'), btn: micBtn };
      window.speechSynthesis?.cancel();
      examplesSpeech.start();
    });
    card.querySelectorAll('.pdf-save-btn').forEach(btn => btn.addEventListener('click', () => {
      const v = vocab[btn.dataset.j];
      if (saveWord({ word: v.word, meanings: [{ partOfSpeech: '뜻', definitions: [v.meaning || ''] }], customExamples: [{ en: ex.sentence, ko: ex.ko || '' }] })) {
        btn.textContent = '✅ 저장됨'; btn.classList.add('saved'); btn.disabled = true;
        updateVocabStats();
      }
    }));
  });
}

function resetExamplesMic() {
  if (!examplesShadowTarget) return;
  examplesShadowTarget.btn.classList.remove('recording');
  examplesShadowTarget.btn.textContent = '🎤 따라 읽기';
}
examplesSpeech.onStart = () => {
  if (!examplesShadowTarget) return;
  examplesShadowTarget.btn.classList.add('recording');
  examplesShadowTarget.btn.textContent = '⏹️ 다 읽었어요';
  examplesShadowTarget.resultEl.innerHTML = '<div class="pdf-section-msg">🔴 듣고 있어요... 문장을 소리 내어 읽어 주세요</div>';
};
examplesSpeech.onInterim = (text) => {
  if (examplesShadowTarget) examplesShadowTarget.resultEl.innerHTML = `<div class="pdf-section-msg">🎙️ ${escapeHtml(text)}</div>`;
};
examplesSpeech.onEnd = resetExamplesMic;
examplesSpeech.onError = (error) => {
  if (!examplesShadowTarget) return;
  resetExamplesMic();
  examplesShadowTarget.resultEl.innerHTML = `<div class="pdf-section-msg error">${error === 'not-allowed' ? '⚠️ 마이크 권한이 필요합니다.' : '⚠️ 음성이 인식되지 않았어요. 다시 시도해 주세요.'}</div>`;
};
examplesSpeech.onResult = (text) => {
  if (examplesShadowTarget) renderShadowingFeedback(examplesShadowTarget.resultEl, examplesShadowTarget.text, text);
};

// === 자료실 (Phase 3.1) ===
// 저작권 있는 자료는 링크만. PDF 자료는 내려받아 학습지 탭에 올리면 브라우저 안에서만 분석
const resourcesFilter = $('#resources-filter');
const resourcesList = $('#resources-list');
const RESOURCE_LANGS = [
  { id: 'en', label: '🇺🇸 영어' }, { id: 'ja', label: '🇯🇵 일본어' }, { id: 'es', label: '🇪🇸 스페인어' }, { id: 'all', label: '전체' },
];
const RESOURCE_LICENSES = {
  'public-domain': { label: '퍼블릭 도메인', cls: 'free' },
  'cc-by': { label: 'CC BY · 출처 표기', cls: 'cc' },
  'cc-by-sa': { label: 'CC BY-SA · 출처 표기', cls: 'cc' },
  copyright: { label: '저작권 있음 · 링크만', cls: 'link' },
};
let resourcesLang = 'en';
let resourcesData = null;

resourcesFilter.innerHTML = RESOURCE_LANGS.map(l =>
  `<button class="roleplay-chip${l.id === resourcesLang ? ' active' : ''}" data-id="${l.id}">${l.label}</button>`
).join('');
resourcesFilter.addEventListener('click', (e) => {
  const chip = e.target.closest('.roleplay-chip');
  if (!chip) return;
  resourcesLang = chip.dataset.id;
  resourcesFilter.querySelectorAll('.roleplay-chip').forEach(c => c.classList.toggle('active', c === chip));
  renderResources();
});

async function loadResources() {
  if (resourcesData) return;
  resourcesList.innerHTML = '<div class="placeholder-message"><span class="placeholder-icon">⏳</span><p>자료 목록을 불러오는 중...</p></div>';
  try {
    const res = await fetch('data/resources.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    resourcesData = (await res.json()).resources || [];
    renderResources();
  } catch (e) {
    resourcesList.innerHTML = `<div class="placeholder-message"><span class="placeholder-icon">⚠️</span><p>자료 목록을 불러오지 못했어요: ${escapeHtml(e.message)}</p></div>`;
  }
}

function renderResources() {
  if (!resourcesData) return;
  const items = resourcesData.filter(r => resourcesLang === 'all' || r.lang === resourcesLang);
  const flag = { en: '🇺🇸', ja: '🇯🇵', es: '🇪🇸' };
  resourcesList.innerHTML = items.map((r, i) => {
    const lic = RESOURCE_LICENSES[r.license] || RESOURCE_LICENSES.copyright;
    const safeUrl = /^https:\/\//.test(r.url) ? r.url : '#';
    let pdfPart = '';
    if (r.type === 'pdf') {
      pdfPart = r.lang === 'en'
        ? `<button class="audio-btn res-pdf-btn" data-i="${i}">📄 PDF 학습지로 열기</button>`
        : '<span class="res-note">※ 일본어·스페인어 PDF 분석은 다국어 지원(Phase 4) 이후 가능해요</span>';
    }
    return `
      <div class="res-card fade-in">
        <div class="res-top">
          <span class="res-title">${flag[r.lang] || ''} ${escapeHtml(r.title)}</span>
          ${r.level ? `<span class="res-badge level">${escapeHtml(r.level)}</span>` : ''}
          <span class="res-badge ${lic.cls}">${lic.label}</span>
        </div>
        <div class="res-desc">${escapeHtml(r.desc || '')}</div>
        <div class="res-actions">
          <a class="audio-btn res-link" href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">사이트 열기 ↗</a>
          ${pdfPart}
        </div>
      </div>`;
  }).join('') || '<div class="placeholder-message"><span class="placeholder-icon">📭</span><p>이 언어의 자료가 아직 없어요</p></div>';

  resourcesList.querySelectorAll('.res-pdf-btn').forEach(btn => btn.addEventListener('click', () => {
    $('.tab-btn[data-tab="worksheet"]').click();
    setPdfStatus('📥 내려받은 PDF를 위의 [PDF 파일 선택]으로 올려 주세요. 내용은 이 브라우저 안에서만 분석해요.');
    $('#pdf-ws-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

tabBtns.forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.tab === 'resources') loadResources();
}));

applyUserLevelUi();
