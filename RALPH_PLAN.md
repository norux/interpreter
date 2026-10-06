# Interpreter media framework — Ralph plan

작성일: 2026-10-06. 설계 기준: [media-framework.md](docs/architecture/media-framework.md).
이 plan은 새 프레임워크 구현용이며, 종료된 이전 Ralph 작업을 재개하지 않는다.

## 목표와 범위

PC Chrome·Safari와 아이폰 Safari에서 **현재 페이지의 선택한 영상 하나**를
음성 인식하고 한국어로 번역하는 프레임워크를 구현한다. 공통 코어, 플랫폼 호스트,
영상 입력, 모델 엔진, 출력 계약을 처음부터 분리한다. 첫 실기 대상은 사용자가
지정한 iPhone 18 Pro이며 실제 iOS/Safari 버전은 검증 때 기록한다.
유튜브 전용 기능이 아니라 일반 HTML5 영상으로 시작한다.

기존 macOS companion v0.1.0과 설치 경로를 유지한다. 새 브라우저 전용 빌드는
별도로 만들고, 기존 전체 탭 캡처를 선택한 영상의 PCM으로 표현하지 않는다.
공통 코어에는 Chrome/Safari/DOM/모델 제공자 의존성을 넣지 않는다. 큰 프레임워크의
계약·수명주기·의존성 경계는 설계를 따르되, 확인되지 않은 엔진을 작동한다고 표시하지 않는다.

클라우드 자동 전환, 다른 탭·시스템 오디오 수집, 사용자 음성/전사문 저장,
권한·CORS·DRM 우회, 앱스토어 게시와 새 릴리스는 이번 루프 범위 밖이다.
모델 기본값은 실제 일본어·영어 비교 후 선택하며 2026년 모델 요청도 고려한다.
브라우저에서 실행할 수 있는 형식·연산자·라이선스를 확인하고, 이전 모델보다
무조건 좋다고 가정하거나 현재 MLX/Ollama 가중치를 그대로 브라우저에 넣지 않는다.

## 실행 방법

Node.js 22.12 이상, npm, uv, 로그인한 Codex CLI가 필요하다.
이 브랜치에서 의존성을 설치한 뒤 전체 단계를 순서대로 실행한다.

```sh
npm ci
uv sync --locked
node scripts/ralph-loop.mjs all 5 --dry-run
node scripts/ralph-loop.mjs all 5
```

`all`은 `core → video → chrome → safari → iphone`을 순서대로 실행한다.
`5`는 **단계마다 적용하는 최대 iteration 수**로, 전체 최대 25회다.
한 단계가 완료 검증을 통과하면 다음 단계로 넘어간다. 횟수 소진·차단·실패 시에는
즉시 멈추며 다음 단계를 시작하지 않는다. 같은 `all` 명령으로 재개하면 완료된
단계의 검증을 다시 통과한 뒤 미완료 단계부터 구현을 이어간다.
`--dry-run`은 모든 단계의 프롬프트를 순서대로 출력할 뿐
Codex 호출·검증 실행·파일 변경을 하지 않는다. 이후 단계 프롬프트의 미리보기가
앞 단계 완료를 의미하지는 않는다.

실행기는 설정된 Codex 모델을 사용한다. 각 iteration은 별도 `codex exec`이며
`--search --ask-for-approval never --sandbox danger-full-access`로 실행한다.
권한 사용 범위는 저장소, 일반 의존성/모델 캐시, 명시된 로컬 검증이다.
현재 사용자의 앱·녹화·마운트된 DMG·브라우저 설정을 임의로 바꾸지 않는다.
실제 모델 다운로드는 이 프레임워크 작업에 필요한 후보만 수행하고 이름·용량을 기록한다.

단계 하나만 실행하려면 단계 이름을 지정한다. 이 경우 단계가 끝나면 종료한다.

