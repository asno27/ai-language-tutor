# 🚀 AI Language Tutor - 시스템 총괄 인수인계서 (Comprehensive Handover Document)

본 문서는 프로젝트의 전체 아키텍처, 기능별 상세 로직, 그리고 최근 해결된 핵심 트러블슈팅 내역을 다음 작업자(AI)에게 100% 상세하게 인계하기 위해 작성되었습니다.

---

## 1. 프로젝트 아키텍처 (System Architecture)

- **프론트엔드 (UI/UX)**: HTML, CSS(Glassmorphism), Vanilla JavaScript
  - **호스팅**: GitHub Pages (`https://asno27.github.io/language/`)
  - **설계 철학**: API 키 노출 방지 및 사용자 편의를 위해 프론트엔드에는 어떠한 API 설정 UI(설정 모달창 등)도 존재하지 않습니다. 모든 통신은 하드코딩된 백엔드(Ngrok)를 통해 이루어집니다.
- **백엔드 (API & 우회 서버)**: Python FastAPI + Uvicorn
  - **호스팅**: 사용자의 Local Windows PC (`C:\Users\user\Desktop\영어 공부 어플 제작\server`)
  - **네트워크**: Ngrok 정적 도메인을 사용하여 Localhost(8000)를 외부 인터넷에 노출 (`https://overexert-swiftly-endeared.ngrok-free.dev`)
  - **역할**: YouTube 봇 차단(IP 밴) 회피 및 대용량 오디오 다운로드 처리, AI API(Gemini, Groq) 듀얼 코어 로드밸런싱.

- **🔀 기능별 백엔드 분리 (Phase 1.9, 2026-09-27 코드 작성 / Cloudflare 배포 대기)**:
  - AI 텍스트 기능(`/api/llm`)은 **Cloudflare Worker**(`worker/llm-worker.js`)로 이전 → PC가 꺼져 있어도 동작. 키는 Cloudflare Secret(`GEMINI_API_KEY`, `GROQ_API_KEY`)에 저장.
  - 유튜브(`/api/youtube`)만 PC + ngrok에 남음 (가정용 IP 필요).
  - `js/api.js`: Worker → PC 서버 순서로 시도. `LLM_WORKER_URL`이 비어 있으면 PC 서버만 사용. 배포 후 이 값에 Worker 주소를 넣어야 전환 완료.

---

## 2. 핵심 기능 및 작동 원리

### 2.1. 듀얼 코어 번역/교정 엔드포인트 (`POST /api/llm`)
- **기능**: 사용자의 텍스트(영작, 단어 검색, 일반 번역 등)를 분석하여 JSON 포맷으로 반환.
- **작동 방식 (Fallback 구조)**:
  1. **1순위 (Gemini 3.5 Flash)**: 서버 최상단에 하드코딩된 `MY_GEMINI_KEY`를 사용하여 REST API 호출.
  2. **JSON 정규식 추출**: 대량의 텍스트 번역 시 LLM이 앞뒤로 마크다운(```json)이나 불필요한 인사말을 섞어 출력할 경우를 대비해, `re.search(r'\{.*\}', text, re.DOTALL)` 정규표현식으로 JSON 본체만 수술용 메스처럼 정밀 타겟팅하여 추출.
  3. **2순위 (Groq LLaMA 3.1 70B)**: Gemini가 레이트 리밋(429)이나 파싱 에러(500)를 낼 경우, `except` 블록을 타면서 즉시 `MY_GROQ_KEY`를 사용해 동일한 작업을 재시도. 안정성 100% 보장.

### 2.2. 무적의 YouTube 번역 엔진 (`POST /api/youtube`)
- **기능**: 유튜브 URL을 입력받아 한국어/영어 자막을 추출하거나, 자막이 없으면 오디오를 다운받아 AI로 받아쓰기(STT) 수행 후 프론트엔드에서 번역.
- **작동 방식 (2026 최신 우회 기법 적용)**:
  1. **CC 자막 객체 추출**: `youtube_transcript_api` 패키지(`fetch()` 메서드)를 사용해 자막을 추출. 반환값이 객체(`FetchedTranscriptSnippet`)이므로 반드시 딕셔너리가 아닌 속성(`t.text`, `t.start`, `t.duration`)으로 접근.
  2. **오디오 강제 다운로드 (안드로이드 위장)**: CC가 없을 시 `yt-dlp` 구동. 최신 유튜브 방어막(SABR 실험, 브라우저 쿠키 강제 만료)을 뚫기 위해 **쿠키 파일(`cookies.txt`)을 완전히 폐기하고, 대신 안드로이드 클라이언트로 위장**(`'extractor_args': {'youtube': {'player_client': ['android']}}`)하여 봇 탐지를 완벽히 우회하여 오디오 다운로드 성공.
  3. **STT (Groq Whisper)**: 다운받은 `bestaudio` 파일을 Groq Whisper로 보내 텍스트 추출.
  4. **프론트엔드 방어막 (개별 번역 루프)**: 추출된 대량의 자막 세그먼트들을 프론트엔드(`js/app.js`)에서 번역할 때, 개별 `try/catch` 루프를 적용. 구글 API가 중간에 Rate Limit(429)에 걸려 특정 문장 번역에 실패하더라도, 앱이 멈추지 않고 해당 문장만 '건너뜀' 처리 후 남은 자막 번역을 끝까지 완수함.

---

## 3. 파일 디렉토리 구조 및 역할

- `C:\Users\user\Desktop\영어 공부 어플 제작\`
  - `server/` (백엔드 영역)
    - `main.py`: 모든 우회 로직, API 키, LLM 파싱, YouTube STT 기능이 담긴 핵심 서버 파일.
    - `run_server.bat`: 가상환경(venv)을 로드하고 FastAPI 서버를 포트 8000번에서 여는 실행 스크립트.
  - `js/` (프론트엔드 로직)
    - `api.js`: Ngrok 하드코딩 URL을 관리하며 서버와 통신. (설정창 UI 의존성 완전 제거됨).
    - `app.js`: 유튜브 자막의 개별 `try/catch` 번역 루프, DOM 요소 렌더링, 이벤트 리스너 관리.
    - `prompts.js`: 각 기능(단어장, 교정, 롤플레잉 등)별 프롬프트 JSON 템플릿 관리.
  - `index.html`: 설정 모달창(Settings UI)이 완전히 제거된 깔끔한 탭형 UI.
  - `push_to_github.py`: 로컬에서 수정한 프론트엔드 파일들(`index.html`, `js/*`)을 즉시 GitHub Pages로 강제 푸시(업데이트)하는 자동화 배포 스크립트.

이 문서를 넘겨받는 다음 작업자는, 위 구조와 극복된 트러블슈팅 내역(안드로이드 위장, 정규표현식 파싱, 프론트엔드 생존 루프)을 절대 훼손하지 않은 상태에서 Phase 2(Interactive Features) 기획을 곧바로 이어가면 됩니다.
