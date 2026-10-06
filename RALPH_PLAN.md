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
기본 입력 언어는 Auto, 출력 언어는 한국어로 한다. 입력 언어 자동 감지와 수동 지정,
출력 언어 변경을 설정에서 지원한다. 기존에 저장한 수동 입력 언어 선택은 유지한다.
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
runner를 수정하거나 테스트를 무력화해 완료시키지 않는다. 완료 기준은 사용자 요청이
있을 때만 변경한다.
2026-10-06 사용자 요청으로 지연 개선/언어 자동 감지를 추가하고, YouTube 재생 오류는
확인 가능한 범위를 기록하되 다른 공개 영상으로 장시간 검증을 진행하도록 변경했다.
이 변경은 아래 체크리스트와 완료 기준에 반영했다. 10분 실제 처리 요구는 유지한다.
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

- [x] 5. OpenAI direct 실시간 번역 경로 구현
  - 키는 server-side에서 사용하고 전용 endpoint/events/close를 처리한다.
  - Acceptance: protocol fixture 테스트로 한국어 출력 설정, 연속 PCM 전송,
    transcript delta의 cue 수정, session close/error를 확인한다. 키가 있을 때만
    명시적으로 선택한 live smoke를 실행한다. 모델 미접근 시 mock 성공으로 숨기지 않는다.

- [x] 6. Luna/Anthropic와 ASR 선택 구현
  - TextTranslator에 OpenAI Responses Luna, Anthropic Messages, local Ollama를 연결한다.
  - ASR는 local 또는 OpenAI live transcription을 선택할 수 있게 한다.
  - Acceptance: provider contract/integration 테스트에서 ASR 결과가 각 번역 API에
    전달되고 동일 cue를 만든다. Luna/Anthropic에는 audio를 전송하지 않는다.
    model ID 선택, 취소, rate limit/권한 오류, partial/final 구분을 검증한다.

- [x] 7. 설정 UI와 session/출력 교체 검증
  - popup에 입력/목표 언어, local/direct/text provider와 호환 model ID, Start/Stop을 둔다.
  - OutputSink 분리와 test memory sink fan-out을 검증한다. 추가 제품 출력은 만들지 않는다.
  - Acceptance: provider 변경 시 이전 세션을 중단하고 새 세션만 표시한다. 중복 overlay,
    자막 HTML injection, 오래된 응답의 자막 덮어쓰기가 없다. 페이지에 키가 노출되지 않는다.

- [ ] 7a. 로컬 자막 지연 개선
  - 현재 500ms silence/최대 6초 구절, ASR → 전체 번역 응답 → 표시의 지연을
    기준으로 같은 공개/생성 음성의 변경 전후 VAD 대기, ASR, 번역, 첫 표시를 측정한다.
    모델 로딩이 포함된 첫 실행과 모델이 준비된 실행을 분리한다.
  - 작은 변경부터 진행한다: Start 준비 중 모델을 미리 준비하고 silence 경계를
    250–300ms 후보와 비교한다. 자동 캡처/가짜 caption은 추가하지 않는다.
    더 짧은 구절 길이는 의미 손실/오인식을 비교한 뒤 적용하며 고정값 변경만으로
    지연이 해결됐다고 주장하지 않는다.
  - Ollama의 번역 출력 스트리밍을 같은 utterance ID/증가 revision의 partial/final
    cue에 연결해 전체 답변이 끝나기 전에 표시한다. 원문 partial마다 번역 호출을
    늘리지 않고, 완성된 짧은 원문에 대한 하나의 요청에서 출력만 점진적으로 받는다.
    필요할 때만 ASR/번역 직렬 대기의 추가 개선을 진행한다. 파일 입력 토큰 스트리밍을
    live PCM ASR로 표현하지 않으며 새 모델/공통 provider framework를 추가하지 않는다.
  - Acceptance: 동일 음성/설정의 변경 전후 첫 자막 및 final 자막 p50/p95, sample 수,
    cold/warm, queue/drop을 기록하고 첫 표시 지연의 개선을 실측한다. 영어→한국어
    의미/긴 cue 무손실, partial/final 교체, Stop/세션 교체 뒤 늦은 결과 거부,
    bounded queue와 원음 재생을 확인한다. 0ms나 미측정 지연 수치를 보장하지 않는다.

- [ ] 7b. Source 언어 자동 감지
  - popup의 Source/Input language에 Auto와 기존 수동 언어를 제공한다. 새 설치의
    기본은 Auto이며 저장된 명시적 수동 선택을 덮어쓰지 않는다. 목적 언어는 별도다.
  - 설치된 MLX Qwen3-ASR 버전의 자동 감지 입력/출력을 확인하고 Auto에서 언어를
    강제하지 않는다. 번역 지침도 영어로 고정하지 않는다. 별도 언어 판별 모델은 없다.
    Auto를 local ASR를 사용하는 local/Luna/Anthropic 경로에 연결한다.
    OpenAI ASR는 공식 protocol의 자동 감지 지원을 확인해 제공하며 미지원이면
    명확히 알리고 수동 선택을 요구한다. 몰래 영어로 대체하지 않는다.
    OpenAI direct의 기존 자동 감지 경로는 유지한다.
  - Acceptance: Auto 설정 저장/POST 검증/token 바인딩과 수동 override를 검증하고,
    실제 로컬 모델로 비민감 영어/한국어 음성의 인식 및 한국어 출력을 확인한다.
    짧은 발화/무음/음악/혼합 언어의 관측 결과와 오판 한계를 기록한다. 자동 감지에
    신뢰도 API가 있다고 추측하지 않고, 미확정 결과를 영어로 고정하거나 성공으로
    기록하지 않는다. 키가 없는 cloud 경로는 기존 fixture/live 구분 규칙을 적용한다.

- [ ] 8. 실제 브라우저 동작과 장시간 처리 검증
  - Chrome/Chromium의 전용 테스트 profile에서 unpacked extension을 로드한다.
    tabCapture는 실제 사용자 Start 동작으로 시험한다. 마이크/가짜 stream만으로
    실제 tab capture를 검증했다고 주장하지 않는다.
  - Acceptance: 실제 공개 영어 영상의 Chrome 탭 오디오 → 로컬 두 모델 → 의미가
    맞는 한국어 자막을 확인하고 일반/fullscreen screenshot을 검토한다. 최소 10분
    연속 advancing media에서 큐가 무한히 증가하지 않고 Start/Stop, 탭 이동,
    companion 중단 후 복구를 확인한다. 무음 캡처/정지/seek/loop를 10분으로 세지 않는다.
  - YouTube에서는 확인 가능한 실제 자막/일반/theatre/fullscreen 및 재생 오류,
    확장 없는 비교 결과와 한계를 남긴다. 사이트 재생이 계속 실패하면 같은 상태의
    재시도를 반복하지 않고 다른 공개 영상으로 위 필수 검증을 진행한다.
    YouTube의 미검증 동작을 통과로 체크하지 않되, 대체 영상의 필수 검증이 모두
    통과하고 YouTube 오류/한계가 기록되면 항목 8은 완료할 수 있다.
  - 우선 대체 후보는 TED 공식 Robert Waldinger 강연(약 12분 37초):
    https://www.ted.com/talks/robert_waldinger_what_makes_a_good_life_lessons_from_the_longest_study_on_happiness
    기존 YouTube harness는 YouTube origin/단일 video/theatre를 전제하므로 그대로
    이 URL을 넣지 않는다. TED의 광고를 제외한 본 영상 선택과 native Start,
    일반/fullscreen, 동일한 600초/성능/수명 assertion을 지원하도록 작은 검증 경로를
    추가하고 README에 실제 실행 명령을 남긴다. 플랫폼별 없는 모드는 이유를 기록한다.
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

완료 필수: **실제 local 모델 + 실제 Chrome 탭 오디오 + 한국어 자막**, 공개 영상의
10분 연속 처리/일반·fullscreen 시각 검토, 지연 개선 실측, Source Auto 및 수동 선택,
수명/큐 검증, 네 가지 경로의 실제 adapter 코드와 contract tests.
YouTube는 가능한 동작/자막 시각 검토와 재생 오류의 범위를 기록한다. YouTube가
막혀도 TED 등 대체 영상에서 위 필수 검증이 통과하면 전체 완료를 허용한다.
키가 없어 live cloud 호출을 못 했어도 adapter/protocol 검증을 통과했다면 해당 경로는
“구현/fixture 검증 완료, live 미검증”이라고 정확히 기록한다. live cloud 성공으로
표시하지 않는다. API 키를 찾아 다른 앱/사용자의 credential 파일을 읽지 않는다.

로컬 모델 실행 또는 어느 공개 영상에서도 실제 Chrome 탭 캡처/10분 처리 검증을
할 수 없다면 필수 완료가 아니다. YouTube 사이트 오류만으로 다른 구현/검증을 멈추지 않는다.
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

### Ralph iteration 2/30 — 2026-10-06 — 항목 5 구현/fixture 검증 완료, live 미검증

- 지정 checkout 안에서 다음 미완료 항목 5만 구현했다. AGENTS.md는 없으며
  사용자 지침을 적용했다. `.ralph/verification.txt`는 `No completion verification
  attempted in this run.`이다. 다른 agent/browser/model을 실행하지 않았다.
- 공식 translation guide와 translation server events를 다시 조회했다.
  `server/sessions/direct.py`의 작은 DirectSession은 기존 TranslationSession 계약을
  사용한다. 가짜 Transcriber, provider framework, 새 제품 output을 추가하지 않았다.
  고정 `/v1/realtime/translations?model=gpt-realtime-translate`, 서버 환경 변수의 키,
  output language update/ack, silence 포함 연속 24 kHz raw PCM16 append를 처리한다.
  voice-agent response.create/VAD/commit protocol은 보내지 않는다.