```sh
node scripts/ralph-loop.mjs core 5
node scripts/ralph-loop.mjs video 5
node scripts/ralph-loop.mjs chrome 5
node scripts/ralph-loop.mjs safari 5
node scripts/ralph-loop.mjs iphone 5
```

앞 단계 체크리스트가 완료되기 전에는 다음 단계를 시작할 수 없다.
`Ctrl+C`로 중단할 수 있다. 중단 후에는 Git 상태와 `.ralph/media-framework/` 로그를
검토하고, 미완료 변경을 정리한 뒤 같은 명령으로 재개한다. 동시에 두 루프를 돌리지 않는다.
실행 중인 runner 파일을 수정하지 않는다.

iteration은 미완료 체크리스트 항목 하나를 구현·검증·기록·커밋하는 한 번의 작업이다.
큰 항목은 여러 iteration으로 나누며, 체크리스트 항목 수가 필요한 iteration 수를
보장하지 않는다. 단계별 진행 순서는 다음과 같다.

| 단계 | 진행 가이드 | 체크리스트 항목 수 |
| --- | --- | --- |
| core | 공통 계약 → 세션/큐/시간 관리 → 자막 정책 → companion 연결 → 회귀 검증 | 5 |
| video | 영상 선택 → 실제 오디오 입력 → 시간 매핑 → 입력 제약 → 선택 영상 검증 | 5 |
| chrome | 모델 로드/캐시 → ASR 비교 → 한국어 번역 → 화면 연결 → 장시간 검증 → 품질 평가 | 6 |
| safari | Safari 빌드 → 번역 엔진 → 영상부터 자막까지 연결 → 실제 Safari 검증 | 4 |
| iphone | 실기 설치 → 모델/성능 확인 → 영상부터 자막까지 연결 → 10분 실기 측정 → 최종 검증 | 5 |

횟수를 늘려도 실제 Safari/iPhone 환경이나 필요한 권한이 없으면 차단으로 종료한다.

## iteration 규칙과 종료

1. AGENTS.md가 있으면 읽고 이 plan과 설계 문서, 선택한 단계의 검증 기록을 읽는다.
2. 선택한 단계의 다음 미완료 항목 하나를 진행한다. 큰 항목은 여러 iteration으로 나눈다.
3. 버그는 먼저 실패하는 회귀 검증을 확보한다. 변경에 맞는 검증을 실행하고 결과를 기록한다.
4. acceptance가 실제로 통과한 항목만 체크한다. 실패·미검증·차단을 구분한다.
5. 아래 양식으로 진척을 기록하고 관련 파일을 Conventional Commit으로 커밋한다.
   관련 없는 사용자 파일은 건드리지 않는다. 실행기는 untracked `.DS_Store`만
   clean-worktree 판단에서 제외하며 삭제하거나 커밋하지 않는다.
6. 루프가 자동 push·배포·앱 설치·에이전트 위임을 하지 않게 한다.

선택한 단계의 모든 항목과 해당 검증이 통과하면 마지막 줄에 정확히 다음을 출력한다.

```text
<promise>RALPH_STAGE_COMPLETE</promise>
```

runner는 체크리스트, 단계별 보고서, `npm run verify`, 해당 단계의
`npm run test:framework:<stage>`, whitespace와 clean-worktree를 다시 검사한다.
검증 명령이 없거나 실패하면 완료가 아니다. 통과하면 **선택한 단계만** 완료로 처리하며
plan을 보존한다. `all` 실행에서만 runner가 다음 단계를 자동으로 시작한다. 마지막 `iphone` 단계가
통과하면 앞 단계의 acceptance와 보고서도 다시 검사한다. 모든 필수 검증이 통과하고
Git 작업이 정리돼 있을 때만 runner가 `RALPH_PLAN.md`를 삭제하고 README의
Ralph 시작 안내 블록을 제거한 뒤 `chore: remove completed framework Ralph plan`으로
커밋한다. runner·설계·검증 기록은 남긴다. 정리 커밋 실패 시 plan/README를 복구한다.
일부 단계 완료·차단·중단·횟수 한도는 plan 삭제 조건이 아니다.

