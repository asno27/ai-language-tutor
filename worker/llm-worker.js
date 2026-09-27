// worker/llm-worker.js - Cloudflare Worker: AI 텍스트 기능 전용 서버리스 백엔드 (Phase 1.9)
//
// server/main.py 의 /api/llm 로직을 그대로 옮긴 것입니다. PC가 꺼져 있어도 24시간 동작합니다.
// 요청:  POST /api/llm { systemPrompt, userMessage }
// 응답:  { success: true, data: {...}, source: "gemini" | "groq" }
//
// 환경변수 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets):
//   GEMINI_API_KEY (Secret), GROQ_API_KEY (Secret)
//   GEMINI_MODEL, GROQ_MODEL (Text, 선택 — 모델이 단종되면 여기서만 바꾸면 됨)

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

const ALLOWED_ORIGINS = [
  'https://asno27.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const MAX_INPUT_CHARS = 20000;

// Worker 자신의 주소(*.workers.dev)에서 뜬 사이트도 허용
function isAllowedOrigin(origin, request) {
  return ALLOWED_ORIGINS.includes(origin) || origin === new URL(request.url).origin;
}

function corsHeaders(origin, request) {
  const allowed = isAllowedOrigin(origin, request) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // 기존 프론트가 붙여 보내는 ngrok 헤더도 허용해 둬야 브라우저가 요청을 막지 않음
    'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

// LLM이 ```json 이나 인사말을 섞어 보내도 { ... } 본체만 잘라냄 (server/main.py 와 동일한 방식)
function extractJson(text) {
  const match = text.trim().match(/\{[\s\S]*\}/);
  return JSON.parse((match ? match[0] : text).trim());
}

async function callGemini(env, systemPrompt, userMessage) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJson(text);
}

async function callGroq(env, systemPrompt, userMessage) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content || '');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, request);

    // 사이트 파일(index.html 등)은 Cloudflare가 먼저 처리하고, 없는 경로만 여기로 옴
    if (new URL(request.url).pathname !== '/api/llm') {
      return json({ success: false, detail: 'Not found' }, 404, cors);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ success: false, detail: 'POST only' }, 405, cors);
    }
    // 브라우저에서 온 요청은 허용된 사이트만 받음 (주소가 노출돼 남이 API 한도를 쓰는 것을 줄이기 위함)
    if (origin && !isAllowedOrigin(origin, request)) {
      return json({ success: false, detail: 'Origin not allowed' }, 403, cors);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ success: false, detail: 'Invalid JSON body' }, 400, cors); }

    const { systemPrompt, userMessage } = body || {};
    if (typeof systemPrompt !== 'string' || typeof userMessage !== 'string') {
      return json({ success: false, detail: 'systemPrompt and userMessage are required' }, 400, cors);
    }
    if (systemPrompt.length + userMessage.length > MAX_INPUT_CHARS) {
      return json({ success: false, detail: 'Input too long' }, 413, cors);
    }

    const errors = [];

    // 1순위: Gemini
    if (env.GEMINI_API_KEY) {
      try {
        return json({ success: true, data: await callGemini(env, systemPrompt, userMessage), source: 'gemini' }, 200, cors);
      } catch (e) {
        errors.push(String(e.message || e));
      }
    }

    // 2순위: Groq
    if (env.GROQ_API_KEY) {
      try {
        return json({ success: true, data: await callGroq(env, systemPrompt, userMessage), source: 'groq' }, 200, cors);
      } catch (e) {
        errors.push(String(e.message || e));
      }
    }

    if (errors.length === 0) errors.push('No API keys configured (GEMINI_API_KEY / GROQ_API_KEY)');
    console.error('LLM failed:', errors.join(' | '));
    return json({ success: false, detail: errors.join(' | ') }, 502, cors);
  },
};