- append-only transcript delta를 같은 cue ID의 증가 revision으로 정규화한다.
  같은 elapsed_ms의 별도 delta를 버리거나 임의 공백을 넣지 않는다. 문장부호/160자/
  정상 close가 local display cue를 확정한다(API utterance-final 이벤트가 아니다).
  텍스트/수신 큐/전송 대기를 제한하고 source transcription 없이 caption source는 빈 값,
  번역 음성은 버린다. optional alignment metadata와 captured-time fallback을 사용한다.
- companion 환경 변수 `INTERPRETER_PROVIDER=openai-direct`로 명시 선택하며 기본은
  local이다. 설정 UI는 항목 7에 남긴다. 키 누락/unknown provider/access/quota/protocol/
  disconnect/stall은 상태 오류이며 fallback이 없다. API 키/원시 provider body를
  extension caption/status/auth 응답에 넣지 않는다. README/.env.example에 실행법을 썼다.
- Stop은 sender를 취소하고 늦은 caption을 버리면서 session.close를 한 번 보내고
  session.closed까지 drain한다(5초 제한). 실제 ASGI companion fixture에서 disconnect
  cancellation이 cleanup을 중단하는 회귀를 먼저 확인했다(15초 실패, close 미관측).
  transport finally의 작은 CancelScope shield로 수정한 뒤 정상/error 두 integration
  case에서 실제 local fixture socket의 session.close/closed를 검증했다.
- `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` 최종 exit 0: lint/typecheck/build,
  JS 7 + Python 48 tests 통과, failures/skips/warnings 0. direct 신규 19 cases는 한국어
  output config, 4개 silence/PCM frame의 정확한 byte 순서, partial/final/revision,
  600자 무문장부호 cue 무손실 분할, timestamp fallback, graceful trailing caption,
  Stop의 늦은 결과/PCM 거부, 5초 timeout, handshake 401/403/429, provider access/rate
  error, malformed/disconnect, companion routing/error/키 미노출/재시작을 검증한다.
  line-length lint 및 fallback fixture 수정 중 frame/close 기대값 불일치 2건도 고쳤다.
  acceptance를 약화하거나 실패를 성공으로 기록하지 않았다. `uv lock --check`와
  `git diff --check` 통과. websockets 17.2/anyio 4.15.1을 직접 의존성으로 선언했다.
- **정확한 live 한계**: 이 process의 OPENAI_API_KEY는 unavailable이다. 명시 opt-in
  `npm run test:direct-live`를 구현했지만 이번 실행은 key gate에서 exit 1:
  `Live smoke unavailable: OPENAI_API_KEY is not exported.` 실제 OpenAI 연결/모델
  접근/번역 품질/지연은 미검증이며 fixture 성공을 live 성공으로 주장하지 않는다.
  credential 파일을 찾거나 읽지 않았고 유료 호출/생성 audio는 실행하지 않았다.
  live 재검증은 서버 shell에 키를 export한 뒤 위 명령으로 generated macOS speech를
  전송하고 한국어 의미를 확인한다. 이 smoke는 tabCapture/자막 appearance 증거가 아니다.
- 플랜의 keyless cloud fixture 규칙에 따라 필수 protocol acceptance 통과 후 항목 5를
  체크했다. 키 부재는 이 항목의 blocker가 아니다. 상세 증거는 docs/verification.md에
  보존한다. 사용자 음성/전사문/키/가중치/임시 .ralph state는 커밋하지 않는다.
  다음 미완료 작업은 **항목 6 — Luna/Anthropic TextTranslator + ASR 선택**이다.
  항목 6–9, 실제 YouTube 번역/10분/성능/최종 완료 검증은 남아 있다.


### Ralph iteration 3/30 — 2026-10-06 — 항목 6 구현/fixture 검증 완료, live 미검증

- 지정 checkout 안에서 다음 미완료 항목 6만 진행했다. AGENTS.md는 없으며 사용자
  지침을 적용했다. `.ralph/verification.txt`는 `No completion verification attempted
  in this run.`이다. 다른 agent/browser/유료 inference를 실행하지 않았다.
- 공식 Luna model card, Responses/transcription guide와 Realtime events,
  Anthropic Messages reference를 확인했다. `gpt-6-luna`와 지원되는 reasoning none을
  사용하며 Anthropic model ID는 접근 가능한 값을 명시하도록 요구한다. 최신 ID나
  사용자 account의 접근 가능성을 추측하지 않는다. 키는 companion 환경 변수뿐이다.
- 작은 feature-local CloudTranslator/LiveTranscriber/selection 함수로 기존 계약과
  LocalSession 조합을 재사용했다. local/luna/anthropic 번역에 local/OpenAI ASR를
  각각 선택한다. 기본은 local이며 direct 경로는 별도다. popup UI는 항목 7에 남긴다.
- Luna Responses와 Anthropic Messages에는 audio 없이 final text와 최근 3쌍만
  보낸다. ASR partial은 동일 utterance ID/revision으로 처리하며 final만 번역한다.
  caption은 기존 session/utterance/audio interval을 유지한다. HTTP 취소/늦은 응답
  거부/30초 제한/권한·quota·응답 오류를 처리하고 유료 fallback은 없다.
- OpenAI ASR는 gpt-live-transcribe, 24 kHz PCM, client VAD/명시 commit이다.
  기존 500 ms silence/6초 최대 구절을 먼저 모아 보내는 phrase-buffered 방식이며
  연속 word-by-word display라고 주장하지 않는다. 한 turn씩 처리하고 early delta와
  commit ack의 item ID를 일치시킨다. final item delete/ack, 2구절/8초 대기 제한,
  오래된 segment drop/count, 실제 30초 stall 종료, Stop socket cleanup을 검증했다.
- 신규 61 cases(텍스트/선택/companion 41 + ASR 20)는 실제 local fixture WebSocket,
  HTTP adapter와 인증된 ASGI PCM을 사용한다. companion 통합의 MLX inference는
  deterministic fixture다. 실제 cloud/MLX/Chrome 성공으로 대체 기록하지 않는다.
  각 텍스트 API의 final-only 요청/모델 ID/문맥/동일 cue, partial/final/revision,
  누락 설정/401/403/404/429/timeout/invalid response/cancel/late result를 검증했다.
  30개 fixture turn 중 첫 응답을 지연시키면 27개 대기 구절을 버리고 큐를 제한한다.
- 실패를 수정했다: line-length lint, pre-roll 기대값 1300→실측 1320 ms,
  deletion ack 전에 닫는 race. early delta가 commit ack보다 먼저 오는 회귀를 먼저
  exit 1로 재현하고 ID reconciliation 수정 후 해당 test와 전체 verify가 통과했다.
  잘못된 item ID는 여전히 실패하며 acceptance/테스트/runner를 약화하지 않았다.
- 최종 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 7 + Python 109 tests, failures/skips/warnings 0(Python 35.87초).
  `uv lock --check`, `git diff --check` 통과. 새 의존성/lockfile 변경은 없다.
- **정확한 live 한계**: process의 OPENAI_API_KEY/ANTHROPIC_API_KEY 모두 unavailable.
  live Luna/Anthropic/OpenAI ASR 연결·모델 접근·품질·지연은 미검증이다. credential
  파일을 찾거나 읽지 않았고 cloud call은 실행하지 않았다. README에 명시 선택과
  서버 key 설정 후 live 재검증 방법을 보존했다. 플랜의 keyless fixture 규칙에 따라
  항목 6 acceptance를 통과한 뒤 체크했으며 키 부재는 이 항목 blocker가 아니다.
- 상세 명령/실패/한계는 docs/verification.md에 기록했다. 키/가중치/사용자 음성·전사문/
  임시 .ralph state는 커밋하지 않는다. 다음 미완료 작업은 **항목 7 — popup 설정과
  session/OutputSink 교체 검증**이다. 실제 YouTube 번역/10분/성능/최종 완료는 남았다.

### Ralph iteration 4/30 — 2026-10-06 — 항목 7 설정/session/output 검증 완료

- 지정 checkout 안에서 다음 미완료 항목 7만 진행했다. AGENTS.md는 없으며 사용자
  지침을 적용했다. `.ralph/verification.txt`는 `No completion verification attempted
  in this run.`이다. 다른 agent/native browser/model/유료 API/credential 파일을 쓰지 않았다.
- popup에 provider(local/direct/Luna/Anthropic), local/OpenAI ASR, 입력/자막 언어,
  호환 model ID를 추가했다. 기본 local 영어→한국어. 설정 변경은 이전 캡처와 자막을
  중단하며 새 캡처는 명시 Start에서만 시작한다. 비밀이 아닌 여섯 설정만 local storage에
  보존한다. direct/live ASR model은 고정, Anthropic model ID는 필수다.
- companion은 작은 feature-local SessionSettings로 /sessions body를 검증하고
  single-use token에 선택을 묶는다. 키/base URL/unknown field는 거부하며 WS에서는
  선택을 바꿀 수 없다. 서버 key만 adapter에 전달한다. 기존 body 없는 client의 환경
  기본값은 유지하며 popup 선택은 언어/provider/model 기본값보다 우선한다.
- 작은 caption output fan-out을 기존 content script의 DOM sink에 연결했다.
  memory sink는 테스트만 쓰며 새 제품 output/framework는 만들지 않았다.
  같은 caption/status/clear 전달, 다른 session/폐기 뒤 event 거부를 검증한다.
