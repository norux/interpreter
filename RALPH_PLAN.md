# Interpreter sample — Ralph implementation plan

작성일: 2026-10-05. 저장소: `/Users/norux/git/interpreter`.

## 목표와 첫 버전 범위

macOS에서 Chrome으로 재생하는 음성을 거의 실시간으로 한국어로 번역하고,
현재 페이지 하단에 영상 자막처럼 보여주는 Manifest V3 확장 프로그램을 만든다.
사용자는 로컬 모델, OpenAI 실시간 번역 API, Luna, Anthropic 번역 경로를 선택할 수 있다.
모델 제공자와 출력은 교체 가능한 작은 인터페이스로 분리한다.

첫 버전 입력은 **사용자가 시작한 Chrome 탭 하나의 오디오**다. 사용자의
“일단 크롬 플러그인” 요청을 기준으로 정한 범위이며 macOS 전체 소리 캡처로
표현하지 않는다. Safari, Zoom, VLC 등 다른 앱의 소리는 이번 범위 밖이다.
전체 시스템 소리로 확대하려면 네이티브 캡처 앱이 필요하므로, 입력 인터페이스만
교체할 수 있게 유지하고 네이티브 앱은 만들지 않는다.

설치 방식은 개발자 모드의 unpacked extension과 로컬 companion server다.
웹스토어 게시, 호스팅, 로그인, 결제 UI, 사용자 오디오/전사문 저장은 만들지 않는다.
기본 번역 방향은 영어 → 한국어. 입력 언어와 출력 언어를 설정에서 변경 가능하게 한다.
첫 실제 출력은 자막만 구현한다. 음성 재생, 파일 내보내기 등은 출력 계약의 확장점으로
남기며 이번에 구현하지 않는다. 테스트용 메모리 sink로 출력 분리와 fan-out을 검증한다.

## 실행 방법과 루프 규칙

사용자가 다음 명령을 실행한다. 이 플랜 작성 단계에서는 루프를 시작하지 않는다.

```sh
cd /Users/norux/git/interpreter
node scripts/ralph-loop.mjs 30
```

`30`은 최대 iteration 횟수다. runner는 설정된 Codex 모델을 사용하며, 새로운
`codex exec` 호출마다 이 파일의 진척을 읽는다. CLI 실행은 `--sandbox danger-full-access`
및 `--ask-for-approval never`를 사용한다. 이 권한은 저장소 구현, 일반 의존성/모델 캐시,
로컬 검증에만 사용한다. 모델/CLI 접근권한을 우회하지 않는다.

각 iteration에서 다음 미완료 항목을 구현하고 해당 acceptance check를 실행한다.
필요하면 큰 항목을 여러 iteration으로 나눌 수 있다. 실제 통과한 항목만 체크하고,
진척과 실패/미검증 이유를 이 파일에 적고 Conventional Commit으로 커밋한다.
runner와 완료 기준을 수정하거나 테스트를 무력화해 완료시키지 않는다.
다른 에이전트, 별도 작업 트리, 배포, push는 사용하지 않는다.

모든 필수 항목을 끝내고 `npm run verify`가 통과하며 worktree가 깨끗할 때만
최종 응답 마지막 줄에 `<promise>INTERPRETER_COMPLETE</promise>`를 출력한다.
runner가 체크리스트, 검증 보고서, `npm run verify`, Git 상태를 재확인한 뒤
**이 파일만 삭제하고 `chore: remove completed Ralph plan`으로 커밋**한다.
작업 에이전트가 이 파일을 직접 삭제하지 않는다. 실패, interrupt, iteration 한도
초과는 완료가 아니며 플랜을 보존한다. `.ralph/` 로그를 읽고 같은 명령으로 이어간다.
완료 뒤에도 runner, README, 설정 예제, 검증 기록은 남긴다.
사용자 입력이나 외부 상태 변경 없이 진행할 수 없는 필수 작업은 blocker를 기록하고
진척을 커밋한 뒤 `<promise>INTERPRETER_BLOCKED</promise>`를 마지막 줄에 출력한다.
runner는 즉시 종료하고 플랜을 보존한다. 불가능한 작업을 같은 상태로 계속 반복하지 않는다.

## 구현 구조

단순한 TypeScript + Vite 확장과 Python 3.12 + FastAPI companion을 사용한다.
현재 시스템 Python은 3.9이므로 uv로 프로젝트 전용 3.12 환경을 만든다.
확장 코드에 React가 필요한 규모가 아니므로 vanilla DOM/CSS로 시작한다.

```text
extension/                  MV3 service worker, popup, offscreen, worklet, content script
server/                     FastAPI session transport and feature-local model adapters
tests/                      transport/queue/provider integration tests and browser fixtures
docs/verification.md        실제 실행한 검증, 시각 증거, 성능 측정, 미검증 경로
package.json                dev, build, lint, typecheck, test, verify entry points
pyproject.toml + uv.lock     companion dependencies and local-model optional dependency group
README.md + .env.example    설치, 모델 준비, 실행, 확장 로드, 비용과 캡처 범위
```

빌드 결과는 `extension/dist/`로 고정한다. JS/Python lockfile을 커밋한다.
모델 가중치와 `.venv`, 빌드 산출물, `.ralph`, 실제 키는 커밋하지 않는다.
음성 인식 라이브러리는 lazy-load해서 cloud-only 경로가 MLX 설치를 강제하지 않게 한다.

### 입력, 모델, 출력 계약

요청된 교체 가능성에 필요한 인터페이스만 만든다. 플러그인 프레임워크, DI 컨테이너,
임의 provider URL 프록시, 자동 모델 라우팅은 추가하지 않는다.

- `AudioSource`: start/stop과 timestamp/sequence/sampleRate를 가진 mono PCM 프레임.
  첫 구현은 Chrome tab capture. 테스트 구현은 고정된 테스트 음성.
- `Transcriber`: audio → 같은 utterance ID의 partial/final 원문 이벤트, close/cancel.
- `TextTranslator`: 완료된 짧은 원문 + 제한된 최근 문맥 → 번역 이벤트, cancel.
- `TranslationSession`: 음성 인식 + 텍스트 번역 조합과 직접 음성 번역을 모두
  동일한 caption/status/error 이벤트 스트림으로 감싼다. 직접 번역 경로에 가짜
  Transcriber를 끼워 넣거나, 모든 모델에 동일한 API 형식을 강요하지 않는다.
- `OutputSink`: caption/status/clear를 받아 표시하고 dispose한다.
  하나의 이벤트를 등록한 sink 목록에 전달한다. 첫 제품 sink는 DOM 자막,
  두 번째는 테스트 메모리 sink. 모델 코드가 DOM이나 Chrome 메시지를 직접 다루지 않는다.

