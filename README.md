# 🎓 AI Language Tutor

한국어 사용자를 위한 **AI 영어 학습 웹앱**입니다. 기초부터 단계별로 따라가고, 원어민처럼 대화를 연습하고, 내가 자주 틀리는 표현을 AI가 모아서 보여 줍니다. 별도 앱 설치 없이 브라우저에서 동작하며, 무료 AI 서비스(Groq · Gemini · Cloudflare Workers AI)를 사용합니다.

**사이트**: https://ai-language-tutor.kaipromp.workers.dev/

## ✨ AI로 영어를 배우는 7가지 방법, 이 앱에서는

| | 방법 | 이 앱의 기능 |
|---|---|---|
| ① | 기초부터 단계별 학습 | 🧭 **학습 코스** — 기초 10 · 중급 8 · 고급 6단원. [시작]을 누르면 해당 기능으로 이동하고 활동을 하면 자동 완료 |
| ② | 실용 어휘 확장 | 📚 **단어장**(간격 반복 복습) · 📅 **오늘의 영어** · 🧩 **주제별 예문** |
| ③ | 쉬운 문법 설명 | 📐 **문법 설명** — 레벨별 설명·예문·자주 하는 실수·확인 문제(정답은 AI가 한 번 더 풀어 검수) |
| ④ | 원어민과 대화하듯 연습 | 🎭 **역할극** — 상황을 고르면 AI가 상대역, 말할 때마다 더 자연스러운 표현 안내 |
| ⑤ | 여행·직장·면접 상황 훈련 | 역할극 상황 7개 + 직접 입력, 주제별 예문 |
| ⑥ | 교정과 반복 실수 분석 | ✍️ **영작 교정** → 📉 **내 실수** (자주 틀리는 유형 분석, 유형별 연습) |
| ⑦ | 매일 꾸준히 | 🔥 연속 학습일 · 하루 목표 · 📅 달력 |

그 밖에: 🌐 번역, 📖 사전(단어를 누르면 뜻), 🎙️ 발음 연습(단어별 채점), 📖 인터랙티브 학습지(받아쓰기·쉐도잉), 🎬 유튜브 자막 번역, 📎 PDF 학습지 만들기, 📚 무료 학습 자료 모음, 🔄 **기기 간 동기화**(PC ↔ 휴대폰).

## ⚠️ 알아 둘 점

- AI가 만든 설명·예문·퀴즈는 **가끔 틀릴 수 있어요.** 퀴즈는 자동 검수를 거치지만 완벽하지 않습니다.
- 발음 채점은 브라우저의 음성 인식(Chrome · Edge 권장)을 쓰므로 소리가 같은 단어(weather/whether 등)는 맞게 읽은 것으로 처리하며, 억양·세부 발음까지 평가하지는 않습니다.
- 유튜브 **링크로** 자막을 가져오는 기능만 개발자 PC의 서버가 필요합니다. 자막을 **붙여넣는** 방식은 서버 없이 동작합니다.
- 학습 기록은 이 기기의 브라우저에 저장됩니다. 동기화를 켜면 서버(Cloudflare)에는 동기화 코드 원문 없이 **코드의 해시**와 학습 데이터만 저장해 기기 간에 합칩니다.

## 🛠️ 구조

```
브라우저 (정적 파일: index.html, css/, js/, data/)
   │  /api/llm   AI 호출 ──► Cloudflare Worker ──► Groq → Gemini → Workers AI (순서대로 시도)
   │  /api/sync  동기화  ──► Cloudflare Worker ──► D1 (SQLite)
   └─ (유튜브 링크 모드만) 개발자 PC 서버
```

- 프론트엔드: HTML / CSS / Vanilla JavaScript (ES Modules), 빌드 단계 없음
- 백엔드: Cloudflare Workers (`worker/`), D1(동기화·사용 한도), Workers AI
- 음성: 브라우저 Web Speech API (TTS · STT)
- 사전: [Free Dictionary API](https://dictionaryapi.dev/)

## 🚀 개발

로컬에서 화면만 볼 때:

```
python -m http.server 8080
```

브라우저에서 `http://localhost:8080` — AI 기능은 배포된 Worker를 호출합니다(허용된 출처: localhost:8080 · 5500).

배포: GitHub `main`에 push하면 Cloudflare가 자동 배포합니다. API 키는 Cloudflare 대시보드의 환경변수/시크릿에만 있고 저장소에는 없습니다.

자세한 구조·주의사항은 [`docs/Handover_Document.md`](docs/Handover_Document.md), 앞으로의 계획은 [`docs/Future_Implementation_Plan.md`](docs/Future_Implementation_Plan.md), 완성된 기능은 [`docs/Completed_Features.md`](docs/Completed_Features.md)에 있습니다.

## 📁 폴더

```
index.html        메인 화면
css/style.css     스타일
js/               앱 로직 (app.js 메인, prompts.js AI 지시문, sync.js 동기화, course.js 코스 …)
data/             학습지 · 코스 · 자료실 JSON
worker/           Cloudflare Worker (AI 중계, 동기화, 사용 한도)
docs/             기획서 · 작업 기록 · 인수인계서
```

## 📜 라이선스

MIT License