- 최종 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 9 + Python 130 tests, failures/skips/warnings 0(Python 35.91초).
  신규 JS 2 + Python 21 cases가 provider 변경 중 이전 stop/clear/새 설정 Start,
  content 설정 요청 거부/늦은 caption, 모든 provider/ASR/model/language 선택,
  키 미노출/선택 token 바인딩/invalid 설정/재시작을 검증했다. 실제 inference가 아니다.
- `npm run test:settings-browser` 최종 exit 0: fresh ignored profile, headless
  실제 built extension, Chrome for Testing 153.0.8010.12/Playwright 1.63.0.
  popup reload 보존/고정 model field/Anthropic 필수 입력, built offscreen의 정확한
  설정 POST/422 안내/녹음 전 cleanup, real DOM+test memory fan-out, HTML literal
  표시와 injection 미실행, built content 중복 설치/단일 overlay/session 교체/늦은
  덮어쓰기와 old clear 거부/Stop clear를 통과했다. 생성 cue이며 실제 번역이 아니다.
- `docs/verification/settings/popup.png`를 실제 view_image로 검토했다. native popup이
  아닌 372×600 standalone extension page이며, 모든 control과 Start/Stop이 읽히고
  높이 안에 들어간다. 첫 layout의 높이 여유를 늘리고 action bottom assertion을 넣었다.
- 기존 `npm run test:captions-browser` exit 0: normal/narrow/wrapper fullscreen,
  revision/두 줄/긴 cue 무손실/컨트롤 클릭/만료/cleanup 통과. 기존 PNG 변경 없음.
  실제 YouTube/audio 번역 증거로 쓰지 않았다. `uv lock --check`, `git diff --check` 통과.
  browser/fixture를 종료했고 8765/8766 listeners 없음. dependency/lockfile 변경 없음.
- 실패 수정: Python line-length/import lint; 첫 settings browser의 TS7 runtime compiler
  API 부재(TypeError)를 기존 Vite transformWithOxc로 수정하고 재실행 통과했다.
  테스트/acceptance/runner는 약화하지 않았다. README/.env.example에 popup 우선권과
  명시 Start/서버 key/호환 model 사용 및 재현 명령을 보존했다.
- 상세 증거는 docs/verification.md에 기록했다. 항목 7 acceptance 통과 후 체크했다.
  blocker 없음. 실제 local capture 항목 4의 기존 evidence는 유지하며 이번에는 재실행하지
  않았다. live cloud는 여전히 미검증이다. 키/가중치/사용자 음성·전사문/임시 .ralph는
  커밋하지 않는다. 다음은 **항목 8 — 실제 YouTube 번역/10분 처리/성능과 복구 검증**.
  기존 local-browser harness를 출발점으로 실제 toolbar Start와 YouTube 재생을 검증하고,
  normal/theatre/fullscreen screenshot 시각 검토, 최소 10분 큐/drop/latency p50/p95/
  모델·전체 메모리 및 Start/Stop/navigation/companion 복구를 기록해야 한다.
  항목 8–9와 최종 완료 검증은 아직 남아 있다.

### Ralph iteration 5/30 — 2026-10-06 — 항목 8 진척, YouTube 재생 차단

- 지정 checkout 안에서 다음 미완료 항목 8만 진행했다. AGENTS.md는 없으며 사용자
  지침을 적용했다. `.ralph/verification.txt`는 `No completion verification attempted
  in this run.`이다. 다른 agent/worktree/push/cloud API/credential 파일을 쓰지 않았다.
- `npm run test:youtube-browser`와 test-only numeric companion wrapper를 추가했다.
  fresh ignored profile/실제 unpacked extension/실제 native toolbar Start/실제
  YouTube tabCapture/cached MLX/loopback Ollama를 사용한다. 제품 capture/model/output
  추상화는 변경하지 않았다. audio/transcript를 저장하지 않으며 최신 caption은
  `check`에서 메모리로만 확인한다. 통과하려면 600초 실제 미디어 진행, 큐/latency/
  memory, 세 화면 및 Stop/navigation/disconnect/recovery assertion이 모두 필요하다.
- Chrome for Testing 153.0.8010.12, Playwright 1.63.0, Apple M5/16 GiB,
  Python 3.12.15, Ollama 0.35.1. ASR snapshot/8bit 및 qwen3:4b-instruct Q4_K_M은
  이전 검증과 동일하며 offline ASR/고정 loopback만 사용했다. cloud live는 미검증이다.
- 실제 YouTube → PCM → 두 모델 → 한국어 cue를 관측했다. 마지막 run의 error 직전
  active capture, 1200 frames/576,000 samples/peak 29296. 미래의 자신/시간·에너지
  투자 및 80% 이상의 부 축적 목표에 관한 한국어가 실제 ASR 원문 의미를 전달했다.
  미리 만든 caption/기존 YouTube 자막/마이크/가짜 stream은 사용하지 않았다.
  짧은 구절 오인식과 opening music의 spurious cue도 관측했으며 일반 품질 보장은 아니다.
- 실제 native reload 뒤 navigation cleanup, native Start 재시작, 실제 companion SIGINT
  뒤 error cleanup/재시작/native Start/다른 session의 실제 cue recovery가 통과했다.
  마지막 두 run 모두 native Stop 후 idle/no active capture/offscreen contexts 0/
  caption hosts 0 assertion 통과. browser/companion/Ollama를 종료했고
  8765/8766/11434 listener가 없음을 확인했다.
- 네 PNG를 실제 view_image로 검토했다. normal은 읽히는 실제 두 줄 번역(94px/
  line-height 43.008px), fullscreen은 실제 wrapper 내부의 한 줄 번역이다. control
  위 위치와 pointer-events none, native theatre/fullscreen 조작이 통과했다.
  **theatre PNG는 음악에 대한 spurious 짧은 cue라 의미 있는 speech cue의 theatre
  acceptance는 아직 미검증**이다. 사이트 promotional panel을 제거하지 않았다.
- 마지막 error 시점 `docs/verification/youtube/blocked.json`은 accepted:false,
  실제 미디어 20.021초/painted cue 5개/p50 2.480초/p95 4.762초, sampled ASR 대기
  최대 820ms, frame/utterance drop 0이다. Stop 전 6번째 cue를 포함한 최종 terminal
  report p50은 1.976초, p95 동일. **어느 것도 10분 실측이 아니다.** cold 첫 run은
  p95 20.219초/대기 6960ms/utterance drop 2로 5초 목표를 못 지켰다. warm reload는
  11개 cue p50 1.117/p95 1.866초지만 작은 sample이며 장시간 보장은 아니다.
- blocked snapshot MLX active peak 1,034,000,178 bytes/peak allocation
  1,680,164,320 bytes. 첫 process sample의 companion+Ollama+전용 browser 합산 RSS
  4,538,679,296 bytes(4.23GiB), Ollama Metal allocation 별도 3,175,339,786 bytes.
  Apple unified memory에서 allocation/RSS는 중첩되므로 더하지 않는다. 두 sample만으로
  장시간 memory 안정성/누수를 판정하지 않았다. timing/샘플링 한계를 문서화했다.
- **Blocker (외부 YouTube/browser 재생 변경 필요)**: 공개 Ken Robinson
  `iG9CE55wbtY`와 Waldinger `8KkKuTCFvzI` 모두 fresh profile/refresh/companion restart
  이후에도 약 42–44초에서 “문제가 발생했습니다. 새로고침하거나 나중에 다시 시도해
  보세요.”로 중단했다. video가 time 0/duration NaN/paused true/error null로 reset됐고,
  관측된 googlevideo HTTP >=400은 없었다. 원인을 network/codec/login으로 단정하지
  않는다. 로그인/CAPTCHA 화면은 없었으며 우회하지 않았다. error screenshot과 정확한
  numeric snapshot을 docs/verification/youtube에 보존했다. silence PCM은 계속
  도착했으나 harness가 실제 advancing media만 세어 10분 성공으로 취급하지 않았다.
- 실제 acceptance harness 세 실행 모두 필수 long playback 미달로 exit 1이다.
  최초 caption-browser native access probe는 test caption checks 전에 Ctrl+C로 종료해
  AbortError/exit 1이며 acceptance pass가 아니다. 첫 lint의 assignment-in-expression/
  Python line length는 고쳤다. acceptance/runner/tests를 완화하지 않았다.