caption은 session ID, utterance ID, revision, 원문/번역문, partial/final 상태,
오디오 구간과 이벤트 시각을 포함한다. 같은 구절의 수정은 기존 cue를 교체한다.
종료되거나 교체된 session의 늦은 결과는 버린다. 모델 원시 응답과 재연결 상태를
자막 문자열에 섞지 않는다. UI의 모든 텍스트는 textContent로 렌더한다.

### 모델 경로: 실제 구현해야 하는 것

| 경로 | 음성 처리 | 번역 | 요구사항 |
| --- | --- | --- | --- |
| 기본 local | MLX Qwen3-ASR 0.6B 8bit | Ollama Qwen3-4B-Instruct 4bit | API 키 없이 실제 실행 |
| OpenAI direct | `gpt-realtime-translate` | 전용 실시간 번역 세션 | 번역 transcript delta를 자막으로 정규화 |
| OpenAI Luna | local ASR 또는 OpenAI live transcription | Responses API `gpt-6-luna` | 오디오는 Luna에 보내지 않음 |
| Anthropic | local ASR 또는 OpenAI live transcription | Anthropic Messages API의 설정된 model ID | 오디오는 Messages API에 보내지 않음 |

로컬 ASR 기본 ID는 `mlx-community/Qwen3-ASR-0.6B-8bit`, 로컬 텍스트 기본 ID는
Ollama `qwen3:4b-instruct`. 동일 adapter에 다른 호환 model ID를 지정할 수 있게 한다.
추가 로컬 모델을 위해 인터페이스를 만들되 모든 Hugging Face 모델이 동작한다고
표시하지 않는다. ASR와 텍스트 모델의 호환 범위는 각각 문서화한다.
TranslateGemma는 특수 chat template이 필요할 수 있어, generic Ollama adapter로
자동 지원된다고 주장하지 않는다. 별도 실제 검증을 하지 않았다면 후보로만 남긴다.

Luna model ID는 실제 모델 카드를 다시 확인한다. Responses에서는 번역 지침과
짧은 입력, 낮은 지연의 지원된 reasoning 설정을 사용한다. Anthropic은 사용 가능한
model ID를 설정으로 받으며 오래된 ID를 최신이라고 단정하지 않는다.
API 제공자 오류, 권한 부족, 모델 미설치, Ollama 중단은 명확한 상태로 돌려준다.
선택하지 않은 cloud 모델을 자동으로 호출하거나 유료 경로로 fallback하지 않는다.

OpenAI direct는 `/v1/realtime/translations` 전용 WebSocket을 companion에서 연결하고
24kHz PCM16 원음을 연속 전송한다. 번역 API에는 일반 voice-agent의 `response.create`
또는 VAD turn protocol을 적용하지 않는다. 원문 transcript는 필요하면 공식 지원
설정을 사용한다. 첫 출력은 번역 자막이며 수신한 번역 음성은 재생하지 않는다.
API 종료 시 공식 session close lifecycle을 따른다.

OpenAI ASR는 공식 live transcription 세션을 구현한다. 현재 문서의
`gpt-live-transcribe`는 client-side VAD/commit 경계를 사용하므로 server VAD 지원을
추측하지 않는다. 로컬 MLX 예제의 `stream=True`는 파일 입력에 대한 토큰 스트리밍일
수 있으므로 곧바로 live PCM ingestion이라고 간주하지 않는다. 실제 사용 버전을
조사하고 짧은 오디오 구절 + VAD 경계/길이 제한 방식부터 구현한다.

## 캡처와 실행 수명

Chrome 116 이상, Manifest V3, `tabCapture` + `offscreen` + `activeTab` + `scripting`
및 필요한 localhost 연결 권한을 사용한다. 사용자의 확장 버튼 클릭/Start 동작으로만
캡처를 시작한다. popup은 설정과 Start/Stop만 맡고 닫혀도 녹음이 유지된다.
service worker는 stream ID를 얻고 offscreen document가 MediaStream, AudioContext,
AudioWorklet, companion 연결을 소유한다. 사용자 입력이 없는 자동 녹음은 하지 않는다.

tabCapture는 원음 재생을 끊으므로 캡처한 원음을 AudioContext destination에 연결해
유튜브 소리를 계속 들을 수 있게 한다. 출력 소리는 다시 ASR 입력에 합치지 않는다.
AudioWorklet에서 실제 AudioContext sample rate를 기준으로 mono/PCM16 변환하고
필요한 backend sample rate로 리샘플링한다. WAV/WebM 파일 조각을 raw PCM으로
잘못 전송하지 않는다. 채널, 정렬, 길이, sequence를 검증한다.

처음에는 세션 하나와 ASR 추론 하나만 동시에 유지한다. MLX 추론으로 async 서버를
막지 않도록 전용 worker/thread를 사용하되 모델 동시 호출은 직렬화한다.
VAD의 silence 경계와 최대 구절 길이를 사용하고 silence를 발화로 전사하지 않는다.
ASR/번역 큐는 크기와 오디오 시간으로 제한한다. 느려지면 오래된 대기 데이터를
명시적으로 버리고 지연 상태를 전달하며 무한 backlog를 만들지 않는다.
급격한 partial 변화마다 유료 번역 요청을 발사하지 않는다. 완료된 짧은 구절을
순서대로 처리하면서 확정 전 원문과 번역 cue 갱신을 분리한다.

Stop, 탭 닫기, 페이지 이동, 재시작, provider 변경, WebSocket 오류마다 tracks,
AudioContext, worklet, 연결, pending tasks를 정리한다. 탭 이동/SPA navigation 뒤에는
단일 overlay를 다시 붙이며 이전 세션 cue를 표시하지 않는다. 시스템/권한 제한으로
지원되지 않는 탭은 이유를 표시하고 연결을 정리한다.

API 키는 companion의 환경 변수에만 둔다. 확장 저장소, 페이지 DOM, 번들, 로그로
전달하지 않는다. companion은 loopback에만 bind하고 extension origin + 세션 token을
확인한다. Chrome의 실제 localhost 접근 제한도 테스트한다. 연결 host는 로컬로
제한하고 페이지에서 provider/base URL을 임의로 지정하는 프록시는 만들지 않는다.
소스 언어, 목적 언어, 지원 model ID와 provider 선택만 설정 UI에 둔다.

## 자막 디자인: 핵심 acceptance

읽기 쉬운 **자막**으로 만든다. 큰 채팅 패널이나 transcript 목록을 하단에 놓지 않는다.

