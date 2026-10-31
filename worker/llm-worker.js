// worker/llm-worker.js - Cloudflare Worker: AI 텍스트 기능 전용 서버리스 백엔드 (Phase 1.9)
//
// server/main.py 의 /api/llm 로직을 그대로 옮긴 것입니다. PC가 꺼져 있어도 24시간 동작합니다.
// 요청:  POST /api/llm { systemPrompt, userMessage, temperature?, prefer? }
// 응답:  { success: true, data: {...}, source: "groq" | "gemini" | "workers-ai", model, ms, fallbackReason? }
//
// AI 제공자 세 곳을 순서대로 시도해 먼저 성공한 것을 돌려줍니다 (기본 순서: groq → gemini → workers-ai).
//   - 순서 바꾸기: 환경변수 LLM_ORDER (예: "gemini,groq,workers-ai")
//   - prefer: 요청 하나에서만 특정 제공자를 맨 앞으로 (속도 비교·진단용, 알려진 이름만 허용)
//
// 환경변수 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets):
//   GEMINI_API_KEY (Secret), GROQ_API_KEY (Secret)  — Workers AI는 wrangler.jsonc의 "ai" 바인딩이라 키가 필요 없음
//   GEMINI_MODEL, GROQ_MODEL, WORKERS_AI_MODEL, LLM_ORDER (Text, 선택 — 모델이 단종되면 여기서만 바꾸면 됨)

import { handleSync } from './sync.js';
import { checkRateLimit } from './ratelimit.js';

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// 2026-10-31 측정: Groq 1~2초, Gemini 6~18초 → 빠른 쪽을 먼저, 나머지는 한도·장애 대비 예비
const DEFAULT_ORDER = ['groq', 'gemini', 'workers-ai'];
const PROVIDER_TIMEOUT_MS = 30000;
// Groq는 모델이 자주 단종되므로 여러 개를 순서대로 시도 (GROQ_MODEL 환경변수가 있으면 가장 먼저 시도)
const DEFAULT_GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
];

const ALLOWED_ORIGINS = [
  'https://asno27.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const MAX_INPUT_CHARS = 20000;
const DEFAULT_TEMPERATURE = 0.3;

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, ngrok-skip-browser-warning',
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

async function callGemini(env, systemPrompt, userMessage, temperature) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: temperature ?? DEFAULT_TEMPERATURE, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJson(text);
}

async function callGroqModel(env, model, systemPrompt, userMessage, temperature) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      ...(temperature !== undefined && { temperature }),
      // gpt-oss는 추론형이라 기본 설정에선 긴 요청에 수십 초 걸림 → 추론을 짧게
      ...(model.startsWith('openai/gpt-oss') && { reasoning_effort: 'low' }),
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Groq ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content || '');
}

async function callGroq(env, systemPrompt, userMessage, temperature) {
  const models = [...new Set([env.GROQ_MODEL, ...DEFAULT_GROQ_MODELS].filter(Boolean))];
  const errors = [];
  for (const model of models) {
    try {
      return { model, data: await callGroqModel(env, model, systemPrompt, userMessage, temperature) };
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  throw new Error(errors.join(' / '));
}

// Cloudflare Workers AI: 같은 Worker 안에서 바인딩(env.AI)으로 호출 — 키·지역 제한 없음
async function callWorkersAi(env, systemPrompt, userMessage, temperature) {
  const model = env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
  const run = env.AI.run(model, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 3000, // 기본값이 256이라 JSON이 중간에 잘리므로 크게 지정
    ...(temperature !== undefined && { temperature }),
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Workers AI timeout')), PROVIDER_TIMEOUT_MS));
  const result = await Promise.race([run, timeout]);
  const out = result?.response;
  return { model, data: out && typeof out === 'object' ? out : extractJson(String(out || '')) };
}

const PROVIDERS = {
  groq: {
    available: (env) => !!env.GROQ_API_KEY,
    run: (env, s, u, t) => callGroq(env, s, u, t),
  },
  gemini: {
    available: (env) => !!env.GEMINI_API_KEY,
    run: async (env, s, u, t) => ({ model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, data: await callGemini(env, s, u, t) }),
  },
  'workers-ai': {
    available: (env) => !!env.AI,
    run: (env, s, u, t) => callWorkersAi(env, s, u, t),
  },
};

function providerOrder(env, prefer) {
  const configured = (env.LLM_ORDER || '').split(',').map(n => n.trim()).filter(n => PROVIDERS[n]);
  // 빠진 제공자는 뒤에 붙여 예비로 사용
  const all = [...new Set([...(configured.length ? configured : DEFAULT_ORDER), ...DEFAULT_ORDER])];
  return PROVIDERS[prefer] ? [prefer, ...all.filter(n => n !== prefer)] : all;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, request);

    // 사이트 파일(index.html 등)은 Cloudflare가 먼저 처리하고, 없는 경로만 여기로 옴
    const path = new URL(request.url).pathname;
    if (path !== '/api/llm' && path !== '/api/sync') {
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

    // IP별 요청 횟수 제한 (주소가 공개돼 있어 누구나 무료 AI 한도를 쓸 수 있는 것을 막음)
    const limited = await checkRateLimit(env, request, path === '/api/sync' ? 'sync' : 'llm', !!origin);
    if (limited) {
      return json({ success: false, detail: limited.message }, 429, { ...cors, 'Retry-After': String(limited.retryAfter) });
    }

    if (path === '/api/sync') {
      try {
        return await handleSync(request, env, cors, json);
      } catch (e) {
        console.error('Sync failed:', e);
        return json({ success: false, detail: `Sync error: ${e.message || e}` }, 500, cors);
      }
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ success: false, detail: 'Invalid JSON body' }, 400, cors); }

    const { systemPrompt, userMessage } = body || {};
    // 기능별 다양성 조절 (예: 오늘의 영어 추천은 높게). 없으면 기본값
    const temperature = Number.isFinite(body?.temperature) ? Math.min(Math.max(body.temperature, 0), 1.5) : undefined;
    if (typeof systemPrompt !== 'string' || typeof userMessage !== 'string') {
      return json({ success: false, detail: 'systemPrompt and userMessage are required' }, 400, cors);
    }
    if (systemPrompt.length + userMessage.length > MAX_INPUT_CHARS) {
      return json({ success: false, detail: 'Input too long' }, 413, cors);
    }

    const failures = [];
    for (const name of providerOrder(env, body?.prefer)) {
      const provider = PROVIDERS[name];
      if (!provider.available(env)) continue;
      const started = Date.now();
      try {
        const { data, model } = await provider.run(env, systemPrompt, userMessage, temperature);
        // 앞선 제공자가 왜 실패했는지 남겨 둠 (브라우저 네트워크 탭과 Cloudflare 로그에서 확인용)
        if (failures.length) console.warn(`${name} used after failures:`, failures.join(' | '));
        return json({ success: true, data, source: name, model, ms: Date.now() - started, ...(failures.length && { fallbackReason: failures.join(' | ').slice(0, 400) }) }, 200, cors);
      } catch (e) {
        failures.push(`${name}: ${String(e.message || e).slice(0, 160)}`);
      }
    }

    if (failures.length === 0) failures.push('No AI provider configured (GROQ_API_KEY / GEMINI_API_KEY / AI binding)');
    console.error('LLM failed:', failures.join(' | '));
    return json({ success: false, detail: failures.join(' | ') }, 502, cors);
  },
};