- 마지막 `uv sync --locked`로 optional MLX를 제거한 기본 환경에서
  `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 9 + Python 130 tests, failures/skips/warnings 0(Python 35.98초).
  browser가 실행 중일 때 별도 ignored base venv의 verify도 exit 0(Python 36.94초).
  `git diff --check`와 lock check 통과. 새 dependency/lockfile 변경은 없다.
- 재개에 필요한 외부 동작: dedicated test Chrome에서 공개 영어 YouTube 영상이
  확장 없이도 최소 10분 연속 재생 가능한 상태인지 확인/해결한다. 그 뒤 README의
  test:youtube-browser/native Start 순서로 meaningful normal/theatre/fullscreen cue,
  전체 600초, 큐/drop/p50/p95/model·process memory 및 모든 수명 check를 같은
  acceptance run에서 다시 검증한다. 상세 명령/결과/한계는 docs/verification.md에 있다.
  **다음 작업은 여전히 항목 8**이며 체크하지 않았다. 항목 9/최종 완료도 남아 있다.
  이번 progress/blocker를 Conventional Commit으로 보존하고 runner를 차단 종료한다.

### 사용자 요청 반영 — 2026-10-06 — 지연/Auto 추가, 대체 영상 검증 허용

- 사용자가 자막 지연 개선과 Source 자동 감지를 플랜에 추가하고, YouTube 오류는
  확인 가능한 범위를 적거나 다른 영상을 찾아 검증하도록 요청했다.
  미완료 항목 **7a(지연 개선), 7b(Source Auto)**를 항목 8 앞에 추가했다.
  작은 VAD/모델 준비 개선과 번역 출력 스트리밍, 같은 음성의 변경 전후 첫 표시/
  final 지연·의미·수명 검증을 요구한다. 새 기본 Source는 Auto이며 수동 선택은 유지한다.
- 항목 8/완료 기준은 사용자 요청에 따라 대체 공개 영상을 허용하도록 변경했다.
  실제 Chrome tabCapture/실제 local 두 모델/한국어 의미/일반·fullscreen 시각 검토/
  연속 600초/큐·drop·latency·memory/수명·복구 요구는 유지한다.
  YouTube에서 못 확인한 동작을 통과로 표시하지 않으며 오류와 한계를 남긴다.
  이전 iteration의 “YouTube 복구 전 재개 불가”는 이 사용자 변경으로 대체됐다.
- 동일 테스트 Chrome을 확장/companion/모델 없이 재검증했다. Waldinger YouTube
  마지막 정상 sample은 미디어 34.221초, 관찰 35.001초에 같은 오류/time 0/
  duration NaN/paused true가 됐고 관찰 70초까지 유지됐다. 관측한 googlevideo
  요청 16개는 HTTP 200, page errors는 없었다. 번역/캡처 없이 재현되므로 모델
  부하가 필수 원인은 아니다. YouTube/브라우저/network 내부의 정확한 원인은
  여전히 미확인이고 사용자의 일반 Chrome은 시험하지 않았다.
- 대체 영상은 같은 Waldinger 강연의 TED 공식 페이지다(항목 8 URL).
  같은 테스트 Chrome의 별도 세션, 확장/모델 없이 optional cookies 거부 후
  실제 Unmute를 눌렀다. 약 15초 광고는 제외하고 duration >=600초의 본 영상만
  샘플링했다. 본 영상 duration 757.341초, 90개 1초 sample에서 미디어
  8.179→97.179초/진행 89.000초, rate 1/unmuted/중단 sample 0/media error 0.
  hls.ted.com/pu.tedcdn.com HTTP 200, YouTube iframe 0을 확인했다.
  **재생 후보 확인만 했으며 실제 캡처/번역/10분 검증 성공은 아니다.**
- 두 baseline의 numeric JSON과 명령/한계를 docs/verification/playback 및
  docs/verification.md에 보존했다. 테스트 browser 세션은 종료했다.
  기존 YouTube harness는 origin/단일 video/theatre 가정 때문에 TED URL을 바로
  받을 수 없다. 항목 8에서 본 영상 선택과 동일 600초 assertion을 지원하는 작은
  검증 경로 및 README 명령을 추가해야 한다. 임의 caption이나 seek/loop로 대체하지 않는다.
- 제품 코드/runner/tests/기존 실패 증거는 변경하지 않았고 새 항목을 체크하지 않았다.
  문서/증거 변경이므로 npm run verify는 재실행하지 않는다. 문서 diff, JSON과 링크를
  검증한다. **다음 미완료 작업은 7a**이며 7b/8/9/최종 완료가 남아 있다.

### Ralph iteration 1/30 — 2026-10-06 — 항목 7a 번역 streaming 진척

- 지정 checkout만 사용했다. AGENTS.md는 없고 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  **다음 미완료 7a만 진행했으며 아직 체크하지 않았다.** 플랜의 큰 항목 분할 규칙에
  따라 이번 iteration은 기존 TextTranslator의 Ollama 출력 streaming부터 구현했다.
  다른 agent/worktree/push/cloud API/credential 파일/사용자 음성은 사용하지 않았다.
- 기존 feature-local adapter가 final 원문당 단일 요청의 NDJSON content를 누적해
  같은 utterance ID/증가 revision의 partial과 final을 전달한다. final만 문맥에 넣는다.
  새 모델/framework/capture/output 계약은 없다. Stop의 HTTP 정리/늦은 byte 거부,
  EOF/잘못된 record/빈 응답/token 제한 오류 및 전체 30초 deadline을 구현했다.
- 변경 전 gated partial regression은 실제 exit 1(6 failed/4 passed)로 재현했다.
  신규 13 cases는 조기 partial/단일 요청/같은 cue/문맥 final-only, UTF-8 분할/
  긴 번역 무손실/Stop/취소를 무시하는 늦은 byte/불완전 응답/실제 30초 trickle 제한을
  검증한다. 기존 ASR queue/native 취소와 session/output 교체 테스트는 유지했다.
- 실제 cached MLX Qwen3-ASR 0.6B 8bit + Ollama qwen3:4b-instruct Q4_K_M으로
  같은 macOS Samantha 165 wpm 영어 2문장을 각 4회, 실제 20ms paced PCM으로 비교했다.
  Apple M5/16 GiB, Python 3.12.15/mlx-audio 0.5.8/Ollama 0.35.1이다.
  cold 1 + warm 7 sample씩, source English/target Korean, silence 500ms/최대6초는 동일.
  ASR와 한국어 final의 날씨/점심 뒤 공원 산책 의미를 terminal에서 검토했고 양쪽 final은
  동일했다. docs/verification/latency의 JSON은 숫자만 보존한다. 생성 음성은 ignored
  TemporaryDirectory 안에서만 사용하고 제거했다. 실제 사용자 음성/전사문은 없다.
- **session-event 실측이며 browser 표시 실측이 아니다**: warm first p50/p95
  1047.491/1233.221 → 758.851/886.182 ms(n=7), first p50 27.6% 개선이다.
  warm final 1047.491/1233.221 → 1066.540/1194.256 ms라 완료 속도 개선 보장은 없다.
  첫 partial은 한국어 한 token일 수 있다. VAD/worker 대기는 여전히 501–502ms이다.
  drop 0/pending-at-end 0이나 sparse single-phrase run의 queue peak/장시간 증거는 아니다.
- cold first/final은 before 20429.637/20429.637, after 2889.352/3135.662 ms(n=1).
  ASR load/import/compile 17775.097→1512.083 ms가 큰 차이이고 OS/MLX cache를
  지우지 않았으므로 이 차이를 streaming/cold-start 개선으로 주장하지 않는다.
  after 마지막 sample의 browser fixture 시작과 겹침 등 한계도 docs/verification.md에
  명시했다. event 측정을 실제 DOM paint/audio-end→보이는 자막 p50/p95로 대체하지 않는다.
- `npm run test:captions-browser` exit 0: Chrome for Testing 153.0.8010.12의 built
  DOM sink normal/narrow/wrapper fullscreen, revision 교체/오래된 revision 거부,
  긴 final cue 모든 문자/컨트롤 클릭/만료/Stop/늦은 caption 거부 통과. 생성 cue이며
  실제 capture/번역/원음 청취 증거가 아니다. 기존 PNG 변경/새 시각 검토 주장은 없다.
- 첫 lint의 8개 line-length 실패를 수정했다. 첫 full verify는 OpenAI-ASR→local
  text fixture에 Ollama done marker가 없어 1 failed/142 passed/exit 1이었다.
  실제 terminal protocol marker를 넣고 원문/ID/final/단일 요청/오디오 미전송 assertion은
  유지했다. focused provider 3 cases 통과 후 전체를 재실행했다.
- 최종 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify` exit 0: lint/typecheck/build,
  JS 9 + Python 143 tests, failures/skips/warnings 0(Python 65.99초).
  `uv lock --check`, `git diff --check`, numeric JSON sample/percentile consistency,
  최종 Ruff 통과. dependency/lockfile 변경 없음. browser/Ollama를 종료했고
  8765/8766/11434 listener 없음. `.ralph`/audio/model/key는 커밋하지 않는다.
- **다음 iteration도 7a**: 명시 Start 준비 중 작은 local 모델 준비/취소/오류 처리,
  같은 음성으로 silence 250–300ms 후보 비교(6초 최대 구절은 의미 확인 없이 줄이지 않음),
  native Chrome tabCapture에서 revision-aware first/final **실제 paint** 변경 전후
  p50/p95/cold/warm/sample/queue/drop 및 audible 원음/의미/streaming 긴 cue/Stop/
  session 교체를 검증해야 한다. 현재 7a acceptance 전체는 미통과이며 외부 blocker는 없다.
  README 재현 명령과 docs/verification.md 상세 근거를 보존했다. 7b/8/9/최종 완료는 남았다.

### Ralph iteration 2/30 — 2026-10-06 — 항목 7a Start 모델 준비 진척

- 지정 checkout만 사용했다. AGENTS.md는 없고 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  다음 미완료 **7a의 명시 Start 모델 준비 단계**를 구현했다. 큰 항목 분할 규칙을
  적용하며 **7a checkbox는 미체크로 유지**한다. 다른 agent/worktree/push/runner 변경/
  credential 파일/cloud inference/사용자 음성은 사용하지 않았다.
- 기존 local adapter/session에서 cached MLX를 기존 단일 worker에 로드하고,
  Ollama는 동일 4096 context의 빈 messages 요청으로 준비한다. 준비 중 caption/
  합성 ASR 입력은 없으며 새 provider framework/공통 계약은 없다. cloud 모델에는
  준비 API를 호출하지 않는다. 500ms silence와 최대 6초 구절은 아직 유지했다.