- 화면 하단 중앙, 좌우 안전 여백, 최대 너비 약 80vw/960px.
- 기본은 한국어 번역 한 cue, 최대 두 줄. 긴 문장은 cue 분할/갱신으로 표시하며
  중요한 텍스트가 영구적으로 잘리지 않게 한다.
- 흰색 글자, 충분한 검정 outline/text shadow, 작은 반투명 검정 배경, 편안한 행간.
  반응형 글자 크기 약 18–32px와 영상 컨트롤 위 하단 여백.
- 자막 표면은 `pointer-events: none`. 사이트 버튼/스크러버 클릭을 방해하지 않는다.
- Shadow DOM으로 사이트 CSS와 분리. 임의 HTML 출력은 금지한다.
- 일반 페이지에서는 하단 고정. fullscreenchange 때 fullscreen element 안으로
  overlay host를 옮겨 브라우저 top layer 아래로 사라지지 않게 한다.
  YouTube의 wrapper fullscreen과 theatre mode를 실제 확인한다.
- 오래된 cue는 만료시키고 Stop 즉시 제거. 같은 partial cue를 append해서
  줄이 계속 늘어나거나 깜빡이는 현상을 방지한다.
- 설정/연결 상태는 popup이나 작은 별도 상태 표시에서 보여준다.
  provider 이름, 내부 error stack, 실험용 로그를 자막 문장에 넣지 않는다.

## 구현 체크리스트

- [x] 1. 프로젝트와 검증 명령 준비
  - TypeScript/Vite 확장, Python/uv companion, lockfile, .env.example, README를 만든다.
  - `npm run verify`는 lint/typecheck, JS/Python 테스트, 확장 build를 실제 실행한다.
  - Acceptance: extension/dist/manifest.json이 유효한 MV3이고 offscreen/worklet/content
    파일을 빌드에 포함한다. Python 3.12 환경과 서버 health endpoint를 실행한다.

- [x] 2. 이벤트 계약과 캡처 구현
  - feature-local 입력/모델/출력 계약, offscreen 캡처, PCM 변환, 메시징을 연결한다.
  - Acceptance: 실제 테스트 페이지 오디오가 companion에 PCM으로 도착하고 원음
    재생도 유지된다. popup 닫기, Start/Stop 반복, tab close, 잘못된 PCM을 검증한다.

- [x] 3. 자막 overlay 먼저 구현
  - 테스트 caption을 sink로 보내 디자인과 cue update/clear/fullscreen 동작을 만든다.
  - Acceptance: 일반 화면, 좁은 viewport, YouTube theatre/fullscreen에서 하단 두 줄
    자막이 읽히고 컨트롤을 누를 수 있다. screenshot을 시각적으로 검토한다.
    테스트 caption 검증을 실제 음성 번역 성공으로 기록하지 않는다.

- [x] 4. 실제 local audio-to-caption 경로 구현
  - MLX Qwen3-ASR 0.6B + Ollama Qwen3-4B-Instruct, VAD/구절/문맥/큐 제한을 연결한다.
  - Acceptance: 공개된 또는 직접 생성한 비민감 영어 음성을 Chrome 페이지에서
    재생해 실제 캡처 → 실제 두 모델 → 한국어 자막을 확인한다. 미리 만든 번역이나
    YouTube 기존 자막을 읽는 구현으로 대체하지 않는다. 로컬 상태에서는 외부
    inference API 요청이 없고 모델 미설치 안내가 이해 가능해야 한다.

- [ ] 5. OpenAI direct 실시간 번역 경로 구현
  - 키는 server-side에서 사용하고 전용 endpoint/events/close를 처리한다.
  - Acceptance: protocol fixture 테스트로 한국어 출력 설정, 연속 PCM 전송,
    transcript delta의 cue 수정, session close/error를 확인한다. 키가 있을 때만
    명시적으로 선택한 live smoke를 실행한다. 모델 미접근 시 mock 성공으로 숨기지 않는다.

- [ ] 6. Luna/Anthropic와 ASR 선택 구현
  - TextTranslator에 OpenAI Responses Luna, Anthropic Messages, local Ollama를 연결한다.
  - ASR는 local 또는 OpenAI live transcription을 선택할 수 있게 한다.
  - Acceptance: provider contract/integration 테스트에서 ASR 결과가 각 번역 API에
    전달되고 동일 cue를 만든다. Luna/Anthropic에는 audio를 전송하지 않는다.
    model ID 선택, 취소, rate limit/권한 오류, partial/final 구분을 검증한다.

- [ ] 7. 설정 UI와 session/출력 교체 검증
  - popup에 입력/목표 언어, local/direct/text provider와 호환 model ID, Start/Stop을 둔다.
  - OutputSink 분리와 test memory sink fan-out을 검증한다. 추가 제품 출력은 만들지 않는다.
  - Acceptance: provider 변경 시 이전 세션을 중단하고 새 세션만 표시한다. 중복 overlay,
    자막 HTML injection, 오래된 응답의 자막 덮어쓰기가 없다. 페이지에 키가 노출되지 않는다.

- [ ] 8. 실제 브라우저 동작과 장시간 처리 검증
  - Chrome/Chromium의 전용 테스트 profile에서 unpacked extension을 로드한다.
    tabCapture는 실제 사용자 Start 동작으로 시험한다. 마이크/가짜 stream만으로
    실제 tab capture를 검증했다고 주장하지 않는다.
  - Acceptance: 실제 YouTube 재생에서 의미가 맞는 한국어 자막을 확인하고,
    일반/theatre/fullscreen screenshot을 검토한다. 최소 10분 재생에서 큐가 무한히
    증가하지 않고 Start/Stop, 탭 이동, companion 중단 후 복구를 확인한다.
  - 오디오 구절 끝 → 자막 표시의 p50/p95, 버린 프레임/구절 수, 모델/전체 메모리,
    칩과 실행 설정을 기록한다. 5초 이내를 개선 목표로 삼되 실측 전 보장하지 않는다.
    목표 미달은 수치와 원인을 공개하고 backlog를 쌓아 감추지 않는다.

- [ ] 9. 문서, 최종 검증, 구현 커밋 완료
  - README에 모델 다운로드/서버 실행/확장 로드/설정/언어 변경/검증/문제 해결을
    복사 가능한 커맨드로 적는다. local과 paid API 경로, 구독과 API의 별도 과금,
    선택 탭 캡처 범위를 명확히 설명한다.
  - docs/verification.md에 실제 명령, 결과, browser 버전, 실제 local end-to-end 증거,
    시각 검토, 성능, live cloud 여부와 한계를 기록한다. 모델/키/오디오 원문은 남기지 않는다.
  - Acceptance: `npm run verify`와 `git diff --check` 통과, 모든 구현 커밋 완료,
    worktree clean. 마지막 completion line 이후 삭제와 cleanup commit은 runner가 한다.