외부 상태나 사용자 입력이 없어서 진행할 수 없으면 구체적인 차단 조건·이미 시도한
검증·재개 조건을 기록하고 커밋한 뒤 마지막 줄에 다음을 출력한다.

```text
<promise>RALPH_BLOCKED</promise>
```

동일한 원인의 실패를 새 근거 없이 반복하지 않는다. 두 번의 독립 시도에서 같은
차단이 확인되면 위 marker로 종료한다. runner도 완료 검증 연속 두 번 실패,
두 iteration 연속 커밋 진척 없음, CLI 실패, 선택한 단계 변경 또는 횟수 한도에서
종료하고 plan과 로그를 보존한다. 이 종료들은 완료가 아니다.
수동 실기 검증은 실제 증거가 없으면 미완료다. 사용자 접근/권한 제한을 다른
도구·프로필·설정 파일로 우회해서는 안 된다.

## 검증 기록 계약

각 단계는 `docs/verification/media-framework/<stage>.md`를 만든다.
명령, 실제 실행 환경, 통과/실패/미검증, 수치·스크린샷 등 증거의 위치를 기록한다.
일반 코드 검증과 실제 영상 PCM → ASR → 번역 → 화면 검증을 분리한다.
사용자 음성·전사문·키는 커밋하지 않고 합성 fixture와 수치 증거를 사용한다.

단계 구현 중 다음 npm 명령을 실제 acceptance harness로 추가한다. 완료 marker를
받은 runner가 이 명령을 다시 실행한다. placeholder, 항상 성공하는 스크립트,
기록 파일 존재만 검사하는 스크립트로 대체하지 않는다.

| 단계 | acceptance 명령 | 핵심 관측값 |
| --- | --- | --- |
| core | `npm run test:framework:core` | 브라우저 없는 코어 빌드, 수명주기·revision·epoch·취소·자막 정책 회귀 |
| video | `npm run test:framework:video` | 실제 영상 PCM, 선택한 영상만 처리, 시간 매핑, 원래 재생 유지 |
| chrome | `npm run test:framework:chrome` | 보조 앱 없는 실제 일본어/영어 영상 → 한국어 자막, 모델 준비·Stop |
| safari | `npm run test:framework:safari` | 실제 Safari의 입력·엔진·표시 경로와 설치/수명주기 |
| iphone | `npm run test:framework:iphone` | 연결된 실기의 설치·영상·엔진 검증; 없는 실기를 보고서로 대체하지 않음 |

Safari/iPhone harness에 실제 환경이 없으면 비성공 종료로 보고하고 차단을 기록한다.
mock 이벤트, 데스크톱 mobile viewport, iPhone 시뮬레이터만으로 실제 iPhone의
GPU·메모리·발열·네이티브 전체화면을 검증했다고 표시하지 않는다.
렌더링·메시징 검증은 mock을 쓸 수 있지만 해당 검증 범위를 명시해야 한다.

## Stage core

목표: 기존 동작을 보존하면서 큰 프레임워크의 공통 계약과 코어를 실제 코드로 분리한다.
이 단계에서는 브라우저 모델과 새 영상 캡처를 아직 연결하지 않는다.

- [x] C1. 버전 1 계약을 정의한다: opaque 영상 handle, session/epoch, audio chunk, playback event, 원문/번역 별 revision, capability, status/reason, output. 기존 서버 프로토콜은 companion bridge에서 매핑하며 변경하지 않는다.
- [x] C2. 코어의 session controller·bounded queue·timeline·revision store를 분리한다. DOM/Chrome ambient type 없이 컴파일하고, 늦은 이벤트·준비 중 Stop·연속 Start·탐색 시 취소를 검증한다.
- [ ] C3. 교정 1초 간격, 첫 결과/최종 결과 즉시 반영, 긴 최종 번역 처음부터 순차 재표시, 250ms fade, 최근 300 발화 정책을 코어/renderer 경계로 분리한다. 화면 크기에 따른 line fitting은 renderer가 맡는다.
- [ ] C4. 기존 companion을 combined interpretation adapter로 연결한다. 중복 VAD/ASR을 실행하지 않는다. 서버가 제공하지 않는 ASR-only 이벤트는 capability로 명시하고 원문/번역 짝과 기존 사용자 설정을 보존한다.
- [ ] C5. `test:framework:core`와 코어용 타입/의존성 검증을 추가한다. `npm run verify`, 기존 correction browser 검사와 transcript browser 검사를 실제 실행하고 단계 보고서를 작성한다.