- companion의 ready는 준비 완료 뒤 전송하며 준비 전체는 60초로 제한한다.
  offscreen은 65초 한도에서 상태/실제 오류를 보여주고 완료 뒤에만 worker에서
  새 stream ID를 얻어 audio source를 시작한다. token은 준비 전 인증에서 소비한다.
  popup Stop/설정 변경, 탭 이동/닫기는 pending Start를 취소하며 queue 뒤에서 기다리지
  않는다. MLX native loading은 취소 뒤 끝날 수 있으나 기존 executor 직렬화와 세션
  generation 검증으로 늦은 ready가 녹음을 시작하지 못한다.
- 구현 전 준비 regression 7개 모두 실패(exit 1)했다. 구현 후 준비 Python 10 cases는
  모델 선택/빈 preload/worker 실행/5가지 Ollama 오류/취소/ready 순서와 오류 시 미준비/
  restart/disconnect 중 native 직렬화를 검증한다. 새 JS offscreen test는 준비 전
  stream/getUserMedia 0, model 오류 원문, Stop/late-ready 거부, ready 뒤 stream 획득을
  확인한다. 기존 worker test에 준비 중 Stop/configure interruption을 추가했다.
- `npm run test:settings-browser` 최종 exit 0: built popup의 gated 준비 중 Stop/설정
  변경, 기존 persistence/POST/validation cleanup/DOM memory fan-out/HTML injection/
  session 교체 checks 통과. Chrome for Testing 153.0.8010.12/Playwright 1.63.0.
  fixture 검증이며 모델 inference 성공으로 기록하지 않았다.
- 실제 native toolbar Start → “Preparing translation session…” → native Stop → idle을
  확인했다. `test:local-browser`의 stopped는 active capture 없음/offscreen 0/host 0을
  통과했다. 두 번째 native Start에서 모델 준비 뒤 실제 tabCapture가 성공했고 popup을
  닫은 상태로 macOS Samantha 165 wpm 비민감 날씨/공원 음성이 실제 두 모델을 거쳐
  한국어로 표시됐다. 첫 partial receipt 900 frames/432,000 samples/peak 25,160,
  replay check 1750 frames/840,000 samples에서 맑은 날씨/점심 후 공원 산책 의미를
  메모리의 실제 한국어 text로 검토했다. 마지막 native Stop의 cleanup도 통과했다.
  final interactive harness exit 0. Apple M5/16 GiB, Python 3.12.15/mlx-audio 0.5.8/
  Ollama 0.35.1, 기존 cached 0.6B 8bit ASR/Q4_K_M text, English→Korean이다.
- docs/verification/latency/prepared-partial.png를 view_image로 검토했다. 읽히는 하단
  중앙의 흰 outline 자막/작은 어두운 배경이며 control과 떨어져 있다. **미완성 날씨
  partial screenshot**이므로 final 의미/전체 자막 appearance acceptance로 쓰지 않는다.
  기존 local/normal.png는 원래 byte로 복원했다. 생성 오디오는 ignored profile 안이다.
- 정확한 한계: 이번에는 준비 시간/first-final paint p50/p95/cold-warm 비교/queue peak/
  긴 cue streaming 비교/새 원음 청취를 측정하지 않았다. unmuted/PCM 도착을 사람이
  들은 증거로 대체하지 않는다. 준비 loading은 첫 inference compilation을 제거하지
  않으며 이 단계의 지연 개선 수치는 주장하지 않는다. 기존 event 실측은 보존한다.
- 실패 수정: Python line length, 취소된 Start가 transient starting을 반환하는 JS 회귀,
  unknown provider의 ready-before-error를 가정한 fixture(이제 invalid 선택은 ready 없이
  error/secret sanitation/close/restart를 확인)를 고쳤다. 첫 full verify는 1 failed/
  152 passed/exit 1, 수정 후 focused 2 cases와 전체가 통과했다. 최초 noninteractive
  local harness는 stdin EOF로 exit 1, PTY 재실행은 성공했다. local fixture가 8766을
  사용 중인 settings-browser 실행은 exit 13; 종료 후 재실행 성공했다. tests/runner/
  acceptance를 약화하지 않았다. 상세 명령/실패/한계는 docs/verification.md에 있다.
- 최종 base `uv sync --locked` 후 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`
  exit 0: lint/typecheck/build, **JS 10 + Python 153**, failures/skips/warnings 0,
  Python 66.08초. `uv lock --check`, `git diff --check` 통과. dependency/lock 변경 없음.
  dedicated browser/companion/fixture/Ollama를 종료했고 8765/8766/11434 listener 없음.
  키/가중치/오디오/사용자 전사문/임시 .ralph는 커밋하지 않는다.
- **다음 iteration도 7a, 외부 blocker 없음**: 같은 생성 음성으로 500ms와 250–300ms
  silence 후보의 의미/구절 분할/ASR 품질을 비교하고 근거가 있을 때만 적용한다.
  native Chrome tabCapture의 revision-aware first/final 실제 paint를 계측해 변경 전후
  p50/p95/sample/cold-warm/queue-drop을 기록해야 한다. 이전 commit의 이벤트 baseline은
  paint 측정이 아니므로 대신 쓰지 않는다. 긴 cue 무손실/partial-final 교체/Stop 및
  provider 교체 후 늦은 결과/원음 청취/bounded queue acceptance도 완료해야 한다.
  이 준비 단계는 끝났으므로 다시 구현하지 않는다. README의 local-browser 재현 명령,
  기존 tests/local-latency.py와 numeric events, tests/browser_metrics.py를 출발점으로
  사용한다. ASR 파일 token streaming을 live PCM ASR로 표현하지 않는다.
  7b/8(TED 600초)/9와 최종 완료는 남아 있다.

### Ralph iteration 3/30 — 2026-10-06 — 항목 7a VAD 실측/300ms 진척

- 지정 checkout만 사용했다. AGENTS.md는 없으며 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  다음 미완료 **7a만 진행**, 큰 항목 분할 규칙에 따라 **checkbox는 미체크로 유지**한다.
  다른 agent/worktree/push/runner 변경/credential 파일/cloud inference는 사용하지 않았다.
- 같은 생성 음성/실제 cached MLX Qwen3-ASR 0.6B 8bit + Ollama
  qwen3:4b-instruct Q4_K_M으로 500/300/260ms silence를 비교했다. 모델 준비/streaming/
  English→Korean/최대 6초는 동일하다. Apple M5/16 GiB, Python 3.12.15,
  mlx-audio 0.5.8/Ollama 0.35.1. macOS Samantha 165 wpm 세 clip을 후보마다
  3회, 후보 순서를 회전해 **warm 9 runs/12 cues씩**, 총 27 runs/36 cues 실측했다.
  긴 clip은 부정/이유절 사이에 추가 240ms pause가 있으며 6초를 넘는다.
  생성 audio는 ignored TemporaryDirectory 종료 시 제거했고 text는 terminal에서만
  의미를 검토했다. numeric JSON은 docs/verification/latency/vad-events.json이다.
- **session-event 실측, browser paint가 아니다**: warm first p50/p95
  500ms 680.591/811.228 → 300ms **493.693/586.934 ms(n=12)**, p50 27.46% 개선.
  final은 985.087/1139.874 → **790.330/1113.188 ms**. 260ms first는
  454.747/548.191, final 739.896/1107.732 ms로 더 빠르다. 짧은 pause 허용을
  더 유지하는 300ms를 선택했으며 260ms 실제 ASR 품질이 나쁘다는 근거는 없다.
  VAD/worker p50은 502.372→302.202ms. ASR/translation 시간과 원시 sample/분포/
  정확한 한계는 docs/verification.md에 있다. translation-to-first/final 값은 기록한
  event−VAD/worker−ASR의 산술 파생값이며 후처리와 harness에 같은 산식을 넣었다.
- local silence를 기존 feature-local SpeechSegments에서 **15×20ms**로 바꿨다.
  OpenAI live ASR는 명시적으로 기존 25×20ms를 유지하며 기존 64 PCM frame/commit
  assertion을 변경하지 않았다. 6초 cap/pre-roll/최소 speech/queue budget/model/
  capture/output 계약은 동일하며 새 설정 UI/framework는 없다.
- 준비 뒤 첫 500ms weather warm-up은 n=1 first/final 15308.749/15546.209ms,
  ASR 14670.100ms, 전체 준비/audio 포함 21692.324ms이며 warm에서 제외했다.
  하나의 shared engine이고 OS/model cache를 지우지 않았으므로 cold 후보 비교/
  cold 개선으로 주장하지 않는다. Start 준비는 첫 inference compilation을 제거하지
  않는다. 각 warm run utterance drop 0/끝 pending 0/sampled queue peak 최대6000ms.
  sparse sample이며 transport frame drop/원음 playback/장시간 queue는 미측정이다.
- 날씨/점심 후 공원 원문과 한국어 finals는 모든 후보/반복에서 같고 의미가 맞다.
  **긴 clip의 기존 품질 실패도 모든 후보에서 같았다**: 6초 cut에서 station이
  사라지고 번역에 일본어가 섞였다. 부정/정오 전 비 그침/파란 우산/오후3시는
  유지됐지만 전체 의미 보존 acceptance는 실패다. 동일한 불완전 baseline을
  통과 근거로 쓰지 않는다. 최대 길이를 무작정 줄이지 않았고 품질 수정을 다음
  7a 작업으로 남겼다. 외부 blocker가 아니라 구현/검증 가능한 문제다.
- 변경 전 300ms flush regression은 1 failed/1 passed/13 deselected/exit1로
  재현했다. 변경 후 focused local/live/prepare/stream **59 passed/60.71초/exit0**:
  300ms 즉시 flush, 240/280ms 내부 pause 유지, silence/noise/gap/6초 cap,
  slow-ASR bounded queue/Stop/late result/stream completion/기존 live commit 통과.
  `npm run test:captions-browser` exit0: Chrome for Testing 153.0.8010.12에서
  normal/narrow/wrapper fullscreen/revision 교체/오래된 revision/긴 final 모든 문자/
  controls/만료/Stop/늦은 caption 통과. fixture caption이며 real paint/audio/의미
  성공으로 기록하지 않았다. PNG는 동일 byte이며 새 시각 검토 주장은 없다.
- 최종 base `uv sync --locked` 후 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`
  exit0: lint/typecheck/build, **JS10 + Python156**, failures/skips/warnings0,
  Python66.02초. 최종 Ruff/uv lock --check/git diff --check/numeric consistency 통과.
  dependency/lock 변경 없음. 모델 process/browser/Ollama 종료, 8765/8766/11434
  listener 없음. README 재현 명령과 docs/verification.md를 갱신했다.
  키/모델/audio/사용자 전사문/임시 .ralph는 커밋하지 않는다.