## 검증과 완료 기준

핵심 테스트는 실제 회귀를 잡는 데 집중한다: PCM 리샘플링과 정렬, cue 순서/수정,
정지 후 늦은 결과, queue backpressure, provider 취소/오류, 실제 DOM fullscreen 위치,
설정 변경과 session 수명. 함수 구조를 그대로 따라가는 의미 없는 테스트는 쓰지 않는다.
기본 CI/verify는 키 없이도 재현 가능하며 cloud protocol은 fixture로 검증한다.

완료 필수: **실제 local 모델 + 실제 Chrome 탭 오디오 + 한국어 자막**, 실제 YouTube
동작/자막 시각 검토, 수명/큐 검증, 네 가지 경로의 실제 adapter 코드와 contract tests.
키가 없어 live cloud 호출을 못 했어도 adapter/protocol 검증을 통과했다면 해당 경로는
“구현/fixture 검증 완료, live 미검증”이라고 정확히 기록한다. live cloud 성공으로
표시하지 않는다. API 키를 찾아 다른 앱/사용자의 credential 파일을 읽지 않는다.

로컬 모델 실행 또는 실제 Chrome/YouTube 검증을 할 수 없다면 필수 완료가 아니다.
막힌 항목을 체크하지 말고 정확한 blocker와 필요한 사용자 동작을 진척에 적는다.
runner를 속이는 completion line은 출력하지 않는다. 루프는 한도 도달 시 플랜을
보존하므로, 사람의 브라우저 권한/설정 확인 후 다시 실행할 수 있다.

## 확인한 공식 자료

- Chrome tabCapture: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- MV3 capture/offscreen: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- OpenAI direct translation: https://developers.openai.com/api/docs/guides/realtime-translation
- OpenAI Luna: https://developers.openai.com/api/docs/models/gpt-6-luna
- OpenAI transcription: https://developers.openai.com/api/docs/guides/realtime-transcription
- Anthropic Messages: https://platform.claude.com/docs/en/api/messages/create
- Qwen3-ASR: https://huggingface.co/Qwen/Qwen3-ASR-0.6B
- MLX ASR implementation: https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/stt/models/qwen3_asr/README.md
- Ollama local text model: https://ollama.com/library/qwen3:4b-instruct

구현 시작 시 SDK/실행 환경의 현재 호환성을 다시 확인하고 필요한 버전을 lock한다.
모델 라이선스/실측속도와 model file size를 runtime RAM과 혼동하지 않는다.

## 진척과 근거

초기 상태에서는 계획과 runner만 준비되어 있었다.
각 iteration에서 완료 항목, 실행한 명령과 결과, 다음 단계 또는 blocker를 아래에 남긴다.

### Iteration 1/30 — 2026-10-05 — 항목 1 완료

- 실제 작업 checkout: `/Users/norux/orca/workspaces/interpreter/aspidochelone`.
  checkout에 AGENTS.md는 없으며 사용자 제공 지침을 적용했다.
- vanilla TypeScript/Vite MV3 scaffold, Python/FastAPI companion `/health`,
  JS/Python lockfile, `.env.example`, README 설치/실행 명령을 추가했다.
  입력/모델/출력 추상화는 아직 만들지 않았다. 다음 항목에서 feature-local로 구현한다.
- `npm run verify`는 JS/Python lint, TypeScript, production build, JS build test,
  Python health test를 실제 실행한다. 기본 검증에는 키/모델이 필요 없다.
- uv가 PATH에 없어 `.tools/uv` 안에 uv 0.12.23을 설치했다(ignored).
  uv가 CPython 3.12.15를 내려받아 `.venv`를 생성했다. 다음 iteration 명령:
  `export PATH="$PWD/.tools/uv/bin:$PATH"` 후 `uv sync --locked`, `npm run verify`.
- Acceptance 통과: `extension/dist/manifest.json` JSON/MV3 및 참조 파일 확인,
  offscreen HTML + 실제 `offscreen.js` 참조, worklet/content/service worker 파일 존재.
  worklet/content/service worker는 아직 inert scaffold이며 캡처 성공 증거가 아니다.
- 실제 Python 3.12 서버를 `uv run --locked uvicorn server.app:app --host 127.0.0.1
  --port 8765`로 실행하고 curl로 `/health`의 HTTP 200 + `{"status":"ok"}`를 확인했다.
  SIGINT 후 정상 종료했다.
- 최종 `npm ci` 후 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0:
  lint/typecheck/build, JS 1 test, Python 1 test 통과, skipped 0, warning 0.
  `uv lock --check`, `git diff --check` 통과. build/.venv/.tools/.ralph는 ignored.
- 실패와 수정: CSS import 타입 선언 추가, offscreen script 누락에 대해 먼저
  ENOENT 회귀 실패를 확인하고 scaffold entry 수정, generated dist를 source lint에서
  제외하도록 Git ignore 연동, Starlette 권장 httpx2로 테스트 의존성 수정.
  acceptance와 source lint 규칙은 약화하지 않았다.
- 상세 명령/환경/실제 결과/한계: `docs/verification.md`.
  브라우저 로드/실제 오디오/모델/자막/YouTube/live cloud 검증은 아직 실행하지 않았다.
  이번 항목의 blocker는 없다.
- 다음 미완료 작업: **항목 2 — 이벤트 계약과 실제 탭 캡처/PCM 전송**.
  실제 Chrome Start 동작, 원음 재생 유지, popup 종료, Start/Stop 반복, tab close,
  잘못된 PCM acceptance가 모두 통과할 때만 항목 2를 체크한다.

### Iteration 2/30 — 2026-10-05 — 항목 2 구현 진척, 실제 캡처 acceptance 차단

- 작업 범위는 이 checkout으로 유지했다. AGENTS.md는 없으며 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이었다.
  항목 2는 **미체크 상태**다. 모델/자막/다음 항목으로 범위를 확대하지 않았다.
- feature-local AudioSource와 PCM wire 계약, Python Transcriber/TextTranslator/
  TranslationSession 계약, caption/OutputSink 계약을 추가했다. adapter와 실제 sink는
  아직 구현하지 않았다. 플랫폼 요구사항인 AudioWorkletProcessor 외에는 framework나
  DI/class 계층을 만들지 않았다.
- service worker → offscreen 캡처 소유권, popup Start/Stop/상태, mono PCM16 변환을
  구현했다. 실제 AudioContext sample rate에서 24 kHz로 상태를 유지하며 리샘플링하고,
  20 ms(480 samples)마다 sequence/timestamp/header와 binary PCM을 전송한다.
  원음 destination 연결, Stop/탭 종료/이동/연결 오류 cleanup, 늦은 startup 취소,
  WebSocket 대기량 1초 제한을 구현했다. 이 코드의 **실제 tabCapture 수명과
  audible playback acceptance는 아직 검증되지 않았다**.