완료 검증: `npm run verify`, `npm run test:framework:core`,
`npm run test:captions-correction-browser`, `npm run test:transcript-browser`.
기존 브라우저 검증 접근이 제한되면 대체 성공을 만들지 않고 차단을 기록한다.

## Stage video

목표: 일반 영상 하나에서 실제 음성을 가져오는 플랫폼 공통 입력을 구현한다.

- [ ] V1. 선택 UI와 MediaCatalog를 구현한다. 영상/문서/frame identity를 갖고, 여러 영상·광고·SPA/iframe에서 자동으로 다른 영상으로 바뀌지 않는다.
- [ ] V2. 같은 출처 일반 영상의 Web Audio 입력을 구현한다. 영상이 이미 소유한 graph와 충돌을 처리하고, Stop·repeat Start 후 원래 재생/볼륨이 유지되는지 실제 소리를 확인한다.
- [ ] V3. playback anchor로 영상 시간과 PCM 시간을 연결한다. seek·pause/resume·rate/source 변경 시 epoch를 바꾸고 이전 작업 결과를 버린다. 서로 다른 context의 performance.now를 직접 빼지 않는다.
- [ ] V4. CORS 허용/미허용, 실제 무음, muted video, 교차 출처 iframe, blob/MSE·보호 영상 경로를 구분한다. 접근을 입증하지 못하면 원래 재생을 건드리지 않고 명시적으로 미지원 처리한다. crossOrigin 재설정/reload로 우회하지 않는다.
- [ ] V5. 일본어/영어 일반 영상 fixture와 동시에 소리가 나는 두 영상 fixture를 추가한다. 선택한 영상의 PCM만 수집되는 것과 재생 유지·시간 매핑을 `test:framework:video`로 검증하고 수치/보고서를 남긴다.

완료 검증: `npm run verify`, `npm run test:framework:video`.
이 단계에서는 인식/번역 품질을 PCM 획득 성공과 혼동하지 않는다.

## Stage chrome

목표: companion/Ollama 서버 없이 실제 영상 음성 인식·번역·자막이 동작하는 Chrome 빌드.

- [ ] B1. browser engine의 execution host/worker와 model repository를 구현한다. 모델 준비의 ID·버전·다운로드·캐시·실제 로드 상태를 표시하고 document/user activation 제약을 처리한다.
- [ ] B2. 일본어/영어를 지원하는 browser ASR 후보를 비교한다. WebGPU/WASM 실제 실행, 메모리와 지연·정확도 증거를 남기고 기본 모델을 선택한다. 큐 과부하·GPU loss·cancel을 검증한다.
- [ ] B3. Chrome Translator document adapter를 구현하고 실제 일본어/영어 → 한국어 지원을 검사한다. 최신 원문 revision과 번역을 정확히 짝짓고 원문을 먼저 표시하며 final 작업이 partial에 밀리지 않게 한다.
- [ ] B4. 새 Chrome 단독 빌드에 선택 영상 입력·엔진·공통 정책·원문/시간/번역 화면을 연결한다. 기존 companion 빌드의 native messaging/설치 경로는 보존하며 새 빌드에는 필요한 권한만 포함한다.
- [ ] B5. `test:framework:chrome`이 companion/Ollama가 없는 환경에서 실제 영상 PCM → ASR → 번역 → DOM을 검증하게 한다. 캐시된 모델 offline run, 첫 다운로드 오류, Stop/재시작, 10분 재생의 backlog/지연/손실을 측정한다.
- [ ] B6. 일본어 부정·취소·시간·미래 의도와 긴 문장 경계, 영어 fixture 품질을 평가하고 수용 기준을 수치와 함께 문서화한다. 실패 문장을 삭제하거나 테스트를 약화시키지 않는다. 기준을 못 맞추면 개선 또는 차단으로 보고한다.

