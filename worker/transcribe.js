// worker/transcribe.js - 음성·영상 파일 받아쓰기 (Y-4)
//
// POST /api/transcribe   multipart/form-data: file (필수), language (선택, 기본 en)
// 응답: { success, data: { text, duration, segments: [{ start, end, text }] }, model, ms }
//
// Groq Whisper(무료)에 파일을 그대로 전달해 시간 정보가 있는 받아쓰기 결과를 돌려줌.
// - 파일은 저장하지 않음 (Worker가 받아서 Groq로 넘기고 끝)
// - Groq 무료 한도: 파일 25MB 이하

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MIN_FILE_BYTES = 1000;
const MODEL = 'whisper-large-v3-turbo';
const TIMEOUT_MS = 120000;
const LANGUAGES = new Set(['en', 'ko', 'ja', 'es']);

export async function handleTranscribe(request, env, cors, json) {
  if (!env.GROQ_API_KEY) return json({ success: false, detail: '받아쓰기 서비스가 아직 설정되지 않았어요.' }, 503, cors);

  // 본문을 읽기 전에 크기부터 확인 (너무 큰 파일은 읽지 않고 거절)
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_FILE_BYTES + 1024 * 1024) {
    return json({ success: false, detail: '파일이 너무 커요. 25MB 이하로 줄여 주세요 (mp3로 변환하면 크게 줄어요).' }, 413, cors);
  }

  let form;
  try { form = await request.formData(); }
  catch { return json({ success: false, detail: '파일을 읽지 못했어요.' }, 400, cors); }

  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return json({ success: false, detail: '파일이 없어요.' }, 400, cors);
  }
  if (file.size > MAX_FILE_BYTES) {
    return json({ success: false, detail: '파일이 너무 커요. 25MB 이하로 줄여 주세요 (mp3로 변환하면 크게 줄어요).' }, 413, cors);
  }
  if (file.size < MIN_FILE_BYTES) {
    return json({ success: false, detail: '파일이 너무 작거나 비어 있어요.' }, 400, cors);
  }

  const language = LANGUAGES.has(String(form.get('language'))) ? String(form.get('language')) : 'en';
  const out = new FormData();
  out.append('file', file, file.name || 'audio');
  out.append('model', MODEL);
  out.append('response_format', 'verbose_json');
  out.append('timestamp_granularities[]', 'segment');
  out.append('language', language);
  out.append('temperature', '0');

  const started = Date.now();
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: out,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error('Transcribe request failed:', e);
    return json({ success: false, detail: '받아쓰기가 너무 오래 걸려 중단했어요. 더 짧은 파일로 시도해 주세요.' }, 504, cors);
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    console.error('Groq transcription error', res.status, text);
    if (res.status === 429) return json({ success: false, detail: '받아쓰기 무료 한도에 도달했어요. 잠시 뒤(길게는 1시간)에 다시 시도해 주세요.' }, 429, cors);
    if (res.status === 400 || res.status === 413) return json({ success: false, detail: '이 파일은 처리할 수 없어요. mp3, m4a, wav, mp4, webm 파일인지 확인해 주세요.' }, 400, cors);
    return json({ success: false, detail: `받아쓰기 서비스 오류 (${res.status})` }, 502, cors);
  }

  const result = await res.json();
  const segments = Array.isArray(result.segments)
    ? result.segments.map(s => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() })).filter(s => s.text)
    : [];
  const text = String(result.text || '').trim();
  if (!text) return json({ success: false, detail: '말소리를 찾지 못했어요. 소리가 있는 파일인지 확인해 주세요.' }, 422, cors);
  return json({ success: true, data: { text, duration: Number(result.duration) || 0, segments }, model: MODEL, ms: Date.now() - started }, 200, cors);
}