- companion은 환경 변수 `INTERPRETER_EXTENSION_ID`의 정확한 origin과 loopback Host를
  검사하고, 10초 유효한 single-use 메모리 token으로 WebSocket을 인증한다.
  한 capture만 허용하며 잘못된 PCM은 error + close로 거부한다. 서버는 수신 frame/
  sample count와 peak만 돌려주며 오디오/전사문을 저장하지 않는다. 모델은 호출하지 않는다.
- 자동 검증: `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0:
  lint/typecheck/build, JS 6 tests + Python 16 tests, skipped 0, warning 0.
  JS는 stereo downmix/clipping/44.1 kHz 연속성/무음/프레임 경계 및 pending stream/
  worklet 중 Stop cleanup을 검증한다. Python은 origin/host/token/expiry, 반복 연결,
  receipt, 잘못된 PCM rate/channel/version/count/alignment/sequence/timestamp를 검증한다.
- 실제 **worklet/transport만** 검증: Playwright 1.63.0과 공식 Chrome for Testing
  153.0.8010.12를 normal dependency cache에 설치했다. 재현 가능한 명령
  `PATH="$PWD/.tools/uv/bin:$PATH" npm run test:capture-browser` exit 0.
  isolated ignored profile에서 extension 로드, 실제 offscreen runtime messaging,
  실제 loopback health/origin/token/WS를 확인했다. 생성한 44.1 kHz 440 Hz tone →
  실제 AudioWorklet → companion에서 50 frames / 24,000 samples / peak 3275를 확인했다.
  명령 출력도 `tabCapture: "not exercised"`로 구별한다. 이것은 실제 탭 캡처,
  원음 청취, 모델, 한국어 자막 성공 증거가 아니다.
- 실패와 수정: JS non-null lint/TypeScript narrowing 및 Python line length 실패를
  source에서 수정했다. TestClient WebSocket의 기본 `ws://testserver`가 loopback Host
  검사를 통과하지 못해 14 tests가 실패했다. 실제 `ws://127.0.0.1:8765/audio` URL로
  테스트를 수정하고 모두 통과했다. 보안 검사/acceptance/runner는 완화하지 않았다.
- **Blocker (외부 권한 변경 필요)**: macOS Computer Use가 Accessibility 및
  Screen Recording 권한이 아직 없다고 두 번 반환했다. 실제 toolbar를 누를 수 없어
  Chrome의 activeTab grant가 발생하지 않았다. headed 전용 profile에서 공개/사용자
  데이터가 아닌 stereo fixture를 Play한 후, `chrome.action.openPopup({windowId})`로
  실제 action popup을 열고 browser CDP의 trusted mouse input으로 Start를 눌렀으나
  Chrome이 `Extension has not been invoked for the current page (see activeTab
  permission). Chrome pages cannot be captured.`로 거부했다. API popup 오픈만으로
  사용자 toolbar invocation을 대체할 수 없다. host 권한 확대나 가짜 stream으로
  실제 capture acceptance를 우회하지 않았다.
- 필수 미검증: 실제 tab PCM 도착, audible 원음 유지, popup 닫기 후 지속,
  실제 Start/Stop 반복, captured tab close/navigation/disconnect 수명. native toolbar
  접근이 가능해진 뒤 이 체크를 모두 실행하고 근거를 남기기 전에는 항목 2를 체크하지 않는다.
  README의 fixture/companion/extension 설치 명령으로 다시 시작할 수 있다.
- 필요한 사용자 동작: ChatGPT Computer Use가 요청한 macOS Accessibility/Screen
  Recording 권한을 완료하고 Chrome 테스트 창의 실제 toolbar를 조작할 수 있게 한다.
  그 뒤 동일 checkout에서 iteration을 재개한다. 상세 증거와 재개 순서는
  `docs/verification.md`의 Iteration 2에 남겼다. 키/모델/오디오/전사문/임시 .ralph
  state는 커밋하지 않는다. 코드와 blocker는 Conventional Commit으로 보존한다.

### Ralph iteration 1/30 (재개) — 2026-10-05 — 항목 2 수명 수정, 청취 확인 대기

- 이번 runner의 iteration 번호는 사용자 지시의 1/30이며, 위의 이전 기록을 보존하고
  다음 미완료 **항목 2**만 진행했다. AGENTS.md는 없고 `.ralph/verification.txt`는
  `No completion verification attempted in this run.`이다. 항목 2는 미체크 상태다.
- 이전 browser 권한 blocker는 해소됨: `orca computer permissions --json`이
  Accessibility와 screenshots 모두 `granted`를 반환했다. Orca native menu 클릭은
  `window_not_focused`로 실패했고 restore도 popup을 열지 못했다. 사용 가능한
  `cua_repl` native app control로 전용 Chrome의 실제 Extensions toolbar → Interpreter
  → 실제 Start/Stop 버튼을 조작하여 activeTab grant와 진짜 tabCapture를 검증했다.
  초기 grant를 `chrome.action.openPopup()`이나 가짜 stream으로 대체하지 않았다.
- Chrome for Testing 153.0.8010.12 + Playwright 1.63.0, ignored 전용 profile, generated
  440/880 Hz stereo fixture, 실제 loopback companion을 사용했다. 모델/자막/다음 항목은
  구현하거나 성공으로 기록하지 않았다. 사용자 오디오/전사문/키를 읽거나 저장하지 않았다.
- 진짜 탭 PCM 도착: rebuilt extension에서 200 frames / 96,000 samples / peak 2881,
  Chrome capture `active`를 확인했다. popup target을 닫아도 같은 session이
  350 frames / 168,000 samples로 증가했고 다시 열린 popup에는 500 frames가 표시됐다.
  반복 Stop/Start, navigation 뒤 중단/재시작, captured tab close를 검증했다.
- 실제 tab close에서 offscreen의 ended → idle 보고가 worker tab-removal 처리보다
  빨라 document가 남는 race를 발견했다. `tests/service-worker.test.ts`를 먼저 실행해
  `Ended tab must not leave an offscreen document alive` 실패를 확인했다. worker가
  terminal report를 직렬화한 뒤 현재 상태를 다시 확인하고 document를 닫도록 수정했다.
  error 문구 보존과 늦은 terminal report가 새 capture를 닫지 않는 회귀도 검증한다.
  추상화/공개 API를 늘리지 않았다.