완료 검증: `npm run verify`, `npm run test:framework:chrome`.
모델 smoke 성공만으로 B5/B6를 체크하지 않는다.

## Stage safari

목표: 같은 코어와 일반 영상 fixture를 사용하는 desktop Safari 빌드.

- [ ] S1. Safari host·manifest·웹 리소스·컨테이너 빌드를 추가한다. 실제 Safari에서 권한·메시징·worker/document 수명주기를 검증하고 코어에 Safari 분기를 넣지 않는다.
- [ ] S2. Chrome Translator에 의존하지 않는 browser translation adapter를 구현한다. 일본어/영어 후보의 실제 WebGPU/WASM 호환성·정확도·지연·메모리를 기록한다.
- [ ] S3. 실제 Safari에서 선택 영상 입력 → ASR → 번역 → overlay/comparison을 연결한다. iframe·inline/전체화면 지원 범위, Stop·suspension/recovery를 검증한다.
- [ ] S4. `test:framework:safari`, packaging/install 안내, 단계 보고서를 추가한다. 서명·실제 브라우저·권한이 필요한 검증을 할 수 없으면 정확한 차단 조건을 기록한다.

완료 검증: `npm run verify`, `npm run test:framework:safari`.
Chrome 실행이나 Safari 렌더러 smoke를 전체 Safari acceptance로 대체하지 않는다.

## Stage iphone

목표: 실제 iPhone 18 Pro에서 일반 영상으로 작동하는 Safari 확장 빌드.

- [ ] I1. iOS Safari 컨테이너 빌드와 모바일 비교 UI를 추가한다. TestFlight 게시 없이 가능한 로컬 개발 설치를 검증하고 필요한 개발팀/실기 권한을 기록한다.
- [ ] I2. 실제 iPhone의 iOS/Safari 버전·capability를 측정하고 모바일 모델/profile을 선택한다. 지원 연산자·메모리·저장 공간·모델 캐시/eviction·첫 다운로드를 검증한다.
- [ ] I3. 동일 일반 영상의 실제 PCM → 일본어/영어 ASR → 한국어 번역 → 모바일 화면을 검증한다. seek/pause/rate/source 변경, 두 영상 선택, native fullscreen과 앱 전환/잠금 후 재개를 확인한다.
- [ ] I4. 실제 10분 이상 재생에서 정확도·첫/최종 자막 지연·교정 횟수·backlog/손실·메모리·발열을 기록한다. 아직 측정하지 않은 항목은 미완료로 남긴다.
- [ ] I5. `test:framework:iphone`과 지원 기기/OS/영상 경로 표, 설치 문서와 최종 보고서를 추가한다. 모든 단계 acceptance와 실제 실기 증거가 통과한 뒤 runner의 전체 재검증·plan 삭제·정리 커밋으로 구현을 종료한다. 앱스토어 게시/새 DMG 릴리스는 하지 않는다.

완료 검증: `npm run verify`, `npm run test:framework:iphone` 및 실기 측정 증거.
실기가 연결되지 않았거나 필요한 권한이 없으면 차단으로 종료하고 plan을 보존한다.

## Progress log

초기 상태: 설계 문서와 사용자 제공 기기/일반 영상 범위를 확정했다.
위 구현 체크리스트는 모두 미완료이며 새 Ralph는 아직 시작하지 않았다.

각 iteration은 이 위치에 다음 양식으로 실제 결과를 추가한다.