- **다음 iteration도 7a**: 새 긴 생성 fixture에서 드러난 6초 cut의 정보 손실과
  번역 품질을 먼저 재현/수정하고 무손실 의미를 검증한다. 이후 native Chrome
  tabCapture의 revision-aware first/final **실제 paint**를 같은 음성/설정의 변경
  전후로 측정해 p50/p95/sample/cold-warm/queue-drop을 기록한다. event baseline을
  paint로 대신하지 않는다. 실제 원음 청취/긴 cue/partial-final/Stop 및 session
  교체 뒤 늦은 결과 거부를 함께 확인해야 checkbox를 바꿀 수 있다. 이번 300ms
  후보 비교/선택은 끝났으므로 다시 구현할 필요가 없다. 7b(Source Auto),
  8(TED 연속600초), 9/최종 완료는 남아 있고 외부 blocker는 없다.

### Ralph iteration 4/30 — 2026-10-06 — 항목 7a 긴 구절 품질 수정

- 지정 checkout만 사용했다. AGENTS.md는 없으며 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  다음 미완료 **7a만 진행**, 큰 항목 분할 규칙에 따라 **checkbox는 미체크로 유지**한다.
  다른 agent/worktree/push/runner/acceptance 변경/credential 파일/cloud inference는 없다.
- 기존 긴 생성 clip의 6초 경계가 station을 자르고 ASR/번역에서 장소를 누락하며
  일본어를 섞는 실패를 실제 두 모델로 재현했다. **warm 3회 모두 실패**했다.
  local segment에서 4초 이후 100ms VAD pause를 우선 사용해 단어 중간 hard cut을
  피한다. 기존 6초 hard cap/300ms 정상 silence/최소 speech/pre-roll/단일 worker/
  큐 예산은 유지한다. 문장 분석기가 아니며 무중단 발화는 여전히 hard cut에 도달한다.
  OpenAI live ASR는 이 local 경계를 끄고 기존 500ms commit/PCM protocol을 유지한다.
- split만 바꾼 probe는 원문을 복구했으나 noon을 오후 시간으로 잘못 번역했다.
  Ollama의 기존 system 지침에 절별 정확한 의미/명확한 시간/선택한 목표 언어만
  사용하라는 작은 지침을 추가하고 실제 ASR/session에서 다시 검증했다.
  원문당 단일 streaming 요청/final-only 문맥/Stop/모델/temperature/token/context는
  동일하다. capture/model/output 계약/새 모델/provider framework는 추가하지 않았다.
- 새 tests/local-boundary-quality.py의 변경 전후 실제 실행은 모두 exit0이다.
  같은 Samantha 165wpm weather/park/긴 clip을 각3회, **phase당 warm9 runs/12 cues**,
  별도 첫 weather inference1회로 측정했다. clip2의 추가 pause는240ms이다.
  **모든 PCM SHA-256이 phase 사이 일치**한다. Apple M5/16GiB,
  Python3.12.15/mlx-audio0.5.8/Ollama0.35.1, cached 0.6B8bit ASR/
  qwen3:4b-instruct Q4_K_M, English→Korean,20ms paced PCM이다.
  offline flags/loopback/Ollama cloud disabled이며 generated audio는 ignored
  TemporaryDirectory 종료 시 제거했다. 생성 ASR/final text는 terminal에서만 검토했다.
  docs/verification/latency/boundary-before.json과 boundary-after.json은 숫자/boolean/
  모델 정보/파형 hash만 저장한다. 실제 사용자 audio/transcript는 사용하지 않았다.
- 수정 후 **warm9회 전부 source/한국어/품질 checks 통과**했다. 긴3회 모두 부정/
  이유/정오 전(오후12시 전 표현)/파란 우산/역/오후3시 의미가 유지되고 일본어가 없다.
  첫 clip source 구간0–3880ms, 다음4000–7660ms이며 중간은 검출한 pause다.
  날씨/점심 뒤 공원 산책 의미도 검토했다. 공원 번역은 직역 미래형 대신 “걷기로 했다”
  표현이므로 모델 전반 정확도/모든 긴 발화 무손실을 보장하지 않는다. keyword check만으로
  의미 성공을 주장하지 않는다. 기존 긴 clip regression 수정은 완료했으므로 재구현 불필요.
- **session-event 실측, browser paint가 아니다**: warm pooled first p50/p95
  535.211/590.043→542.207/643.179ms(n12), final780.227/1191.393→
  944.816/1125.235ms이다. **pooled 지연 개선은 주장하지 않는다**. 긴 clip 시작→
  첫 cue는6358.341/6361.030→4293.955/4296.307ms(n3)로 먼저 오지만 구간도 달라졌다.
  더 많은 의미를 복구한 두 번째 cue의 번역량은 증가했다. 지침/경계를 함께 변경했으며
  일부 after sample에 fixture/browser 검사도 겹쳐 고립된 속도 benchmark가 아니다.
  첫 inference는 별도 기록하고 caches를 지우지 않아 cold 비교/개선은 주장하지 않는다.
  warm queue peak6000→4000ms/drop0/pending-at-end0이며 장시간/transport drop은 아니다.
- 변경 전 새 brief-pause regression은1 failed/1 passed/16 deselected/exit1이었다.
  수정 후 focused local/live/prepare/stream **62 passed/60.78초/exit0**이다.
  새 검사는 경계 양쪽 모든 frame/voice 재개/gap reset 및 live ASR 동일 pause의
  265 PCM frame 단일 commit을 확인한다. 기존 hard cap/short pause/slow queue/Stop/
  native 직렬화/늦은 결과/stream 오류/deadline 검사를 유지했다. Ruff line-length
  실패(harness3/adapter2)를 수정했고 assertion을 약화하지 않았다.
- `npm run test:captions-browser` exit0: Chrome for Testing153.0.8010.12의
  normal/narrow/wrapper fullscreen/revision/긴 final 모든 문자/controls/expiry/Stop/
  늦은 caption 거부 통과. generated caption fixture이며 실제 Chrome capture/paint/
  청취 증거가 아니다. PNG는 기존 byte이고 새 시각 검토는 없다.