- 수정한 build로 실제 tab-close를 재실행: idle, offscreen contexts 0, captured tabs 0.
  companion SIGINT 후 error/contexts 0/capture stopped; companion 재시작 + 실제 Start
  후 새 session 700 frames / 336,000 samples / peak 2881, popup 1300 frames를 확인했다.
  최종 Stop 후 contexts 0/capture stopped, 테스트 browser/listener를 종료했다.
- `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 7 tests + Python 16 tests 통과, skipped 0, warning 0. 잘못된 PCM/origin/token
  acceptance 회귀를 유지했다. 실제 worklet/transport smoke와 `git diff --check`도
  실행하며 결과를 `docs/verification.md`에 기록한다.
- **남은 blocker (사용자 청취 필요)**: 원음이 실제 default/physical 출력에서 계속
  들리는지는 receipt counters나 화면으로 증명할 수 없다. generated fixture와 진짜
  capture가 실행되는 동안 async 청취 질문을 보냈지만 이번 실행 중 답변은 없었다.
  사용 가능한 system-output 청취 도구도 없다. destination 연결 코드를 실제 청취 성공
  근거로 쓰지 않는다. 항목 2 acceptance를 약화하거나 체크하지 않았다.
- 필요한 사용자 동작/다음 작업: 이 Mac의 출력에서 fixture Play → toolbar Interpreter
  → Start 후 동일 tone이 계속 들리는지, popup 닫은 뒤에도 들리는지 확인한다.
  README의 companion/fixture 명령과 전용 profile로 재현하고 실제 확인을 근거에 기록한다.
  필수 acceptance와 `npm run verify`를 통과한 뒤에만 항목 2를 체크하고 항목 3으로 간다.
  native 권한은 다시 요청할 필요 없다. 상세 관측/명령/실패/한계는
  `docs/verification.md`의 Ralph iteration 1/30 재개 기록에 보존한다.

### Ralph iteration 1/30 (청취 재시도) — 2026-10-06 — 항목 2 사용자 확인 차단

- 다음 미완료 항목 2만 재개했다. AGENTS.md는 없으며 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  기존 캡처 구현에 필요한 새 source 수정은 발견하지 않았다. 항목 2는 미체크다.
- `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 7 tests + Python 16 tests 통과, skipped 0, warning 0. 잘못된 PCM과 수명
  회귀 검증을 유지했다. 모델/자막/다음 항목으로 범위를 확대하지 않았다.
- rebuilt extension + Chrome for Testing 153.0.8010.12 + 새 ignored 전용 profile로
  generated 440/880 Hz fixture, 실제 loopback companion을 다시 실행했다.
  native `cua_repl`로 실제 Extensions toolbar → Interpreter → Start를 눌렀다.
  실제 tab capture active, 100 frames / 48,000 samples / peak 2881을 확인했다.
  native Escape로 popup을 닫은 뒤 같은 session은 800 frames / 384,000 samples로
  증가했고 popup target은 없었으며 capture active/offscreen 1을 유지했다.
- **Blocker (필수 사용자 청취 확인)**: 테스트 전과 실제 capture 중 async 청취
  질문을 보냈고 popup 종료 근거 기록 후 60초 청취 시간을 두었으나 답변이 없었다.
  이 session에는 system-output 청취 도구가 없다. 원음이 default/physical 출력에서
  capture 중과 popup 종료 후 계속 들리는지는 아직 미검증이다. PCM 수신과 audio
  activity 표시는 실제 청취 증거가 아니므로 acceptance를 체크하거나 약화하지 않았다.
- 종료 확인: native toolbar에서 다시 연 popup은 5000 PCM frames를 표시했다.
  실제 Stop 클릭 후 idle/offscreen contexts 0/tab capture stopped를 확인했다.
  harness exit로 테스트 browser와 두 listener를 종료하고 lsof/pgrep로 확인했다.
  임시 Node harness가 cleanup 후에도 남아 SIGTERM으로 종료했다(tool-reported exit 1).
  이를 harness exit 성공으로 기록하지 않는다. 임시 `.ralph`
  파일, 키, 모델 가중치, 사용자 오디오/전사문은 커밋하지 않는다.
- 필요한 사용자 동작: 이 Mac에서 fixture Play → 실제 toolbar Interpreter → Start
  동안 같은 tone이 계속 들리는지, popup 닫기 후에도 들리는지 확인해 응답한다.
  들리지 않으면 중단되는 상태를 알려 실제 실패를 재현한다. native 권한 재요청은
  필요 없다. 청취 결과 없이는 항목 2의 필수 acceptance를 완료할 수 없다.
  `docs/verification.md`에 이번 명령/관측/정확한 한계와 재개 절차를 보존한다.

### 사용자 동반 재검증 — 2026-10-06 — 항목 2 완료

- 사용자 요청으로 기존 `.ralph/capture-acceptance.mjs`를 다시 실행했다.
  Chrome for Testing 153.0.8010.12, rebuilt extension, 새 ignored profile,
  generated 440/880 Hz tone과 loopback companion을 사용했다.
- `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0:
  lint/typecheck/build, JS 7 tests + Python 16 tests 통과, skipped 0.
- native `cua_repl`로 실제 Extensions → Interpreter → Start를 눌렀다.
  실제 capture active/offscreen 1, 100 frames / 48,000 samples / peak 2881을
  확인했다. 사용자가 capture 전 "들려", capture 중 "ㅇㅇ 들려"로 답했다.
- 중간에 session 변경과 idle 상태가 관측돼 이를 popup 지속성 성공으로
  사용하지 않았다. 다시 native Start 후 Escape로 popup만 닫았다.
  popup target 없이 같은 session이 active/offscreen 1을 유지하며
  250 → 1850 frames (120,000 → 888,000 samples, peak 2881)로 증가했다.
  이 상태의 청취 질문에 사용자가 **"계속 들림"**으로 답했다.
  이 사용자 확인으로 기존 원음 재생 acceptance blocker가 해소됐다.
- popup 재개 시 2550 frames를 표시했다. native Stop 후 idle/offscreen 0/
  capture stopped를 확인했다. 다시 Start 후 새 session이 150 frames /
  72,000 samples / peak 2881을 수신했다. 캡처 중인 fixture tab을 native
  close로 닫자 idle/offscreen 0/captured tabs 0으로 정리됐다.
- harness exit 후 browser와 8765/8766 listeners 종료를 확인했다.
  cleanup 뒤 남은 임시 Node harness만 SIGTERM으로 종료했다.
  이 종료를 harness exit 0으로 보고하지 않는다.
- 이전 navigation/disconnect 증거와 이번 capture/청취/popup/반복/tab-close/
  malformed PCM 검증을 근거로 항목 2를 체크했다. 소스 수정은 없었다.
  다음 미완료 항목은 3번 자막 overlay다. 전체 구현 완료는 아니다.

### Ralph iteration 1/30 — 2026-10-06 — 항목 3 완료

- 다음 미완료 항목 3만 구현했다. checkout의 AGENTS.md는 없고 사용자 지침을
  적용했다. `.ralph/verification.txt`는 `No completion verification attempted in
  this run.`이다. 모델/출력 framework, 추가 제품 출력, cloud 요청은 추가하지 않았다.
- `extension/captions/overlay.ts`의 작은 feature-local DOM OutputSink와 content
  메시지 수명을 구현했다. Shadow DOM/textContent, 흰색 18–32px 글자/검정 shadow/
  반투명 배경, 80vw/960px 안전 너비, 두 줄 실측 분할/순차 표시/만료, revision
  교체, pointer-events none, fullscreen element 내부 이동/복귀/clear를 처리한다.
  worker Start에서 content script를 주입하고 Stop/terminal에서 이전 sink를 정리한다.
  페이지에서 caption/녹음을 시작하는 product UI나 테스트 caption 모드는 만들지 않았다.
- `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 7 tests + Python 16 tests, failures/skips/warnings 0. `git diff --check` 통과.
- `npm run test:captions-browser` exit 0: 실제 built extension + Chrome for Testing
  153.0.8010.12/Playwright 1.63.0, 일반/390×700/wrapper fullscreen 검증.
  revision 수정/역행 거부, 단일 host, Play/scrubber 클릭, 긴 생성 한국어 문장의
  모든 글자 순차 표시와 두 줄/만료, fullscreen DOM 위치/복귀, clear/늦은 결과 거부.
