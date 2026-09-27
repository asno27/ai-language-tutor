import { getSystemPrompt, getUserPrompt } from './prompts.js';

// API ?�는 localStorage???�?�됩?�다. (?�스코드??직접 ?�력?�면 보안 ?�험?�로 GitHub?�서 차단?�니??
let currentKeyIndex = 0;

export function getGroqApiKey() { return 'dummy'; }

export function getGeminiApiKey() { return 'dummy'; }

// ?�용?��? 콘솔?�서 ?�게 ?��? 추�?/변경할 ???�도�??�역 ?�수 ?�공
window.updateGeminiKeys = function() {
  const current = localStorage.getItem('gemini_api_key') || '';
  const newKeys = prompt('Gemini API ?��? ?�력?�세??\n(?�러 개는 ?�표�?구분)', current);
  if (newKeys !== null) {
    localStorage.setItem('gemini_api_key', newKeys);
    alert('API ?��? ?�공?�으�??�데?�트?�었?�니??\n?�?�된 ?? ' + newKeys);
  }
};

const DICTIONARY_API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
export function getYoutubeApiUrl() {
  const savedUrl = localStorage.getItem('backend_url');
  if (savedUrl) {
    return savedUrl.replace(/\/$/, '') + '/api/youtube';
  }
  return "https://overexert-swiftly-endeared.ngrok-free.dev/api/youtube";
}

// === AI 텍스트 기능 백엔드 (Phase 1.9: 기능별 분리) ===
// 1순위: Cloudflare Worker (PC가 꺼져 있어도 24시간 동작) — worker/llm-worker.js
// 2순위: PC 서버 (ngrok) — 켜져 있을 때만 예비로 사용
// Worker를 배포한 뒤 아래에 주소를 넣으세요. 비어 있으면 PC 서버만 사용합니다.
const LLM_WORKER_URL = '';

const PC_SERVER_URL = 'https://overexert-swiftly-endeared.ngrok-free.dev';

function getPcServerBase() {
  const savedUrl = localStorage.getItem('backend_url');
  return (savedUrl || PC_SERVER_URL).replace(/\/$/, '');
}

async function postLlm(url, systemPrompt, userMessage) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    // gemini_key/groq_key: PC 서버(main.py)의 요청 형식이 이 필드를 필수로 요구함. 실제 키는 서버 쪽에 있음
    body: JSON.stringify({ systemPrompt, userMessage, gemini_key: getGeminiApiKey(), groq_key: getGroqApiKey() })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.detail || `서버 오류: ${response.status}`);
  }
  return result.data;
}

export async function callGemini(mode, data) {
  const systemPrompt = getSystemPrompt(mode);
  const userMessage = getUserPrompt(mode, data);

  const backends = [];
  if (LLM_WORKER_URL) backends.push({ name: 'Cloudflare Worker', url: LLM_WORKER_URL });
  backends.push({ name: 'PC 서버', url: getPcServerBase() + '/api/llm' });

  for (const backend of backends) {
    try {
      return await postLlm(backend.url, systemPrompt, userMessage);
    } catch (e) {
      console.warn(`${backend.name} /api/llm 실패:`, e);
    }
  }

  throw new Error(LLM_WORKER_URL
    ? 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    : 'AI 서버(PC)에 연결할 수 없습니다. PC에서 run_server.bat을 실행했는지 확인해 주세요.');
}

export async function lookupDictionary(word) {
  try {
    const response = await fetch(`${DICTIONARY_API_URL}/${encodeURIComponent(word.trim())}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const entry = data[0];
    return {
      word: entry.word,
      phonetic: entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '',
      audioUrl: entry.phonetics?.find(p => p.audio && p.audio.length > 0)?.audio || '',
      meanings: entry.meanings?.map(m => ({
        partOfSpeech: m.partOfSpeech,
        definitions: m.definitions?.slice(0, 3).map(d => d.definition) || []
      })) || []
    };
  } catch {
    return null;
  }
}

export async function fetchYoutubeTranscript(url, apiKey) {
  const groqKey = getGroqApiKey();
  const pcOffMsg = '유튜브 기능은 PC 서버가 켜져 있어야 사용할 수 있습니다. PC에서 run_server.bat을 실행해 주세요.';
  let response;
  try {
    response = await fetch(getYoutubeApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ url, api_key: apiKey, groq_key: groqKey })
    });
  } catch (e) {
    throw new Error(pcOffMsg);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    // ngrok은 PC가 꺼져 있으면 JSON이 아닌 오류 페이지를 돌려줌
    if (!error) throw new Error(pcOffMsg);
    throw new Error(error.detail || `서버 오류: ${response.status}`);
  }
  return await response.json();
}