- 최종 base `uv sync --locked` 후 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`
  exit0: lint/typecheck/build, **JS10+Python159**, failures/skips/warnings0,
  Python66.04초. 최종 Ruff/py_compile/uv lock --check/git diff --check와
  독립 numeric/hash/percentile/품질/queue 일관성 검사 통과. measured run 뒤 추가한
  harness report/hash assertion도 실제 JSON으로 검증했으며 새 실측이라고 주장하지 않는다.
  dependency/lock 변경 없음. model process/browser/Ollama 종료,8765/8766/11434
  listener 없음. docs/verification.md와 README에 명령/실패/결과/한계를 보존했다.
- **다음 iteration도 7a, 외부 blocker 없음**: 이제 native Chrome tabCapture의
  revision-aware first/final **실제 paint**를 같은 음성/설정의 변경 전후로 측정해
  p50/p95/sample/cold-warm/queue/drop을 기록한다. 기존 session-event baseline은
  paint로 대체하지 않는다. 실제 원음 청취/streaming 긴 cue/partial-final/Stop 및
  session 교체 뒤 늦은 결과 거부를 함께 확인해야 checkbox를 바꿀 수 있다.
  tests/local-browser.mjs,tests/browser_metrics.py,기존 local-latency.py를 출발점으로
  사용한다. 7b(Source Auto),8(TED연속600초),9/최종 완료는 남아 있다.

### Ralph iteration 5/30 — 2026-10-06 — 항목 7a 실제 Chrome revision paint 실측

- 지정 checkout만 사용했다. AGENTS.md는 없고 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  다음 미완료 **7a만 진행**, 큰 항목 분할 규칙에 따라 **checkbox는 미체크로 유지**한다.
  다른 agent/worktree/push/runner/acceptance 변경/credential 파일/cloud inference는 없다.
- 기존 local-browser에 작은 test-local CDP Paint 계측을 추가했다. 실제 built content
  sink 뒤 test listener가 session/utterance/revision/final/visible cue bounds를 mark하고,
  같은 main frame에서 cue 전체를 덮는 실제 Chromium Paint를 다음 caption/start/clear
  mark 전까지만 연결한다. rAF/서버 event를 paint로 대체하지 않는다. missing paint는
  null이며 다른 frame/작은 paint/교체된 revision/hidden cue 거부 regression이 통과했다.
  production capture/model/output 계약/구현과 dependency는 바꾸지 않았다.
- `node tests/local-browser.mjs before`/`after` 실제 두 실행 exit0. 각 전용 headed
  Chrome에서 **native toolbar Start**→popup 닫기→`measure`→**native Stop**→
  `stopped`→`exit`를 실행했다. 첫 baseline의 `check`와 after의 `accept`에서도 active
  native tabCapture를 확인했다. 실제 PCM과 실제 cached 두 모델이며 fake caption/
  microphone 대체는 없다. Chrome for Testing153.0.8010.12/Playwright1.63.0,
  AppleM5/16GiB/Python3.12.15/mlx-audio0.5.8/Ollama0.35.1,
  0.6B8bit ASR/qwen3:4b-instruct Q4_K_M/context4096, English→Korean이다.
  HF offline/Ollama cloud disabled이며 audio는 ignored profile 안에만 있다.
- **controlled baseline이며 historical build가 아니다**: before는500ms silence와
  partial delivery withholding, after는300ms와partial delivery다. 양쪽 모두 현재
  prepared models/품질지침/streaming model request/quality boundary/6초 cap이다.
  silence+표시 streaming의 합친 차이를 비교하며 준비 개선 효과를 주장하지 않는다.
  sequential phase/별도 companion/기존 OS-model cache 한계를 기록했다.
- 같은 Samantha165wpm 날씨/공원 WAV hash가 양쪽 일치한다. phase당 **warm6 cues**
  (2clips×3회), 별도 first-inference1이다. 실제 **Paint start** first p50/p95
  **1277.630/1432.930→632.452/908.936ms**, final
  **1277.630/1432.930→1018.584/1374.987ms**, n6씩이다.
  warm first p50은50.50% 감소했다. after의 모든 cue는 partial paint 뒤 증가 revision의
  final paint가 왔고 전체 mark의 missing/coalescing0이었다. 원시 numeric/identity/
  geometry evidence는 docs/verification/latency/paint-before.json,paint-after.json이다.
  생성 날씨/점심 뒤 공원 의미를 모든 final에서 terminal로 검토했다.
- 정확한 한계: Paint start는 실제 rendering event지만 GPU완료/화면 presentation/
  pixel 도달 시각은 아니다. PCM첫 frame receipt의 timestamp−20ms로 epoch origin을
  추정하므로 transport/clock scheduling 오차가 남는다. partial마다 OCR한 것은 아니다.
  모델 준비 뒤 first-inference before first/final16089.145/16089.145ms,
  ASR15087.544ms; after1312.109/1687.763ms,ASR937.222ms(n1씩)은 warm에서 제외했다.
  caches/compile 차이이므로 cold 개선을 주장하지 않는다. native Start 준비/loading
  elapsed는 미측정이다. 0ms 보장/실측 위조는 없다.
- 각 phase sampled pending queue peak0ms, frame/utterance drop0이다. receipt50frames
  간격의 짧은 isolated clips이며 continuous peak/600초 안정성의 근거가 아니다.
  두 native Stop 모두 idle/active capture없음/offscreen0/caption host0을 통과했다.
  after timing 뒤 `play`는 마지막 선택 park clip을 재생했고 `accept`의 실제 Korean
  screenshot은 docs/verification/latency/paint-after.png다. view_image로 전체 공원
  문장의 읽히는 흰 outline/작은 어두운 배경/하단중앙/controls와 분리됨을 검토했다.
  receipt3350frames/1,608,000samples/peak25,409. normal short cue 증거이며 긴 cue/
  fullscreen/원음 speaker 청취를 새 통과로 기록하지 않는다. UI inspection은 sound를
  제공하지 않으므로 unmuted/PCM을 사람 청취의 근거로 대체하지 않았다.
- focused analyzer/lint/typecheck/build와 실제 model runs가 실패 없이 통과했다.
  초기 read가 존재하지 않는 dom-sink.ts를 참조했으나 실제 overlay.ts를 읽어 수정했다.
  최종 base `uv sync --locked` 뒤 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`
  exit0: **JS11+Python159**, failures/skips/warnings0,Python66.11초.
  `uv lock --check`, `git diff --check`, 독립 numeric/hash/percentile/revision/latency/
  queue consistency 통과. dedicated browsers/companion/fixture/Ollama 종료,
  8765/8766/11434 listener없음. README 재현 명령/docs 상세 근거를 보존했다.
  dependency/lock 변경,키/weights/audio/user transcript/임시 .ralph 커밋은 없다.
- **다음 iteration도7a**: real long-cue streaming의 의미/모든 part 표시, 실제 inference
  진행 중 Stop/restart/provider/session교체 뒤 늦은 결과 거부, 원음 청취와 native Start
  model loading/first inference 대 prepared timing을 확인해야 checkbox를 바꿀 수 있다.
  짧은 동일음성 native revision Paint 비교는 기록했으므로 재구현하지 않는다.
  cold-cache 비교를 기존 compile 차이로 대체하지 않는다. UI에서 소리를 확인하지 못한
  한계를 유지하며 다음 구현/브라우저 작업을 진행할 외부 blocker는 없다.
  7b(SourceAuto),8(TED600초),9/최종완료는 남아 있다.

### Ralph iteration 6/30 — 2026-10-06 — 항목 7a 실제 긴 cue/반복 문맥 품질 수정

- 지정 checkout만 사용했다. AGENTS.md는 없고 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  다음 미완료 **7a만 진행**, 큰 항목 분할 규칙에 따라 **checkbox는 미체크로 유지**한다.
  다른 agent/worktree/push/publish/runner/acceptance 변경/credential 조회/cloud inference는 없다.
- 기존 local-browser에 `stream` 모드/`long` 명령을 추가했다. 실제 built sink 뒤
  test-local listener/MutationObserver가 각 revision과 timer-driven final part를
  관측하고 기존 Chromium Paint 분석기로 같은 frame/범위의 실제 Paint를 확인한다.
  실제 모델 caption만 관측하며 fake caption/새 model/framework/제품 설정은 없다.
  원문/번역/part는 browser 메모리와 의미 검토 terminal에만 남긴다. 커밋할 JSON은
  숫자/boolean/identity/geometry/WAV hash이며 audio는 ignored 전용 profile 안이다.
- 초기 짧은 생성 umbrella/station 음성은 390px와 270px 모두 두 줄 안에 들어갔다.
  두 run은 timed splitting assertion을 그대로 실패했고 native Stop/cleanup 뒤 exit1이다.
  실제 split을 시험하도록 warm coat/여행 목적을 추가한 **5.1014167초** 생성 음성을
  사용했다. 세 번째 run은 source 전체를 복구하고 final을 두 part로 표시했지만
  repetition2에서 coat의 한국어가 잘못되어 의미 assertion 실패/exit1이었다.
- 실제 Ollama adapter에서 정확한 동일 원문/번역 두 쌍의 recent context로 같은
  잘못된 단어를 **3/3 재현**했다. standard-vocabulary 지침 probe도 실제 실패했으며
  제품 prompt에 넣지 않았다. 현재 원문과 완전히 같은 recent source의 context 쌍만
  제외하는 **3줄 수정**으로 중복 예시를 없앴다. 다른 최근 구절/last3 window/원문당
  단일 request/final-only context/model/prompt/options/cancel 계약은 유지한다.
  수정 후 동일 실제 adapter probe **3/3 의미 assertion 통과/exit0**이다.
  request fixture 회귀도 다른 구절 유지/중복 제거/단일 호출/동일 utterance/final을
  확인하며 1 passed다. fixture만으로 모델 의미 성공을 주장하지 않는다.
- 네 번째 실제 browser run `node tests/local-browser.mjs stream` exit0:
  **native toolbar Start**→Preparing/capturing 확인→popup 닫기→`long`→**native Stop**→
  `stopped`→`exit`이다. active native tabCapture/실제 PCM/실제 cached 두 모델이며
  Chrome153.0.8010.12/Playwright1.63.0/AppleM5/16GiB/Python3.12.15/
  mlx-audio0.5.8/Ollama0.35.1, ASR0.6B8bit/qwen3:4b-instruct Q4_K_M/context4096,
  English→Korean/300ms silence/현재 quality boundary/6초 cap이다. HF offline/
  Ollama cloud-disabled이며 microphone/기존 번역을 입력으로 대체하지 않았다.
- 같은 Samantha165wpm 생성 WAV를 **3회**(fresh companion 첫 inference1+이후2) 재생했다.
  모든 source/final을 terminal로 검토해 파란 우산/따뜻한 코트/역/오후3시/여행 목적을
  확인했다. 한국어 finals는 동일하며 일본어가 없다. 일반 모델 정확도를 보장하지 않는다.
  cue마다 **27 partial Paint + final revision28**, **41문자** final의 part 범위는
  **0–29 / 30–40**이고 **6/6 final part Paint**를 확인했다. 각 part 두 줄/좌우 및
  하단 안전 여백/전체 문자 순서/expiry가 통과했다. 숫자 근거는
  docs/verification/latency/stream-long.json이며 독립 identity/revision/range/geometry/
  paint arithmetic/queue 일관성 검사가 통과했다. sampled pending peak0ms/frame drop0/
  utterance drop0은 50frame receipt 간격의 짧은 isolated clips 근거다.
- 270×700의 실제 첫 final-part PNG3개를 view_image로 검토했다. 흰 outline/작은
  어두운 배경/하단 중앙/두 줄 한국어가 읽힌다. 두 번째 part는 DOM 문자/Paint 근거이며
  별도 screenshot/OCR는 없다. Paint start를 GPU 완료/화면 presentation으로 표현하지
  않는다. 새 audio-end p50/p95/cold/loading 개선 수치는 측정하지 않았다. iteration5의
  이전 commit/configuration 비교 수치는 보존하며 이번 context 수정의 속도라고 하지 않는다.
