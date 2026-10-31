# 🚀 AI Language Tutor - 시스템 총괄 인수인계서 (Comprehensive Handover Document)

본 문서는 프로젝트의 전체 아키텍처, 기능별 로직, 배포 방법, 트러블슈팅 내역을 다음 작업자(AI 또는 다른 PC의 나)에게 인계하기 위한 문서입니다.
**최종 업데이트: 2026-09-27** — Phase 1.9 / 2 / 2.5 완료 시점 기준.

- 무엇이 완료됐는지 → `docs/Completed_Features.md`
- 앞으로 할 일과 우선순위 → `docs/Future_Implementation_Plan.md` (맨 아래 "권장 작업 순서" 표)

---

## 0. 다른 PC에서 이어서 작업하기 (빠른 시작)

1. 저장소 받기: `git clone https://github.com/asno27/ai-language-tutor.git`
2. Claude에게 이 문서(`docs/Handover_Document.md`)와 `docs/Future_Implementation_Plan.md`를 먼저 읽게 한 뒤 작업을 요청.
3. 수정 후 `git push` → **Cloudflare가 자동으로 배포** (1분 이내). 별도 배포 명령 없음.
4. 로컬 미리보기: 저장소 폴더에서 `python -m http.server 8080` → `http://localhost:8080` (Worker가 localhost:8080 요청을 허용하므로 AI 기능도 실제로 동작).

⚠️ **GitHub에 없는 파일** (비밀 정보 때문에 `.gitignore`로 제외, 원래 PC의 OneDrive 폴더에만 있음):
- `server/` 전체 (유튜브용 PC 서버: `main.py`에 API 키, `run_server.bat`에 ngrok 토큰, `cookies.txt`, `venv/`)
- 루트의 `*.py` 스크립트 (`push_to_github.py`에 GitHub 토큰 포함), `live_*.js` 예전 사본
→ 유튜브 기능 작업은 원래 PC에서만 가능. 그 외 기능은 GitHub 저장소만으로 작업 가능.

---

## 1. 프로젝트 아키텍처

```
[브라우저 / 휴대폰]
   │  https://ai-language-tutor.kaipromp.workers.dev   ← 현재 메인 사이트
   ▼
[Cloudflare Worker "ai-language-tutor"]  (GitHub asno27/ai-language-tutor main 브랜치 push 시 자동 배포)
   ├─ 정적 파일: index.html, css/, js/, data/  (.assetsignore로 docs/, worker/, server/ 등은 제외)
   ├─ POST /api/llm   → Gemini(1순위) → Groq(2순위, 여러 모델 순차 시도)     [worker/llm-worker.js]
   └─ POST /api/sync  → Cloudflare D1 "ai-language-tutor-db" (기기 간 동기화)  [worker/sync.js]

[사용자 PC + ngrok]  https://overexert-swiftly-endeared.ngrok-free.dev   ← PC가 켜져 있을 때만
   ├─ POST /api/youtube  → 유튜브 자막/오디오 추출 (가정용 IP 필요)            [server/main.py]
   └─ POST /api/llm      → Worker 실패 시 예비 경로
```

- **프론트엔드**: HTML, CSS(Glassmorphism, 다크), Vanilla JavaScript ES Modules. 빌드 과정 없음.
- **Cloudflare 설정** (`wrangler.jsonc`):
  - `placement.region = "gcp:us-central1"` — 한국 요청은 기본적으로 홍콩(HKG)에서 처리되는데 Gemini API가 홍콩을 거부("User location is not supported")하므로 미국에서 실행.
  - `d1_databases`: `DB` 바인딩 → `ai-language-tutor-db` (id `fa45e964-ad96-45fe-ab4d-9213e852d619`, 첫 배포 때 자동 생성 후 고정).
  - `keep_vars: true` — 대시보드에서 넣은 변수가 배포 때 지워지지 않게.
- **비밀 정보**: `GEMINI_API_KEY`, `GROQ_API_KEY`는 Cloudflare 대시보드 → Workers 및 Pages → ai-language-tutor → 설정 → **변수 및 비밀**(런타임)에 Secret으로 저장. 코드·저장소에는 없음.
  - 선택 변수: `GEMINI_MODEL`(기본 `gemini-3.5-flash`), `GROQ_MODEL`(없으면 `openai/gpt-oss-120b` → `llama-3.3-70b-versatile` → … 순서로 시도).
- **예전 사이트** `https://asno27.github.io/language/` (저장소 `asno27/language`, `push_to_github.py`로 배포)는 **2026-09-27 이후 업데이트하지 않음**. PC가 꺼지면 AI 기능이 안 되는 옛 버전.

---

## 2. 핵심 기능 및 작동 원리