```text
날짜 / 단계 / iteration / 관련 commit
수행한 변경:
실행한 명령과 결과:
실제 PCM/모델/화면/실기 중 검증한 범위:
실패·미검증과 증거 위치:
다음 미완료 항목 또는 차단 해제 조건:
```

### 2026-10-06 / core / iteration 1/5

관련 commit: 이 기록을 포함한 `feat: define media framework v1 contracts`.

수행한 변경: C1의 ES2022 전용 version 1 계약과 media/engine/model/output 포트,
독립 source/translation revision, pending/paired 상태, clock/epoch, 제한 및
capability를 정의했다. 기존 Caption/PCM1 서버 프로토콜·companion v0.1.0·설정은
변경하지 않았다. 실제 companion bridge 매핑은 C4에서 구현한다. standalone
타입 fixture/의존성 검증과 `test:framework:core`를 추가했다. 현재 harness의 범위는
C1이며 C2–C4의 수명주기/큐/정책 회귀는 구현 후 추가해야 하므로 C5는 미완료다.

실행한 명령과 결과:

- PASS: `npm run test:framework:core` (exit 0, ES2022/no-DOM 타입 검사,
  의존성 검사 1 passed/0 failed, 최종 76.439792 ms).
- PASS: `npm run typecheck && npm run build && npm run test:js` (exit 0,
  19 modules build/271 ms, JS 33 passed/0 failed/0 skipped, 14479.204 ms).
- PASS: `./node_modules/.bin/biome lint extension packages/contracts tests scripts/ralph-loop.mjs vite.config.ts`
  (exit 0, 52 files, 최종 19 ms, no findings).
- FAIL/BLOCKED: `npm run verify` (exit 127, JS lint 통과 후 `sh: uv: command not found`,
  이후 verify 단계 실행 안 됨).
- FAIL/BLOCKED: 독립 시도 `npm run test:python` (exit 127, 동일 `uv` 없음,
  Python 테스트 0 실행). 같은 차단 원인 두 번 확인 후 재시도 중단.
- PASS: `npm run test:captions-correction-browser` (exit 0, Chromium
  153.0.8010.12, 1000 ms 교정·즉시 첫/최종·burst/latest·clear/replacement).
- PASS: `npm run test:transcript-browser` (exit 0, 비교 UI와 실제 extension
  messaging/window 두 script 통과, generated source/translation,
  시간·cadence·safe text·eviction/reopen·stale rejection·Stop retention).
- PASS: `git diff --check` (exit 0, whitespace 오류 없음).

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1; 타입/의존성 및
합성 caption의 브라우저 표시/메시징만 확인했다. 실제 영상 PCM/모델/ASR 정확도,
번역 품질, Safari/iPhone은 미검증. 설치·모델 다운로드·게시 없음.

실패·미검증과 증거 위치: [core 보고서](docs/verification/media-framework/core.md)에
정확한 결과 및 수정된 초기 harness 실패를 기록했다. 로컬 로그는
`.ralph/media-framework/core-1-{contracts,js,verify,python,correction-browser,transcript-browser}.log`
(커밋 제외). transcript 재검증의 nondeterministic runtime window ID만 복원하여
기존 screenshot/JSON을 보존했다. 전체 verify/Python lint/tests 미검증으로
stage 완료는 주장하지 않는다.

다음 미완료 항목 또는 차단 해제 조건: C2 session controller·bounded queue·timeline·revision store.
runner PATH에 `uv`가 준비되면 `uv sync --locked` 후 `npm run verify`를 다시 실행하고
진행한다. C2–C5 및 이후 stage 체크박스는 보존한다.

### 2026-10-06 / core / iteration 1/5 — C2 (재개 run)

관련 commit: 이 기록을 포함한 `feat: implement media framework core lifecycle`.