- `node tests/captions-browser.mjs --youtube` 최종 exit 0: 새 ignored profile에서
  실제 native Extensions → Interpreter invocation으로 activeTab을 얻은 뒤 popup을
  닫았다. Start 녹음은 하지 않았다. 공개 YouTube 페이지의 실제 theatre/fullscreen
  버튼 클릭, wrapper 내부 host, normal/theatre/fullscreen 두 줄/컨트롤 위 간격을
  확인했다. 최종 cue bottom/control top은 각각 604.80/625.80, 607/628,
  720/741 CSS px(1280×800)였다. browser/listener는 harness에서 exit 0으로 종료했다.
- 일반/좁은/fullscreen/YouTube normal/theatre/fullscreen PNG 6개를 실제 view_image로
  시각 검토하고 `docs/verification/captions/`에 보존한다. 밝고 어두운 배경에서 읽히며
  컨트롤이 보이고 눌린다. 초기 theatre 이미지의 컨트롤 겹침을 실제 발견해 player
  하단 기준의 작은 offset으로 수정하고 모든 YouTube mode 간격 assertion을 추가했다.
- 실패를 숨기지 않았다: TypeScript storage 타입/fixture button lint 수정,
  fullscreen event 이전 관측을 실제 containment 대기로 수정, 겹친 browser 실행의
  8766 EADDRINUSE 뒤 순차 재실행. worker의 늦은 terminal caption clear 회귀를 먼저
  실패시킨 뒤 직렬화된 current-state 검사 안에서 clear하도록 수정했다. 최종 통과.
- **생성한 test caption 증거이며 실제 음성 번역 성공이 아니다.** 기존 YouTube
  자막을 읽지 않았고 오디오/전사문/키/가중치/임시 .ralph state를 커밋하지 않는다.
  모델 코드/실제 audio-to-caption/성능/cloud/항목 8은 아직 미검증이다.
- 상세 명령/실패/측정/시각 증거: `docs/verification.md`의 이번 기록.
  항목 3 acceptance 통과 후 체크했다. blocker 없음.
  다음 미완료 작업은 **항목 4 — 실제 MLX ASR + Ollama local audio-to-caption**이다.
- 최종 build의 기존 transport smoke도 `PATH="$PWD/.tools/uv/bin:$PATH"
  npm run test:capture-browser` exit 0: 44.1 kHz → 50 frames/24,000 samples/
  peak 3275. 출력은 `tabCapture: "not exercised"`이며 실제 번역 증거로 쓰지 않는다.

### Ralph iteration 2/30 — 2026-10-06 — 항목 4 구현, native browser acceptance 차단

- 다음 미완료 항목 4만 진행했다. checkout에 AGENTS.md는 없으며 사용자 지침을
  적용했다. `.ralph/verification.txt`는 `No completion verification attempted in
  this run.`이다. **항목 4는 미체크**다. cloud/설정 UI/추가 제품 출력은 만들지 않았다.
- `server/sessions/local.py`에 feature-local MLX ASR, Ollama TextTranslator,
  LocalSession을 구현하고 companion → offscreen → worker → 기존 DOM sink를 연결했다.
  MLX는 optional/lazy import이며 한 전용 executor가 세션 교체 뒤에도 ASR를 직렬화한다.
  model 코드에는 DOM/Chrome 의존성을 넣지 않았다. 라이브 파일 token streaming을
  live PCM으로 주장하지 않고, VAD로 만든 짧은 메모리 구절을 실제 generate에 넣는다.
- 24 kHz PCM → 8 kHz VAD decision/16 kHz float32 ASR, pre-roll/최소 speech 200 ms,
  silence 500 ms, 구절 최대 6초, 대기 2구절/오디오 8초, 수신 100 frame/2초로 제한한다.
  오래된 대기는 drop/count/status로 명시한다. 완료된 원문만 번역하고 최근 문맥은
  최대 3쌍으로 제한한다. Stop 취소/늦은 결과 거부/모델 실패 연결 종료를 처리한다.
- 실제 Apple M5/16 GiB, Python 3.12.15, mlx-audio 0.5.8/MLX 0.32.3,
  Ollama 0.35.1에서 두 모델을 실행했다. 공개 ASR snapshot
  `89e96d92ba34aca20b3e29fb10cc284097d1219f`를 normal cache에 내려받았고,
  Ollama tags/show로 qwen3:4b-instruct Q4_K_M을 확인했다. Xet 다운로드가 멈춰
  해당 process를 종료하고 HF_HUB_DISABLE_XET=1 HTTP 재시도로 완료했다.
- 비민감 영어 문장을 macOS say로 생성했다. 실제 VAD 구절 → 실제 MLX → 실제
  Ollama → final Korean caption이 성공했다. ASR는 생성 문장과 일치하고 한국어는
  맑은 날씨/점심 뒤 공원 산책 계획을 전달했다. 사용자 음성/원문은 저장하지 않았다.
  임시 첫 모델 smoke exit 0, cold elapsed 25.947초; 재현 가능한
  `PATH="$PWD/.tools/uv/bin:$PATH" npm run test:local-model` exit 0,
  Ollama resident 상태 elapsed 2.491초. **둘 다 tabCapture not exercised**이며,
  실제 브라우저 자막 지연/p50/p95/실제 audio-to-caption acceptance가 아니다.