### 2.1. AI 텍스트 엔드포인트 (`POST /api/llm`, `worker/llm-worker.js`)
- 요청 `{ systemPrompt, userMessage, temperature? }` → 응답 `{ success, data, source }`.
- 프롬프트는 모두 프론트엔드 `js/prompts.js`에서 만듦 (`getSystemPrompt(mode)`, `getUserPrompt(mode, data)`). 새 AI 기능 = 여기에 mode 추가 + `callGemini(mode, data, { temperature })` 호출.
- **LLM 응답은 반드시 최상위 `{ }` 객체 JSON으로 요구할 것.** Worker가 `/\{[\s\S]*\}/`로 본체만 잘라냄 (배열 최상위는 깨짐).
- temperature: 기본 0.3, 오늘의 영어 1.0, 역할극 0.8 (Worker에서 0~1.5로 제한).
- 허용 출처(CORS): Worker 자기 주소, `asno27.github.io`, `localhost/127.0.0.1:5500·8080`. 입력 2만 자 제한.
- 프론트 `js/api.js`의 `callGemini`: Worker(`LLM_WORKER_URL`) → PC 서버 순서로 시도, 둘 다 실패 시 한국어 오류.

### 2.2. 기기 간 동기화 (`POST /api/sync`, `worker/sync.js` + `js/sync.js`)
- 26자리 동기화 코드(Crockford base32)로 사용자 구분. 서버에는 SHA-256 해시만 저장.
- 테이블 `sync_items(sync_hash, kind, id, data, updated_at, deleted, server_ts)` — 첫 요청 때 자동 생성.
- kind: `vocab`(id = 소문자 단어), `daily_set`(id = `날짜|생성시각`), `setting`(`vocab_interests`).
- 규칙: 같은 항목은 `updatedAt`이 더 최근인 쪽이 이김, 삭제는 `deleted=1`로 전파, `server_ts`(마이크로초) 기준 변경분만 전달(5초 겹침, 1000개 단위 페이지).
- 클라이언트: 변경 → `queueChange()` → 2초 뒤 전송. 앱 복귀·재연결 시 자동 동기화. 데이터 종류별 합치기 로직은 `registerSyncKind()`로 등록(`js/app.js` 하단, `js/vocabulary.js`의 `applyRemoteVocab`).
- QR 링크 `#sync=코드`: 열면 주소창에서 즉시 지우고 확인 후 연결.

### 2.3. 무적의 YouTube 번역 엔진 (`POST /api/youtube`, PC 서버)
1. **CC 자막 객체 추출**: `youtube_transcript_api`의 `fetch()`. 반환값은 객체(`FetchedTranscriptSnippet`)이므로 속성(`t.text`, `t.start`, `t.duration`)으로 접근.
2. **오디오 강제 다운로드 (안드로이드 위장)**: CC가 없으면 `yt-dlp`를 `'extractor_args': {'youtube': {'player_client': ['android']}}`로 실행해 봇 탐지 우회.
3. **STT**: Groq Whisper(`whisper-large-v3`).
4. **프론트 개별 번역 루프**: `js/app.js`에서 세그먼트별 `try/catch` + 2초 간격. 일부 실패해도 끝까지 진행.
- PC가 꺼져 있으면 "PC 서버를 켜 주세요" 안내.
- ⚠️ `server/main.py`의 Groq 모델 `llama-3.1-70b-versatile`은 서비스 종료된 모델 — PC 서버의 Groq 예비 경로는 동작하지 않을 가능성 높음.

### 2.4. 탭별 기능 요약 (자세한 내용은 `docs/Completed_Features.md`)
| 탭 | 주요 코드 | 비고 |
|---|---|---|
| 영작 교정 / 번역 / 사전 | `app.js` 상단, prompts `writing`/`translation`/`dictionary` | 모든 결과 단어 클릭 → 미니 사전 |
| 발음 | `app.js` + `js/shadowing.js` | 단어별 채점(API 없음) + [AI 발음 팁] |
| 🎭 역할극 | `app.js` "ROLE-PLAY", prompts `roleplay`, `ROLEPLAY_SCENARIOS` | 교정·점수·대답 예시·음성 입력 |
| 단어장 | `js/vocabulary.js` (SM-2 복습) | 하단에 🔄 동기화 카드 |
| 오늘의 영어 추천 | prompts `daily`, `pickDailyScenes()` | 반복 방지 + 📅 달력 아카이브(`daily_archive`) |
| 인터랙티브 학습지 | `data/worksheet.json` + "PDF WORKSHEET" | 📄 PDF 업로드 → 요약·핵심 단어·빈칸·쉐도잉 (pdf.js 6.3.289, cdnjs) |
| 🧩 주제별 예문 | `app.js` "주제별 예문 (Phase 3.3)", prompts `examples`, `EXAMPLE_TOPICS` | 레벨×주제 캐시 |
| 📚 자료실 | `data/resources.json` + `app.js` "자료실 (Phase 3.1)" | 저작권 자료는 링크만 |
| 유튜브 번역 | PC 서버 필요 | |