수행한 변경: 다음 미완료 항목 C2만 구현했다. `packages/core`에 session
controller, 제한된 비동기 PCM queue, clock/epoch timeline, 독립 원문/번역 revision
store를 분리했다. Start마다 engine을 소유하고 Stop은 정리 대기 전에 세션을
무효화한다. seek/rate/source/pause/resume/suspension은 epoch를 먼저 바꾸며,
늦은 준비/input open/result를 차단하고 소유한 input/engine만 정리한다.
queue 초과와 sample gap은 손실 시간을 보고하고 취소·pause하여 자동 재시도를
하지 않는다. 원문 교정 때 번역을 pending으로 바꾸되 번역 revision/final
watermark를 보존한다. 기존 extension 연결은 C4에 남겨 companion 프로토콜,
v0.1.0 배포물과 사용자 설정은 변경하지 않았다.

실행한 명령과 결과:

- PASS: `npm run test:framework:core` (최종 exit 0, ES2022/no-DOM 타입 검사,
  실제 core 5개 모듈의 의존성 검사 포함 14 passed/0 failed/0 skipped,
  105.452542 ms).
- PASS: `npm run verify` (최종 exit 0, Biome 58 files/24 ms/no findings,
  Ruff 통과, extension typecheck/build 19 modules/21 ms,
  JS 46 passed/0 failed/0 skipped/14372.083125 ms,
  Python 222 passed/66.89 s). 이전 `uv` 부재 차단이 해제됐다.
- PASS: `npm run test:captions-correction-browser` (exit 0, Chromium
  153.0.8010.12, 1000 ms 교정, 즉시 첫/최종, burst/latest/in-place/clear/replacement).
- PASS: `npm run test:transcript-browser` (exit 0, comparison/runtime 두 script,
  generated caption의 source/translation/time/cadence/safe text/history/eviction,
  stale rejection/reopen/Stop retention 및 실제 extension messaging/window).
- FAIL → FIXED: `node --import tsx --test --test-name-pattern='overload and sample gaps' tests/framework-core.test.ts`
  (수정 전 exit 1, 0 passed/1 failed/96.354958 ms, 자동 capture 재시도 2개가
  기대값 1개와 달랐다). pause 후 명시적 resume 방식으로 수정했고 최종 core/JS
  검사에 같은 회귀 검사를 포함해 통과했다.
- PASS: `git diff --check` (exit 0, whitespace 오류 없음).

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15. 첫 verify가 worktree의 ignored `.venv`에 locked
의존성 33개를 준비했다. 코어는 합성 100 ms/200 byte PCM과 생성된 caption을
사용해 queue → engine port → revision store → callback 연결 및 동일 clock의
9000–9200 ms 영상 시간 매핑을 확인했다. 실제 영상 음성/ASR/번역 품질 검증이
아니다. 브라우저 검사는 기존 renderer/메시징만 확인했다. 모델 다운로드,
앱 설치·게시·push 및 Safari/iPhone 검증 없음.

실패·미검증과 증거 위치: [core 보고서](docs/verification/media-framework/core.md).
로컬 `.ralph/media-framework/core-1-c2-{framework,verify,verify-final,correction-browser,transcript-browser,loss-regression}.log`
는 커밋하지 않았다. 요청된 `2026-10-06T11-28-49-587Z-core-verification.txt`는
없었다. transcript 재검증의 `closedWindowId`만 바뀌어 신선한 증거를 읽고
해당 JSON을 복원했다. 기존 screenshot/UI JSON은 동일했다. 최종 필수 명령은
모두 통과했지만 C3/C4 정책·companion 연결과 이를 포함한 C5 acceptance는
미완료이므로 stage 완료는 주장하지 않는다.

다음 미완료 항목: C3 교정 cadence, 즉시 첫/최종 반영, 긴 최종 번역의 처음부터
순차 replay, 250 ms fade, 최근 300 발화를 core/renderer 경계로 분리한다.
C3–C5 및 이후 stage 체크박스를 보존한다. 현재 C2 검증의 환경 차단은 없다.