- 네 번의 native Stop은 idle/active capture 없음/offscreen0/host0을 통과했다.
  완료/만료 뒤 Stop이므로 **진행 중 inference 취소/교체/늦은 결과 실측은 아직 아니다**.
  `npm run test:captions-browser` exit0의 normal/narrow/wrapper fullscreen/긴 final
  모든 문자/controls/revision/expiry/clear/늦은 caption은 별도 fixture 근거다.
  focused local/live/prepare/stream **63 passed/60.80초/exit0**, Paint/output unit2 passed다.
- 실제 native capture/popup 닫기 상태에서 생성 음성이 재생되는 동안 비동기 청취 질문을
  보냈으나 답변이 없었다. UI tool에는 speaker audio가 없어 **원음 청취는 미검증**이다.
  unmuted/PCM 도착을 청취 확인으로 바꾸지 않는다. 다른 7a 구현/계측은 계속 진행 가능하다.
- 최종 base `uv sync --locked` 뒤 `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`
  exit0: **JS11+Python160**, failures/skips/warnings0,Python66.23초.
  `uv lock --check`, `git diff --check`, 독립 JSON 검사 통과. 전용 browser/companion/
  fixture/Ollama 종료,8765/8766/11434 listener없음. dependency/lock 변경 없음.
  README 재현 명령/docs 상세 실패·성공·한계를 보존했다. 키/weights/audio/사용자 전사문/
  임시 .ralph는 커밋하지 않는다.
- **다음 iteration도7a**: 실제 inference 중 Stop/restart/provider/session 교체와
  늦은 결과 거부, native Start loading/first inference 대비 prepared timing, 원음 청취
  확인이 남아 있다. 다음 실제 긴 cue가 이전 cue의 timed parts보다 먼저 도착하는
  연속 구절도 확인한다. 이번 isolated final의 모든 문자 성공을 그 overlap 성공으로
  확대하지 않는다. 반복 문맥 품질 수정/isolated 긴 cue real Paint는 완료했으므로
  재구현하지 않는다. 다음 구현/브라우저 검증은 외부 변경 없이 진행 가능하며,
  전체 7a 완료에는 실제 원음 청취 확인이 필요하다. 7b(SourceAuto),8(TED600초),
  9/최종완료는 남아 있다.

### Ralph iteration 7/30 — 2026-10-06 — 항목 7a 실제 inference 중단/재시작

- 지정 checkout만 사용했다. AGENTS.md는 없고 사용자 지침을 적용했다.
  `.ralph/verification.txt`는 `No completion verification attempted in this run.`이다.
  다음 미완료 **7a만 진행**, 큰 항목 분할 규칙에 따라 **checkbox는 미체크 유지**다.
  다른 agent/worktree/push/publish/runner/acceptance 변경/credential 조회/cloud 호출은 없다.
- 기존 local-browser에 `lifecycle` 모드를 추가했다. test-local opt-in 계측이 실제
  LocalSession 준비, native MLX transcribe 시작/종료, WS disconnect/session 종료를
  기록한다. production capture/model/output 구현·계약/모델/의존성은 바꾸지 않았다.
  **각3회 Start 모두 실제 native toolbar**에서 fixture를 대상으로 실행했고 popup을
  닫았다. inference 시작/첫 translation partial을 감지한 뒤 자동 Stop/provider 변경은
  inactive test tab의 **실제 popup document control**로 실행했다. 이 test tab은
  Start/가짜 sender/가짜 audio/caption을 호출하지 않으며 종료 뒤 제거했다.
- 첫 lint의 while-expression assignment와 Python import88열 실패를 수정했다.
  첫 실제 browser run은 두 중단/복구를 실행했지만 report의 `assert.ok(asrEnd)`가
  실패했다. 번역 partial 뒤에 ASR 종료가 온다는 잘못된 계측 조건을 고쳤다.
  현재 중단 구절의 latest ASR start와 그 end를 짝짓고, 같은 session의 앞선
  완료 구절 final을 제외해 **현재 구절은 final 전에 중단**하도록 확인한다.
  native Stop/cleanup 뒤 첫 run exit1; 전체 revised sequence 재실행 exit0이다.
  실패 run을 passing evidence로 기록하지 않는다.
- 두 번째 실제 `node tests/local-browser.mjs lifecycle`의 native Start/close →
  interrupt → native Start/close → recover → replace → native Start/close → recover →
  lifecycle-report → native Stop/stopped/exit가 통과했다. Chrome153.0.8010.12/
  Playwright1.63.0/AppleM5·16GiB/Python3.12.15/mlx-audio0.5.8/Ollama0.35.1,
  cached0.6B8bit ASR/qwen3:4b-instruct Q4_K_M/context4096, English→Korean,
  300ms silence/current quality boundary/6초 cap이다. HF offline/Ollama cloud disabled다.
  Samantha165wpm 생성 날씨/공원 WAV hash는 iteration5 paint-after와 같다.
- 실제 첫 ASR1031.749ms 중 시작8.940ms 뒤 Stop을 요청했다. WS disconnect는
  요청32.933ms 뒤, idle57ms 뒤였고 **native ASR가 disconnect989.876ms 뒤 종료**했다.
  session coroutine은 이미 종료했으며 해당 결과는 caption을 만들지 않았다.
  inactive popup의 Luna 선택은 실제 weather utterance2의 첫 partial emission5.073ms
  뒤였다. disconnect12.977ms/idle34ms 뒤이며 **현재 구절 final 및 이후 caption0**이다.
  저장된 Luna 설정을 확인한 뒤 Local로 되돌렸고 cloud Start/추론은 하지 않았다.
- 두 native restart는 각각 다른 session에서 실제 공원 음성 → 한국어 final을 만들었다.
  각13partial+final revision14 모두 Paint가 있다. park/점심 뒤 걷기 의미를 terminal에서
  검토했으며 기존의 “걷기로 했다” 표현/일반 모델 정확도 한계는 유지한다.
  총29painted caption(14+중단partial1+14), cleanup/new Start 뒤 old-session caption0이다.
  docs/verification/latency/lifecycle.json은 숫자/identity/geometry/hash만 보존한다.
  독립 JSON검사의 시각 arithmetic/identity/cleanup/late trace/recovery Paint/queue/hash는
  통과했다. native restart는 이전 native inference가 끝난 뒤였으므로 **실제 동시
  native-inference/새 준비 대기 증거는 아니다**; 기존 직렬화 fixture는 별도다.
- preparation.start→ready는 최초1597.402ms, 후속7.000/37.586ms(n3)다.
  cached model loading이며 native click/offscreen 생성은 제외한다. full Start 시간/
  cold-cache/통제된 준비 전후 비교/p50·p95/새 latency 개선 수치로 표현하지 않는다.
  취소된 첫 inference를 첫-caption sample로 쓰지 않는다. iteration5 first/final
  Paint 개선 실측은 유지한다. sampled pending peak0ms/frame·utterance drop0은
  50frame receipt 간격의 짧은 isolated clips 근거이며 600초 안정성을 뜻하지 않는다.
  두 run의 final native Stop은 idle/active capture없음/offscreen0/host0을 통과했다.
- 별도 captions-browser 첫 run이 긴 final two-line assertion에서 실패/exit1했다.
  diagnostic 추가 serial run은 통과했다. 실제 built sink의 deterministic expiry probe는
  연결된 cue height51/lineHeight43.008px → 만료/분리 뒤 height0/lineHeight빈문자에서
  old predicate=false를 확인했다. 첫 실패의 세부 geometry는 없으므로 expiry race가
  원인이라는 것은 재현 probe와 기존 await 간격에 근거한 해석이다. polling에서
  presence/text/layout을 한 DOM 평가로 읽도록 수정했다. two-line threshold/전체
  문자/expiry assertion은 유지하며 layout 실패 메시지에 수치를 추가했다.
- **다음 iteration도7a**: 연속 실제 긴 구절에서 새 caption이 이전 final timed part보다
  먼저 올 때 모든 문자가 보이는지 먼저 검증/필요한 최소 수정을 진행한다.
  full native Start loading/first-inference 대비 prepared timing과 **원음 청취**는 남아 있다.
  UI tool은 speaker audio를 제공하지 않아 청취 미검증이며 unmuted/PCM을 청취 성공으로
  대체하지 않는다. 실제 inference 중 Stop/streaming 중 provider configuration/restart/
  늦은 native 결과 suppress 근거는 완료했으므로 다시 구현할 필요가 없다.
  다음 independent 구현·계측은 외부 변경 없이 가능하다. 7b(SourceAuto),8(TED600초),
  9/최종완료는 남아 있다. 키/weights/audio/사용자 전사문/임시 .ralph는 커밋하지 않는다.
- 최종 base `uv sync --locked` 뒤 polling 수정 후 `npm run verify` exit0:
  lint/typecheck/build, **JS11+Python160**, failures/skips/warnings0,Python65.99초다.
  수정 전 첫 full verify도66.14초/exit0였다. 수정 후 captions-browser exit0이며
  normal/narrow/wrapper fullscreen/긴 final전체문자/controls/revision/expiry/Stop/
  늦은 caption 검사를 통과했다. fixture evidence이고 실제 capture·청취로 표현하지 않는다.
  PNG byte변경/새 시각검토 없음. `uv lock --check`, `git diff --check`, 독립 numeric/
  hash/paint 검사가 통과했고 browser/companion/fixture/probe/Ollama 종료 뒤
  8765/8766/11434 listener는 없다. README 재현 명령/docs 실패·성공·한계를 보존했다.