### 2.5. localStorage 키 (이 기기에만 저장되는 데이터)
`ai_tutor_vocabulary`(단어장), `daily_sentence`(오늘 캐시), `daily_archive`(달력), `daily_history`(구버전 반복 방지 목록, 읽기만), `vocab_interests`/`vocab_interests_at`, `pdf_ws_index`/`pdf_ws_<해시>`(PDF 분석 캐시), `sync_code`/`sync_since`/`sync_pending`/`sync_last_at`(동기화), `user_level`/`user_level_at`(내 레벨, 동기화됨), `examples_en_<레벨>_<주제>`/`examples_index`(주제별 예문 캐시).

---

## 3. 파일 구조 (GitHub `asno27/ai-language-tutor`)

```
index.html            탭 UI 전체 (캐시 무효화: js/app.js?v=N, css/style.css?v=N — 수정 시 N 올리기)
css/style.css         스타일 (섹션별 주석: Daily Archive, Role-play, PDF Worksheet, Shadowing, Sync)
js/app.js             메인 로직 (모든 탭, 섹션별 "// === 이름 ===" 주석)
js/api.js             Worker/PC 서버 통신, callGemini, getWorkerOrigin
js/prompts.js         AI 프롬프트, ROLEPLAY_SCENARIOS, pickDailyScenes
js/speech.js          음성 인식(STT)·TTS
js/vocabulary.js      단어장 + SM-2 + 동기화 합치기
js/shadowing.js       발음 단어별 비교 (Levenshtein)
js/sync.js            동기화 클라이언트
js/languages.js       다국어 설정 (Phase 4 대비, 아직 어디서도 사용 안 함)
data/worksheet.json   주간 학습지 1~10주차
worker/llm-worker.js  Cloudflare Worker 진입점 (/api/llm, 라우팅, CORS)
worker/sync.js        /api/sync
wrangler.jsonc        Cloudflare 배포 설정
.assetsignore         사이트로 공개하지 않을 파일
docs/                 기획서, 인수인계서, 완료 기능 목록
server/requirements.txt  PC 서버 의존성 (서버 코드는 저장소에 없음)
```

---

## 4. 작업 규칙 & 주의사항
1. **비밀 정보는 절대 커밋하지 말 것.** 공개 저장소임. `server/`, 루트 `*.py`는 `.gitignore`에 있음.
2. 새 AI 기능은 PC 서버가 아니라 Worker(`/api/llm`) 경로를 쓸 것.
3. `index.html`의 `?v=` 숫자를 올려야 사용자 브라우저가 새 JS/CSS를 받음.
4. 로컬에서 `python -m http.server`는 브라우저가 파일을 오래 캐시함 → 테스트 시 강력 새로고침.
5. 배포 확인: Cloudflare 대시보드 → Workers 및 Pages → ai-language-tutor → 배포 탭의 "최근 빌드".

## 5. 알려진 이슈 / 남은 일
- 🔒 **보안**: 예전 공개 저장소 `asno27/language`에 `server/cookies.txt`(유튜브 쿠키)와 `server/run_server.bat`(ngrok 토큰)이 공개되어 있음 → 구글 "모든 기기 로그아웃", ngrok 토큰 재발급, 파일 삭제 필요. `push_to_github.py`의 GitHub 토큰도 폐기 권장.
- `push_to_github.py`의 `LOCAL_DIR`이 `C:\Users\user\...`로 되어 있어 현재 PC에서 동작 안 함 (예전 사이트 배포용이라 현재는 사용하지 않음).
- 발음 채점: 동음이의어(weather/whether)를 틀림으로 표시하는 한계.
- Phase 3.1~3.3 완료(2026-09-29). 다음 우선순위: Phase 4 다국어(사용자가 보류 중) 또는 3.4 퍼블릭 도메인 코퍼스.
- 레벨 규칙은 `js/prompts.js`의 `LEVELS`/`getLevelRule()`. 새 AI 생성 기능에는 `level: getUserLevel()`을 넘겨 프롬프트에 붙일 것.
- 유튜브 탭에서 ngrok 로그에 `502 Bad Gateway`가 찍히면 ngrok은 켜져 있지만 PC의 Python 서버(localhost:8000)가 꺼진 것 → `run_server.bat` 재실행.