- 두 smoke에 HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE=1을 적용했고 ASR는 cached-only,
  Ollama는 proxy를 사용하지 않는 고정 loopback이다. external inference API/유료
  fallback 요청이 없다. 실제 missing-ASR probe는 README 다운로드 안내를 반환했다.
  fixture는 MLX 의존성/텍스트 모델 미설치, Ollama 중단/timeout/error 안내도 검증한다.
- 최종 `uv sync --locked`로 optional MLX를 제거한 base 환경에서도
  `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 7 + Python 29 tests, failures/skips/warnings 0. `git diff --check` 통과.
  새 회귀는 silence/gap/length, bounded queue/drop, full-queue 취소/late translation,
  final text/context-only 요청, WS caption/error, active session worker routing을 검증한다.
  기존 worklet smoke exit 0: 50 frames/24,000 samples/peak 3275; 실제 캡처 증거 아님.
- 실패를 수정했다: WebRTC VAD 24 kHz 거부 → 8 kHz decision stream,
  모델 cleanup await 뒤 active slot 해제에 따른 restart/token 409 → await 전 해제,
  변경 소스 import/line length lint 수정. acceptance/test/security를 약화하지 않았다.
- **Blocker (native window 접근에 외부 변경 필요)**: `npm run test:local-browser`로
  fresh headed Chrome 153.0.8010.12/전용 ignored profile/loopback companion을 실행했으나
  cua_repl getApp이 bundle ID/app name/cache path 모두 `Computer Use server error
  -10005: cgWindowNotFound`를 반환했다. tool binding 및 browser 재시작 뒤에도 동일했다.
  visible desktop에 테스트 창을 띄우고 필요하면 Mac 잠금을 풀도록 async 요청했으나
  이번 run에 응답이 없었다. 원인을 permission 또는 잠금으로 단정하지 않는다.
- 실제 관측은 capture status 없음, captured tabs [], cue 없음이다. native toolbar
  → Start를 누를 수 없어 **실제 Chrome tab audio → 두 모델 → visible Korean cue**와
  그 screenshot 시각 검토는 미검증이다. 이전 tone/생성 test caption 성공을 대체 증거로
  쓰지 않았다. 최초 harness exit 0은 cleanup만의 결과; 최종 harness는 accept 성공
  없이는 exit 1이며 이번 차단 실행은 exit 1이다. 브라우저/fixture/companion/Ollama를
  종료하고 8765/8766/11434 listeners와 local harness/model smoke가 없음을 확인했다.
- 재개에 필요한 사용자/외부 동작: dedicated Chrome testing 창을 native control이
  찾을 수 있는 visible desktop에 띄운다. Ollama serve 후 `npm run test:local-browser`를
  실행한다(local extra 자동 설치). 실제 toolbar Interpreter → Start → popup 닫기,
  harness play/accept, 실제 자막 의미/`docs/verification/local/normal.png` 시각 검토와
  Stop clear를 확인하고 기록한다. 실제 acceptance 및 verify 후에만 항목 4를 체크한다.
  모델 cache는 준비돼 있다. 상세 명령/결과/정확한 한계는 docs/verification.md에 남긴다.
  다음 미완료 작업은 여전히 **항목 4 실제 browser acceptance**이며 완료가 아니다.

### Ralph iteration 1/30 (local browser 재개) — 2026-10-06 — 항목 4 완료

- 사용자 지정 checkout 안에서 다음 미완료 항목 4의 실제 browser acceptance만
  재개했다. AGENTS.md는 없으며 사용자 제공 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
- 이전 native window blocker는 이번 실행에서 해소됐다. `cua_repl.getApp`이
  headed 전용 Chrome for Testing 153.0.8010.12의 fixture 창을 찾았다.
  실제 Extensions toolbar → Interpreter → Start를 클릭하고 Escape로 popup을
  닫았다. 가짜 stream/테스트 caption/기존 YouTube 자막으로 대체하지 않았다.
- `npm run test:local-browser`를 두 번 실행해 macOS say의 비민감 영어 음성을
  실제 페이지에서 재생했다. 실제 tabCapture → PCM → cached MLX Qwen3-ASR
  0.6B 8bit → Ollama qwen3:4b-instruct Q4_K_M → 한국어 DOM 자막이 성공했다.
  두 실행 모두 capture active였으며 caption 순간 각각 1850 frames/888,000 samples,
  700 frames/336,000 samples, peak 25093을 확인했다.
- 한국어 의미는 맑은 날씨와 점심 뒤 공원 산책 계획을 전달했다. 마지막 실행의
  `docs/verification/local/normal.png`를 실제 image viewer로 검토했다:
  하단 중앙 한 줄, 흰 글자/검정 outline/작은 반투명 배경으로 읽히며 페이지의
  audio controls를 가리지 않는다. 생성 speech의 실제 번역 증거다.
- 기존 local harness에 `stopped` acceptance를 추가했다. 실제 native Stop 뒤
  idle/capture stopped/offscreen contexts 0/caption hosts 0을 assertion으로 검증한다.
  exit 0은 이제 caption acceptance와 Stop cleanup 둘 다 필요하다. 최종 harness
  exit 0이며 README에 이 재현 순서를 기록했다. 제품 추상화/범위를 늘리지 않았다.
- cloud API 없이 HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE=1, cached-only ASR,
  고정 loopback Ollama를 사용했다. 실제 Ollama tags/digest와 두 /api/chat 200을
  관측했다. 이전 actual missing-ASR 안내와 이번 verify의 missing-dependency/model/
  stopped-Ollama fixture 검증을 유지했다. 사용자 키/음성/전사문을 읽지 않았다.
- 마지막 `uv sync --locked`로 optional MLX를 제거한 뒤
  `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 7 + Python 29 tests, failures/skips/warnings 0. `git diff --check` 통과.
  browser/companion/fixture와 직접 시작한 Ollama를 종료하고 8765/8766/11434
  listeners 및 해당 harness/server/model processes가 없음을 확인했다.
- 이번에는 새 실패나 blocker가 없다. 실제 자막 latency/p50/p95, YouTube 실제
  번역과 10분 처리는 아직 측정하지 않았다(항목 8). live cloud도 미검증이다.
  상세 evidence는 `docs/verification.md`의 이번 기록에 보존했다.
  필수 항목 4 acceptance 통과 후 체크했다. 다음 미완료 작업은
  **항목 5 — OpenAI direct 전용 realtime translations adapter/protocol 검증**이다.
