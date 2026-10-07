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
macOS에서는 runner 전체 수명 동안 화면·시스템 절전 방지 assertion을 유지한다.
iteration 및 stage 사이에도 해제하지 않으며 runner 종료 시 자동으로 해제한다.
시스템의 영구 전원 설정은 변경하지 않는다.

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
- [x] C3. 교정 1초 간격, 첫 결과/최종 결과 즉시 반영, 긴 최종 번역 처음부터 순차 재표시, 250ms fade, 최근 300 발화 정책을 코어/renderer 경계로 분리한다. 화면 크기에 따른 line fitting은 renderer가 맡는다.
- [x] C4. 기존 companion을 combined interpretation adapter로 연결한다. 중복 VAD/ASR을 실행하지 않는다. 서버가 제공하지 않는 ASR-only 이벤트는 capability로 명시하고 원문/번역 짝과 기존 사용자 설정을 보존한다.
- [x] C5. `test:framework:core`와 코어용 타입/의존성 검증을 추가한다. `npm run verify`, 기존 correction browser 검사와 transcript browser 검사를 실제 실행하고 단계 보고서를 작성한다.

완료 검증: `npm run verify`, `npm run test:framework:core`,
`npm run test:captions-correction-browser`, `npm run test:transcript-browser`.
기존 브라우저 검증 접근이 제한되면 대체 성공을 만들지 않고 차단을 기록한다.

## Stage video

목표: 일반 영상 하나에서 실제 음성을 가져오는 플랫폼 공통 입력을 구현한다.

- [x] V1. 선택 UI와 MediaCatalog를 구현한다. 영상/문서/frame identity를 갖고, 여러 영상·광고·SPA/iframe에서 자동으로 다른 영상으로 바뀌지 않는다.
- [x] V2. 같은 출처 일반 영상의 Web Audio 입력을 구현한다. 영상이 이미 소유한 graph와 충돌을 처리하고, Stop·repeat Start 후 원래 재생/볼륨이 유지되는지 실제 소리를 확인한다.
- [x] V3. playback anchor로 영상 시간과 PCM 시간을 연결한다. seek·pause/resume·rate/source 변경 시 epoch를 바꾸고 이전 작업 결과를 버린다. 서로 다른 context의 performance.now를 직접 빼지 않는다.
- [x] V4. CORS 허용/미허용, 실제 무음, muted video, 교차 출처 iframe, blob/MSE·보호 영상 경로를 구분한다. 접근을 입증하지 못하면 원래 재생을 건드리지 않고 명시적으로 미지원 처리한다. crossOrigin 재설정/reload로 우회하지 않는다.
- [x] V5. 일본어/영어 일반 영상 fixture와 동시에 소리가 나는 두 영상 fixture를 추가한다. 선택한 영상의 PCM만 수집되는 것과 재생 유지·시간 매핑을 `test:framework:video`로 검증하고 수치/보고서를 남긴다.

완료 검증: `npm run verify`, `npm run test:framework:video`.
이 단계에서는 인식/번역 품질을 PCM 획득 성공과 혼동하지 않는다.

## Stage chrome

목표: companion/Ollama 서버 없이 실제 영상 음성 인식·번역·자막이 동작하는 Chrome 빌드.

- [x] B1. browser engine의 execution host/worker와 model repository를 구현한다. 모델 준비의 ID·버전·다운로드·캐시·실제 로드 상태를 표시하고 document/user activation 제약을 처리한다.
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


### 2026-10-06 / core / iteration 2/5 — C3

관련 commit: 이 기록을 포함한 `feat: extract shared caption presentation policy`.

수행한 변경: 다음 미완료 항목 C3만 구현했다. 브라우저 없는 core presentation
policy에 1000 ms 교정 coalescing, 즉시 첫 원문/첫 번역/최종 교정, 정확히 짝지어진
최종 번역의 part 0 replay, 순차 표시 acknowledgement, 2.5–6초 reading time,
250 ms fade/remove intent, 최근 300 발화와 epoch/retirement/clear 정책을 분리했다.
기존 overlay/comparison은 이 정책을 호출하고, DOM renderer가 측정 line fitting,
읽지 않은 suffix의 위치, fullscreen, safe text와 CSS fade를 맡는다. 별도 source/
translation revision과 표시 part/visibility/character count를 검증하며 Stop은 비교
기록을 보존하고 Clear는 지연 작업을 취소한 뒤 sink를 재사용할 수 있게 한다.
기존 Caption 메시지의 presentation-only wrapper를 사용했으며 C4 combined engine/
capability/transport 매핑은 구현하지 않았다. companion v0.1.0, 설치 경로, 서버
PCM1/Caption 프로토콜과 사용자 설정은 보존했다. 중복 VAD/ASR·새 모델 없음.
공유 core 때문에 content script가 module로 바뀌는 회귀를 재현하고, main build의
write hook으로 standalone IIFE를 생성하여 기존 build/dev watch 흐름을 보존했다.

실행한 명령과 결과:

- PASS: `npm run test:framework:core` (최종 exit 0, ES2022/no-DOM 타입/의존성,
  presentation policy 포함 21 passed/0 failed/0 skipped, 80.649375 ms).
- PASS: `npm run verify` (최종 exit 0, Biome 62 files/20 ms/no findings, Ruff,
  extension typecheck, Vite main 23 modules/30 ms + content IIFE 8 modules/6 ms,
  JS 54 passed/0 failed/0 skipped/14684.56475 ms, Python 222 passed/66.90 s).
- PASS: `npm run test:captions-correction-browser` (최종 exit 0, Chromium
  153.0.8010.12, 1000 ms cadence, 즉시 첫/최종, burst/latest/in-place/clear/replacement).
- PASS: `npm run test:transcript-browser` (최종 exit 0, comparison/runtime 두 script,
  generated 원문/번역/time/cadence/safe text/history/eviction/reopen/Stop retention,
  실제 extension messaging/window, UI page errors `[]`).
- PASS: `npm run test:captions-overlap-browser` (exit 0, 실제 DOM 측정 순차 replay
  42/42·38/38 문자, narrow parts 30+12·30+8, reading time, 250 ms CSS fade,
  fullscreen/resize, provisional retention/correction/final replay, retirement,
  대기 과부하 4개/count 및 2개/audio budget 생략 표시).
- PASS: local Vite watch API check (exit 0, 첫 build 및 overlay dependency touch 후
  rebuild 모두 classic script 파싱 성공, `watchBuilds: 2`, watcher 종료).
- FAIL → FIXED: 첫 correction browser (exit 1, module content가 classic injection에서
  초기화되지 않아 `globalThis.sendCaption is not a function`). 최종 IIFE/동일 검사 통과.
- FAIL → FIXED: 첫 policy core 검사 (exit 1, 19 passed/1 failed/122.822375 ms,
  final source 교정의 이전 pairing 즉시 제거 실패). 수정 후 동일 assertion 통과.
- FAIL → FIXED: 중간 direct main build 후 `node --import tsx --test tests/build.test.ts`
  (exit 1, 0 passed/2 failed/45.528833 ms, content.js 누락). main write hook 수정 후
  동일 검사 2 passed/0 failed/43.273459 ms; 최종 full verify/watch 검사에도 포함.
- PASS: `git diff --check` (exit 0, whitespace 오류 없음).

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, existing Chromium 153.0.8010.12. core는 controlled clock와
생성된 caption으로 정책을 검증하고 브라우저는 실제 DOM layout/fade/메시징을
검증했다. 실제 영상 PCM, ASR 정확도·번역 품질, 모델 로드, Safari/iPhone은
미검증이다. 의존성/모델 다운로드·앱 설치·push·게시·다음 stage 진행 없음.

실패·미검증과 증거 위치: [core 보고서](docs/verification/media-framework/core.md).
로컬 `.ralph/media-framework/core-2-c3-*.log`는 커밋하지 않는다. 요청된 독립 runner
failure 파일은 없었다. rolling fixture JSON의 측정 시간과 transcript runtime의
window ID(2092352814 → 308564494)만 바뀌어 새 증거를 읽고 원래 파일을 복원했다.
기존 screenshots/UI JSON은 동일했고 사용자 파일·앱·녹화·마운트 이미지를 보존했다.
현재 필수 명령은 통과하지만 C4/C5의 adapter 및 전체 acceptance는 미완료다.

다음 미완료 항목: C4 companion combined interpretation adapter, 정확한 source/
translation normalization과 ASR-only 미지원 capability, 기존 설정 및 단일 VAD/ASR
보존. C4–C5 및 이후 stage 체크박스는 보존한다. C3 환경 차단은 없으며 stage 또는
전체 framework/iPhone 완료를 주장하지 않는다.

### 2026-10-06 / core / iteration 3/5 — C4

관련 commit: 이 기록을 포함한 `feat: connect companion combined interpretation adapter`.

수행한 변경: 다음 미완료 항목 C4의 combined InterpretationEngine과 companion
WebSocket/Caption bridge를 연결했다. `/sessions`, auth token, ready, PCM1와 서버
Caption wire 필드는 유지했다. 관측한 원문 text/final/audio range 변화만 source
revision을 증가시키고 번역-only 수정은 같은 원문 revision과 atomic pair로 보낸다.
capability는 `combined-interpretation`, `asrOnlyUpdates: false`, 선택한 언어 쌍을
명시하며 제공되지 않는 모델 version/load 정보는 만들지 않는다. 기존 offscreen은
실제 tab capture를 계속 소유하고 명시적 `tab-mix` PCM을 bounded core queue에서
adapter로 보낸다. 서버 VAD/ASR/번역은 그대로이며 중복 pipeline을 추가하지 않았다.
기존 source/translation/final/revision/range/emittedAtMs와 provider/ASR/languages/
model 설정, storage key/defaults, 설정 없는 요청의 server 환경 선택을 보존했다.
renderer에는 version 1 framework envelope로 normalized pair를 전달하고
지원하지 않는 version/event는 거부하며 기존 generated Caption도 호환한다.
Stop은 generation/queue를 먼저 무효화하고 session-owned source/socket만 정리한다.
closed adapter는 새로운 authenticated Start가 필요하며 selected-video handle이나
video time을 만들지 않는다. companion v0.1.0/launcher/설치 경로/서버는 변경하지 않았다.

실행한 명령과 결과:

- PASS: `npm run test:framework:core` (최종 exit 0, ES2022/no-DOM 타입/의존성,
  core/policy 및 새 adapter 검사 29 passed/0 failed/0 skipped, 93.465959 ms).
- PASS: envelope refinement 전 `npm run verify` (exit 0, Biome 67 files/37 ms/
  no findings, Ruff/typecheck/build, JS 62 passed/0 failed/0 skipped/14923.986167 ms,
  Python 222 passed/66.91 s).
- PASS: 최종 versioned-envelope 코드의 `npm run verify` (exit 0, Biome 67 files/
  22 ms/no findings, Ruff/extension typecheck, Vite main 28 modules/32 ms +
  content IIFE 10 modules/6 ms, JS 63 passed/0 failed/0 skipped/14300.178583 ms,
  Python 222 passed/66.87 s).
- PASS: 첫 `npm run verify` (closed-probe refinement 이전 exit 0, JS 62 passed/
  0 failed/0 skipped/15177.497292 ms, Python 222 passed/66.99 s, Biome 67 files/
  21 ms/no findings, Ruff/typecheck/build 통과). 최종 전체 결과는 위에 기록했다.
- PASS: `npm run test:captions-correction-browser` (최종 exit 0, Chromium
  153.0.8010.12, 1000 ms cadence, 즉시 첫/최종, burst/latest/in-place/clear/replacement).
- PASS: `npm run test:transcript-browser` (최종 exit 0, comparison/runtime 두 script,
  generated 원문/번역/time/cadence/safe text/history/eviction/reopen/stale rejection/
  Stop retention 및 실제 extension messaging/window, UI page errors `[]`).
- PASS: `node --import tsx --test tests/offscreen-companion.test.ts` (exit 0,
  1 passed/0 failed/0 skipped/83.315959 ms, 실제 offscreen module의 mock API
  integration, 설정/PCM1 byte/Caption field/Stop ownership 확인; full verify 포함).
- FAIL → FIXED: closed-probe 회귀 (수정 전 0 passed/1 failed/94.029708 ms,
  closed engine이 `available`을 반환). 동일 assertion을 유지하고 capability를
  `unavailable/context-destroyed`로 수정; 수정 후 exit 0, 1 passed/0 failed/
  67.121084 ms; 최종 core/JS acceptance 포함.
- FAIL → FIXED: versioned-envelope 회귀 (수정 전 exit 1, 0 passed/1 failed/
  82.728917 ms, normalized record에 version 1 envelope 없음). 동일 assertion을
  유지하고 versioned message/renderer validation 추가 후 exit 0, 1 passed/0 failed/
  83.315959 ms; 최종 core/JS acceptance 포함.
- PASS: `git diff --check` (exit 0, whitespace 오류 없음; 문서 변경 후 다시 확인).

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, existing Chromium 153.0.8010.12. Adapter/host는 generated
PCM와 caption/mock transport/media APIs로 pairing/settings/cancel/bounds/wire를
검증했다. 브라우저는 기존 DOM rendering과 실제 extension messaging/window를
검증했다. 실제 companion ASR 정확도/번역 품질, selected-video PCM, 모델 로드,
Safari/iPhone은 미검증이다. 의존성/모델 다운로드·앱 설치·push·게시·위임 없음.

실패·미검증과 증거 위치: [core 보고서](docs/verification/media-framework/core.md).
`.ralph/media-framework/core-3-c4-*.log`는 local diagnostic만으로 커밋하지 않는다.
요청된 independent runner failure 파일과 AGENTS.md는 없었다. 브라우저 두 차례
검증의 runtime window ID만 변경(2092352814 → 20860004, → 1064539833, 최종 → 2142014611)되어
새 증거를 읽고 해당 unrelated artifact를 복원했다. screenshots/UI JSON은 동일했다.
credentials/model weights/user audio/transcripts/temporary runner state는 커밋하지 않는다.

다음 미완료 항목: C5 전체 core/policy/adapter acceptance coverage와 ES-only
타입/의존성 경계를 audit하고 필수 네 명령을 다시 실행하여 stage report를 마무리한다.
C5와 이후 stage checkbox는 보존한다. 현재 C4 환경 차단은 없으며 stage 또는 전체
framework/iPhone 완료를 주장하지 않는다.


### 2026-10-06 / core / iteration 4/5 — C5

관련 commit: 이 기록을 포함한 `test: finalize media framework core acceptance`.

수행한 변경: 다음 미완료 항목 C5의 acceptance coverage와 타입/의존성 경계를
검토했다. `tsconfig.contracts.json`으로 contracts를 core와 별도로 ES2022/no-DOM/
no-ambient compile하고 실제 compiler graph가 core를 역참조하면 실패하도록 했다.
기존 core graph는 6개 core module과 contracts만 허용한다. Node/WebSocket/GPU
ambient negative fixture를 추가했다. 기존 offscreen host integration 검사를
`test:framework:core`에 포함하여 설정 snapshot/설정 생략/PCM1 byte/envelope/wire
caption/Stop ownership 보존도 runner의 stage command가 확인하도록 했다.
기존 acceptance를 제거·약화하지 않았다. runtime/서버/companion v0.1.0/설치 경로/
사용자 설정은 변경하지 않았다. C1–C5와 네 필수 명령 통과 후 C5를 체크했다.

실행한 명령과 결과:

- PASS: 첫 expanded `npm run test:framework:core` (exit 0, 두 ES2022/no-DOM
  compile, 31 passed/0 failed/0 skipped, 156.680125 ms).
- EXPECTED FAIL: 임시 contracts → core export를 추가한
  `node --import tsx --test tests/framework-contracts.test.ts` (child exit 1,
  1 passed/1 failed/0 skipped, 103.98 ms, `packages/core/identity.ts`의
  `Forbidden dependency`). wrapper는 실패를 확인하고 `finally`에서 임시 파일을
  제거해 exit 0. 이 실험은 boundary 위반을 검출하는 증거이며 미해결 오류가 아니다.
- PASS: 임시 위반 제거 후 최종 `npm run test:framework:core` (exit 0, 두 no-DOM
  compile/compiler graph, 31 passed/0 failed/0 skipped/0 cancelled, 118.048041 ms).
- PASS: `npm run verify` (exit 0, Biome 67 files/38 ms/no findings, Ruff,
  extension typecheck, Vite main 28 modules/30 ms + content IIFE 10 modules/6 ms,
  JS 64 passed/0 failed/0 skipped/15141.718583 ms, Python 222 passed/66.91 s).
- PASS: `npm run test:captions-correction-browser` (exit 0, Chromium
  153.0.8010.12, 1000 ms cadence, 즉시 첫/최종, burst/latest/in-place/clear/replacement,
  `passed: true`, `realAudioOrModels: false`).
- PASS: `npm run test:transcript-browser` (exit 0, comparison/runtime 두 script,
  source/translation/audio-time/cadence/safe text/same-row/history eviction/session
  replacement/reopen/stale rejection/Stop retention, 실제 extension messaging/window,
  UI page errors `[]`, runtime `realCapture: false`).
- PASS: `git diff --check` (exit 0, 최종 문서 포함 whitespace 오류 없음).

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, existing Chromium 153.0.8010.12. core/adapter/mock host의
생성된 PCM/caption 수명주기·정책·설정/프로토콜 호환과 실제 built DOM/extension
messaging만 검증했다. 실제 selected-video PCM, ASR 정확도/번역 품질, 모델 로드,
standalone inference, Safari/iPhone은 미검증이다. dependency/model/app 설치,
push/publish/위임·다음 stage 진행 없음.

실패·미검증과 증거 위치: [core 보고서](docs/verification/media-framework/core.md)의
coverage 표와 정확한 명령 결과. `.ralph/media-framework/core-4-c5-*.log`는 local
진단만으로 커밋하지 않는다. 요청된 independent runner failure 파일과 AGENTS.md는
없었다. 실제 acceptance의 예상 밖 실패/환경 차단 없음. Browser screenshots/UI JSON은
기존과 동일했고 runtime window ID만 변경(2092352814 → 747130818)되어 새 증거를
읽고 원래 파일로 복원했다. 임시 dependency 위반 파일, credentials/model weights/
user audio/transcripts/runner state는 커밋하지 않는다. 사용자 앱/녹화/마운트/설정 보존.

다음 미완료 항목 또는 차단 해제 조건: Stage core C1–C5 및 필수 네 명령 모두
통과했고 core 차단은 없다. 다음 plan 항목은 V1 영상 선택/MediaCatalog지만 이번
iteration에서 시작하지 않았다. 이후 stage checkbox와 plan은 보존한다.
선택한 core만 완료이며 전체 framework/iPhone 완료를 주장하지 않는다.

### 2026-10-06 / video / iteration 1/5 — V1

관련 commit: 이 기록을 포함한 `feat: add explicit video catalog and selection`.

수행한 변경: 다음 미완료 항목 V1의 page-owned `MediaCatalog`와 명시적 선택 UI를
`packages/media-web`에 구현했다. opaque 영상 ID/document ID/host-assigned frame ID,
label/viewport visibility/dimensions/playback 상태를 제공하고 DOM/URL/MediaStream은
adapter 안에 둔다. 추천은 확인을 대체하지 않으며 다른 영상 재생·새 광고는 선택을
바꾸지 않는다. source 교체/reload, source child·영상 remove/reinsert, SPA URL 변경,
host의 same-URL route invalidation, pagehide/dispose는 handle을 폐기하고 null 선택을
알려 재확인을 요구한다. 같은 JS task의 resolution도 pending mutation을 처리한다.
frame마다 허용된 별도 owner가 필요하며 parent는 iframe DOM/권한에 접근하지 않는다.
history API를 교체하지 않고 URL을 확인한다. same-URL router host는
`invalidateDocument()`를 호출해야 한다. 실제 platform host 연결은 B4/S3 범위다.
companion v0.1.0/설치 경로/기존 tab-mix capture/프로토콜/사용자 설정은 보존했다.

실행한 명령과 결과:

- PASS: 최종 `npm run test:framework:video` (exit 0, DOM/no-extension-ambient
  adapter typecheck + Chromium 153.0.8010.12 실제 DOM V1 검사, top video 3개,
  별도 frame owner 2개, main 320×180, page errors `[]`, `passed: true`).
  현재 harness 범위는 V1만이며 JSON에 V2–V5 미검증을 명시한다.
- PASS: 최종 `npm run verify` (exit 0, Biome 71 files/39 ms/no findings,
  Ruff/typecheck/build, main 28 modules/40 ms + content 10 modules/6 ms,
  JS 64 passed/0 failed/0 skipped/0 cancelled/14561.168125 ms,
  Python 222 passed/66.90 s).
- PASS: same-task fix 전 `npm run verify` (exit 0, Biome 71 files/24 ms,
  Ruff/typecheck/build, JS 64 passed/0 failed/0 skipped/15027.675708 ms,
  Python 222 passed/66.92 s). 위 최종 run이 마지막 코드를 다시 검증했다.
- FAIL → FIXED: 첫 video command (exit 1, typecheck 뒤 harness line 16의
  `SyntaxError: Unexpected token ')'`). build options closing brace 수정 후 통과.
- FAIL → FIXED: 첫 verify (exit 1, Biome 71 files/37 ms, 새 fixture video의
  `useMediaCaption` 3 errors, 이후 단계 미실행). silent fixture의 empty caption
  track 추가 후 기존 lint rule/configuration을 유지한 전체 verify 통과.
- FAIL → FIXED: expanded video command (exit 1, source child remove/reinsert 뒤
  `page.waitForFunction: Timeout 30000ms exceeded`). 동일 최종 URL에도 owner
  handle을 폐기하도록 수정한 뒤 같은 assertion 통과.
- FAIL → FIXED: same-task regression video command (exit 1, detached/reinserted
  target resolution `true !== false`). pending mutation을 동기 처리한 뒤 동일
  assertion 유지/통과. 기존 acceptance를 제거하거나 약화하지 않았다.
- PASS: 최종 targeted Biome (4 files/3 ms/no findings, exit 0). 초기 7개의
  non-null warning은 live document window를 narrow한 local binding으로 해결했다.
- PASS: 최종 문서 포함 `git diff --check` (exit 0, whitespace 오류 없음).

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, existing Chromium 153.0.8010.12. 실제 DOM identity/
selection/navigation/frame isolation만 검증했다. 실제 playing 상태는 생성된 canvas
video-only MediaStream으로 검사했으며 fake paused/ended property나 mock catalog가
아니다. PCM/원래 소리/ASR 정확도·번역 품질/model load/Safari/iPhone은 미검증이다.
`realSelectedVideoPCM: false`, `originalAudibility: "unverified"`,
`asrAccuracy: "unverified"`를 기록했다. V2–V5 체크박스는 보존한다.

실패·미검증과 증거 위치: [video 보고서](docs/verification/media-framework/video.md)의
coverage/명령 표 및 committed harness/fixture. `.ralph/media-framework/video-1-v1-*.log`
와 임시 bundle은 local 진단만이며 커밋하지 않는다. AGENTS.md/이전 video report/
요청된 independent runner failure 파일은 없었다. 현재 V1 환경 차단은 없고
blocked browser 접근·권한 우회가 없었다. credentials/model weights/user audio/
transcripts/temporary runner state는 커밋하지 않는다. 사용자 앱·녹화·마운트·설정과
관련 없는 파일을 보존했으며 dependency/model/app 설치·위임·push·게시를 하지 않았다.

다음 미완료 항목: V2 같은 출처 Web Audio 입력, 기존 graph 충돌 처리와 실제 소리로
Stop/repeat Start 후 원래 재생·볼륨 유지 검증. V1만 체크했고 이후 stage를 시작하지
않았다. Stage video/전체 framework/iPhone 완료는 주장하지 않는다.

### 2026-10-06 / video / iteration 2/5 — V2

관련 commit: 이 기록을 포함한 `feat: capture selected video audio without rerouting playback`.

수행한 변경: 다음 미완료 V2의 `VideoInput`과 mono float32 PCM worklet을 추가했다.
선택한 element의 `captureStream()` → session-owned Web Audio 경로를 사용해 기존
site-owned `MediaElementAudioSourceNode`를 다시 만들거나 playback graph를 바꾸지
않는다. user activation/target identity/ordinary same-origin route를 확인하고 Stop은
captured tracks/context/PCM queue/subscriptions만 닫는다. duplicate Start 거부,
repeat Start/Stop, bounded queue overflow의 명시적 audio-gap, 준비 중 invalidation과
cleanup을 구현했다. 현재 playback discontinuity는 capture를 종료하고 재시작을
요구한다. V3 anchor/epoch 처리는 다음 항목이며 구현했다고 표시하지 않는다.
companion v0.1.0·설치 경로·기존 capture/프로토콜·사용자 설정을 보존했다.

실행한 명령과 결과:

- PASS: 최종 `npm run test:framework:video` (exit 0), DOM/no-extension-ambient
  typecheck와 기존 V1 assertion 모두 유지, Chromium 153.0.8010.12의 실제 encoded
  160×90 VP8/Opus video/440 Hz tone → selected stream → 48 kHz mono/8192-byte
  PCM 검증. ordinary/site-owned graph 각각 3회 Start/Stop 후 실제 browser output
  RMS가 baseline의 0.6% 이내로 유지됐다. duplicate Start 거부/반복 Stop/Stop 이후
  PCM 없음/재생 진행/volume=0.4·muted=false·rate=1 보존/100 ms queue overflow 시
  128 ms discarded audio-gap/page errors `[]` 검증.
- PASS: raw-output-oracle video run (exit 0), 같은 두 실제 audio 경로/3회 재시작.
- FAIL → FIXED: 최초 video run (exit 1), queued initial `addtrack`을 변경으로
  오인해 capture 종료. initial track과 새 audio track을 구분한 뒤 같은 검사 통과.
- FAIL → FIXED: track fix 뒤 run (exit 1), startup silence가 있는 첫 batch의
  crossing count로 234.375 Hz 측정. steady batch의 crossing 간격 측정으로 수정;
  peak/frequency 기준은 유지했다.
- FAIL → FIXED: steady-tone run 및 diagnostic run (각 exit 1), output level
  assertion; 진단 baseline 0.0926495353/during 0.0187868360. test-only loopback의
  AGC/echo cancellation/noise suppression을 끄고 실제 설정/expected baseline
  assertion을 추가한 뒤 같은 level 유지 기준 통과. acceptance를 약화하지 않았다.
- FAIL → FIXED: 첫 targeted Biome (exit 1, 5 errors/1 warning, 6 files/22 ms).
  button type/forEach callback/unused import 수정. 최종 targeted Biome PASS
  (exit 0, 7 files/16 ms/no findings).

- PASS: 최종 `npm run verify` (exit 0), Biome 75 files/25 ms/no findings,
  Ruff/typecheck/build (main 28 modules/41 ms, content 10 modules/6 ms),
  JS 64 passed/0 failed/0 skipped/0 cancelled/14398.072792 ms,
  Python 222 passed/66.92 s.
- PASS: 최종 expanded harness 전 `npm run verify` (exit 0), Biome 75 files/41 ms,
  JS 64 passed/0 failed/0 skipped/0 cancelled/15082.3175 ms,
  Python 222 passed/66.94 s. 위 final run이 마지막 코드/검사를 검증했다.
- PASS: 최종 문서 포함 `git diff --check`/staged whitespace check (exit 0, 오류 없음).

실제 검증 범위: 원래 재생은 mock이나 연결된 graph만 검사한 것이 아니라 독립
Chromium tab-output loopback의 실제 44.1 kHz stereo PCM으로 측정했다. output
AGC/echo cancellation/noise suppression/local-playback suppression이 실제 false인
것도 검사했다. 이 tab mix는 test oracle로만 사용하며 production selected-video
input으로 사용하지 않는다. 선택 input은 실제 encoded video에서만 온다. 다른
사용자 탭·mic·system audio는 수집하지 않았고 사용자 앱·녹화·마운트·설정은
건드리지 않았다. 실제 hardware speaker/listener 청취는 미검증이다. PCM 성공을
ASR/번역 정확도로 표시하지 않는다. timeline/epoch mapping(V3), CORS/redirect/
silence/mute/iframe/blob/MSE/DRM matrix(V4), 일본어/영어와 두 audible 영상 fixture(V5),
standalone Chrome/Safari/iPhone은 미검증이며 체크박스를 그대로 남긴다.

실패·미검증과 증거 위치: [video 보고서](docs/verification/media-framework/video.md)의
V2 상세 table/실패 기록과 committed production modules/fixture/harness. 임시
`.ralph/media-framework/video-2-v2-*.log`/bundle과 생성 media는 커밋하지 않는다.
root AGENTS.md 및 요청된 independent runner failure 파일은 없었다. secure local
browser 접근은 허용됐고 blocked access/profile 우회는 없었다. about:blank의 API-only
smoke는 mediaDevices 없음 TypeError로 끝났지만 실제 loopback fixture의 두 output
track/sound 경로가 정상 검증됐다. credentials/weights/user audio/transcripts 없음.

다음 미완료 항목: V3 playback anchor로 영상과 PCM 시간을 매핑하고 seek·pause/resume·
rate/source 변경의 epoch/cancel/late-result 거부를 검증한다. V2만 이번에 체크했고
V3–V5 및 이후 stage는 시작하지 않았다. V2 browser scope의 환경 차단은 없다.
Stage video/전체 framework/iPhone 완료 marker를 내지 않는다.

### 2026-10-06 / video / iteration 3/5 — V3 partial, blocked

관련 commit: 이 기록을 포함한 `feat: add video playback anchors and record audio blocker`.

수행한 변경: 다음 미완료 V3의 playback-anchor/discontinuity plumbing만 진행했다.
input의 최초 `play` anchor와 worklet capture frame은 동일 AudioContext clock ID를
사용하고 영상 currentTime/playbackRate를 관측한다. seek/pause/rate/source/end는
queued/late PCM을 차단하고 old-epoch playback event를 전달한다. 기존 core가 epoch를
먼저 증가시키고 cancel/late-result 거부를 수행한다. adapter가 epoch를 독립적으로
증가시키지 않는다. 같은 session/target의 epoch 재개에만 최초 Start authorization을
유지하고 seeked 이후 새 stream/clock/sample origin을 만든다. source replacement는
새 handle/사용자 재확인이 필요하며 pause는 host의 explicit resume/reprobe 흐름이다.
standalone host/엔진/다음 stage를 추가하지 않았다. companion v0.1.0/설치 경로/기존
사용자 설정은 보존했다. 실제 video/PCM mapping과 input→core epoch acceptance가
차단되어 V3를 체크하지 않았다. V4/V5 및 이후 stage도 미완료 그대로 남긴다.

실행한 명령과 결과:

- FAIL/BLOCKED: `npm run test:framework:video` 두 독립 시도, 각각 exit 1.
  두 번 모두 adapter typecheck/V1 실제 DOM 검사 PASS, Chromium 153.0.8010.12.
  첫 시도는 기존 `A real encoded video/audio fixture must exist` assertion에서
  실패했다. 두 번째는 byte diagnostic을 추가했고 8초 recorder 결과가 **110 bytes**로
  동일 >10000-byte 기준에서 실패했다. V2 실제 decoded PCM/output 및 V3 anchor
  assertion에 도달하지 못했다. acceptance threshold를 바꾸지 않았다.
- DIAGNOSTIC ONLY: test-owned 새 Chromium의 로컬 generator 진단 (exit 0,
  acceptance 아님). 실제 AudioContext state=running이지만 1/2/3초 관측의
  currentTime이 모두 0.005333333333333333초로 고정됐고 drawing count=11/21/31,
  visibility=visible, recorder data chunks 없음, Stop 결과 0-byte chunk.
  real-time audio renderer가 진행하지 않는 환경 차단이며 근본 OS/device 원인은
  미확인이다. 새 환경 근거 없이 세 번째 actual-audio acceptance를 반복하지 않았다.
- EXPECTED FAIL → PASS (mock scope): pre-change adapter로 initial-anchor port
  회귀를 실행하면 child exit 1, 0 passed/1 failed/74.684292 ms,
  `assert.ok("type" in value)` 실패. wrapper가 finally에서 edited adapter를 복구했다.
  최종 `node --import tsx --test tests/framework-video-input.test.ts` exit 0,
  9 passed/0 failed/0 skipped/0 cancelled/48.566958 ms. injected PCM/fake DOM/audio
  nodes로 anchor/rate mapping/discontinuity/cleanup/seek/activation만 검증했다.
- PASS: `./node_modules/.bin/tsc -p tsconfig.media-web.json` (exit 0),
  DOM/no-extension-ambient adapter compile.
- PASS: `npm run test:framework:core` (exit 0), ES2022/no-DOM compiles,
  31 passed/0 failed/0 skipped/0 cancelled/126.609042 ms; 기존 mock input/engine
  epoch advance-before-cancel과 stale-result 거부 검증.
- PASS: targeted Biome (7 files/5 ms/no findings, exit 0).

- PASS: 최종 `npm run verify` (exit 0), Biome 76 files/31 ms/no findings,
  Ruff/typecheck/build (main 28 modules/42 ms, content 10 modules/6 ms),
  JS 73 passed/0 failed/0 skipped/0 cancelled/14752.749583 ms,
  Python 222 passed/66.93 s. 새 9개 mock-port 검사도 full verify에 포함됐다.
- PASS: `git diff --check` (exit 0, whitespace 오류 없음).

실제 검증 범위와 미검증: V1 실제 DOM은 재검증됐지만 이번 환경에서 encoded audio가
생성되지 않아 실제 PCM/원래 browser-output 유지/영상 mapping/error 수치/실제
discontinuity→core cancellation은 미검증이다. mocks/model load/PCM acquisition을
ASR 정확도로 표시하지 않았다. Safari/iPhone/음성 인식·번역 품질/물리 speaker 청취는
미검증이다. root AGENTS.md 및 요청된 independent runner failure 파일은 없었다.
기존 사용자 browser/profile/settings/apps/recordings/mounts를 건드리지 않았고
blocked access 우회/dummy audio fallback/dependency·model·app 설치/위임/push/게시 없음.
임시 `.ralph` scripts/logs/bundles와 credentials/weights/user audio/transcripts는
커밋하지 않는다. 상세 수치/명령/evidence는 [video 보고서](docs/verification/media-framework/video.md).

차단 해제 및 다음 미완료 항목: test-owned Chromium의 실제 AudioContext clock과
기존 encoded fixture/independent output oracle가 작동하는 환경에서
`npm run test:framework:video`를 모든 기존 기준으로 재실행한다. 이어 V3의 실제
seek/pause-resume/rate/source 시간 mapping 수치, 원래 재생 유지 및 delayed test-engine
results의 input→core epoch 거부를 검증한다. V3가 실제 통과하기 전 체크하지 않는다.
동일 real-audio 차단을 두 독립 시도로 확인했으므로 이번 iteration은 BLOCKED로
종료하며 Stage video/전체 framework/iPhone 완료를 주장하지 않는다.

### 2026-10-06 / video / iteration 1/5 — resumed V3

관련 commit: 이 기록을 포함한 `fix: preserve selected video PCM timeline`.

수행한 변경: 다음 미완료 V3만 완료했다. 기존 input/core anchor와 epoch 제어를
실제 encoded 영상의 PCM으로 연결해 seek/pause-resume/rate/source 변경과 늦은
test-engine 결과 거부를 검증했다. 실제 입력에서 발견한 worklet partial-batch의
capture-clock gap 연결을 수정했다. input channel 부재나 예상 currentFrame 불연속은
미완성 batch를 버리고 새 실제 frame에서 시작한다. 이미 전달한 batch 이후 gap은
기존 strict core 검사가 계속 거부한다. 누락 PCM을 만들거나 시간/acceptance 기준을
완화하지 않았다. 로컬 fixture HTTP byte-range 지원을 추가하여 3초 seek가 실제로
이동하게 했다. stage command에 기존 9개 input-port와 새 2개 worklet 회귀를 포함했다.
production controller/contracts/companion/설정과 later-stage 코드는 변경하지 않았다.

실행한 명령과 결과:

- DIAGNOSTIC: 기존 test-owned Chromium generator, exit 0; AudioContext
  0.976/1.9786666666666666/2.981333333333333초 및 recorder
  14372/17058/18085 bytes. 이전 frozen clock과 다른 새 근거로 acceptance를 재개했다.
- PASS: baseline `npm run test:framework:video`, exit 0; 기존 V1/V2, 실제
  132920-byte video/PCM/original output. V3 검증을 대체하지 않는다.
- FAIL → FIXED: 확장 harness의 shared chunk 미제공 ready timeout; 실제 초기 PCM
  48 ms start vs 42.666666666666664 ms 이전 end의 gap; missing-input-only fix로는
  해결 안 됨; clock-jump discard 후 실제 seek가 0초로 돌아가 mapping assertion 실패.
  byte-range fixture 지원 후 동일 assertion과 모든 기존 기준 통과.
- EXPECTED FAIL → PASS: worklet incomplete-batch 회귀; 첫 frame 0 vs 640으로
  missing-input/clock-jump 각각 실패. 최종 processor 검사 2 passed/0 failed/
  0 skipped/0 cancelled/44.146875 ms. mock processor scope이며 real PCM 대체 아님.
- PASS: 최종 `npm run test:framework:video`, exit 0; DOM adapter compile,
  port/processor 11 passed/0 failed/0 skipped/0 cancelled/49.676625 ms,
  V1/V2 및 ordinary/site-owned graph 양쪽 V3 실제 mapping/epoch/output acceptance.
- PASS: production gap fix 후 `npm run verify` (최종 fixture server 변경 전), exit 0;
  Biome 79 files/48 ms, Ruff/typecheck/build 28+10 modules, JS 75 passed/0 failed/
  0 skipped/0 cancelled/15032.733666 ms, Python 222 passed/66.96 s.
- PASS: final targeted Biome, exit 0, 9 files/5 ms/no findings.
- PASS: 최종 code/fixture의 `npm run verify`, exit 0; Biome 79 files/28 ms/
  no findings, Ruff/typecheck/build (28 modules/33 ms, 10 modules/6 ms),
  JS 75 passed/0 failed/0 skipped/0 cancelled/14342.633083 ms,
  Python 222 passed/66.91 s (`video-1-v3-committed-tree-verify.log`).
- PASS: 최종 `git diff --check` 및 staged whitespace, exit 0/no errors.

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1, uv 0.12.23/
Python 3.12.15, Chromium 153.0.8010.12. ordinary/site-owned graph 각각 실제 PCM
55 chunks, 최대 video currentTime 대비 mapping error 64.513/20.367333333333136 ms
(사전 설정 every-chunk <150 ms), 3초 seek, 1→1.25 rate, pause epoch 3/resume epoch 4,
source epoch 5 무효화와 explicit 새 target/session, 서로 다른 5개 context clock,
epoch advance-before-cancel 및 late-seek/rate/pause/source 결과 거부를 확인했다.
generated engine은 real PCM range만 소비하며 ASR/번역 품질을 주장하지 않는다.
독립 tab-output RMS는 unchanged 12% 기준 내 유지되고 pause는 RMS 0이며
pause/Stop 후 PCM이 없다. 실제 controller caption range도 input timeline과 일치한다.

실패·미검증과 증거 위치: [video 보고서](docs/verification/media-framework/video.md)의
전체 실패/수정/명령/수치 표와 ignored `.ralph/media-framework/video-1-v3-*.log`.
root/nested AGENTS.md와 요청된 independent runner file은 없었다. 현재 Chromium
V3 환경 차단은 없고 과거 clock stall의 원인은 미확인이다. physical speaker 청취,
speech/ASR/translation/acoustic-content alignment/장시간 drift/Safari/iPhone은 미검증.
user browser/profile/settings/apps/recordings/mounts/companion v0.1.0 및 설치 경로를
보존했다. 설치/위임/push/publish/blocked access 우회/임시 state 커밋 없음.

다음 미완료 항목: V4 CORS/실제 무음/muted/교차 출처 iframe/blob/MSE/protected route
구분과 원래 재생 보존. V3만 체크했고 V4/V5와 later-stage checkbox는 보존한다.
Stage video/전체 framework/iPhone 완료가 아니므로 완료 marker를 출력하지 않는다.

### 2026-10-06 / video / iteration 2/5 — resumed V4

관련 commit: 이 기록을 포함한 `feat: classify selected video media access`.

수행한 변경: 다음 미완료 V4만 완료했다. CORS-mode HTTP media는 route 후보로
허용하지만 실제 captureStream의 origin-clean 보안 검사를 통과해야 입력을 연다.
no-CORS playback, 늦은 crossOrigin 속성 변경, same-origin URL의 cross-origin redirect는
`media-access-denied`로 거부한다. 다른 frame의 handle은 `frame-permission-required`,
blob/MSE는 `media-route-unknown`, 실제 MediaKeys 연결은 `protected-media`로 구분한다.
입력은 playback graph/CORS 속성/src/볼륨/mute/rate를 변경하거나 reload하지 않는다.
encoded 실제 무음 및 muted tone, CORS/redirect/blob/MSE/MediaKeys/교차 출처 frame의
실제 브라우저 fixture와 input-port 회귀 2개를 기존 acceptance에 추가했다.

실행한 명령과 결과:

- PASS: baseline `npm run test:framework:video`, exit 0; 기존 V1/V2/V3.
- EXPECTED FAIL: 변경 전 CORS/frame port 회귀, Node child exit 1,
  0 passed/2 failed/104.073916 ms; log 출력 wrapper exit 0.
- PASS: production 수정 후 input-port 검사, exit 0, 11 passed/0 failed/
  0 skipped/0 cancelled/76.64525 ms; injected PCM/fake ports scope만 검증.
- FAIL → FIXED: 첫 video acceptance의 silent encoded fixture 7256 bytes가
  기존 >10000-byte 기준 미달. 합성 frame 번호를 그림에 추가하여 21622 bytes로
  생성했고 모든 크기/주파수/output/mapping 기준은 유지했다.
- FAIL → FIXED: 확장 실제 matrix가 CORS PCM을 수집한 후 read-only `window.closed`
  fixture flag 때문에 timeout. `captureClosed`로 수정 후 전체 matrix PASS, exit 0.
- FAIL → FIXED: 첫 `npm run verify`, exit 1; Biome/Ruff 통과 후 새 tests의
  Capability union `.reason` 접근 TS2339 4개. 명시적 narrowing으로 수정했다.
- FAIL: verify와 동시 실행한 video acceptance, exit 1; 기존 V2 tone 측정
  454.4792425345958 Hz가 unchanged 440±12 Hz 기준 밖. 원인은 미확인이다.
  반복하여 성공을 만들지 않고 verify 종료 후 독립 serial attempt를 한 번 실행했다.
- PASS: 최종 serial `npm run test:framework:video`, exit 0; adapter typecheck,
  port/worklet 13 passed/0 failed/0 skipped/0 cancelled/49.190459 ms,
  기존 V1/V2/V3 및 V4 실제 10개 media route와 permitted frame PCM/output.
- PASS: 최종 `npm run verify`, exit 0; Biome 81 files/25 ms/no findings,
  Ruff/typecheck/build (main 28 modules/44 ms, content 10 modules/7 ms),
  JS 77 passed/0 failed/0 skipped/0 cancelled/15110.082291 ms,
  Python 222 passed/67.01 s.
- PASS: targeted Biome, exit 0 (8 files/4 ms/no findings), standalone adapter
  typecheck exit 0, 최종 unstaged/staged whitespace checks exit 0.

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1, uv 0.12.23/
Python 3.12.15, Chromium 153.0.8010.12. 147286-byte tone/21622-byte silence
VP8/Opus를 실제 decode했다. CORS/muted 각각 11 PCM chunks/peak
0.15105554461479187, 실제 무음 11 chunks/peak 2.0345869483764863e-34.
muted original output RMS는 0, 무음은 약 8.138e-35이며 정상 available로 유지한다.
거부된 route는 PCM 0 chunks, 원래 playback output은 unchanged 12% bound 내 유지.
cross-origin frame은 parent native DOM SecurityError를 유지하면서 명시적으로 소유한
frame adapter만 5 PCM chunks를 수집하고 Stop 후 output RMS 0.04221221158992649.
V3 재검증은 graph별 55 chunks, mapping 최대 오차 57.51900000000023/
28.036333333333914 ms (<150 ms). 모든 V4 source/CORS/volume/mute/rate/reload
상태는 동일하고 원래 재생은 계속 진행했다. 전체 page errors는 `[]`.

실패·미검증과 증거 위치: [video 보고서](docs/verification/media-framework/video.md)의
V4 수치/명령 표 및 ignored `.ralph/media-framework/video-2-v4-*.log`.
현재 필수 Chromium acceptance 차단은 없다. encrypted payload/decryption은 검증하지
않았고 MediaKeys의 보수적 거부만 검증했다. 임의 site/extension frame permission 설치,
physical speaker 청취, ASR/번역 정확도, Safari/iPhone/standalone host는 미검증이다.
root/nested AGENTS.md와 요청된 independent runner failure file은 없었다.
companion v0.1.0/설치 경로/기존 사용자 설정/앱/녹화/mounts를 보존했다.
위임/설치/push/publish/blocked browser access 우회/임시 state 커밋 없음.

다음 미완료 항목: V5 일본어/영어 일반 영상과 동시에 audible한 두 영상 fixture,
선택 PCM isolation 및 playback/mapping 수치. V4만 새로 체크했다. V5와 모든 later
stage는 미완료이며 Stage video/전체 framework/iPhone 완료를 주장하지 않는다.

### 2026-10-06 / video / iteration 3/5 — resumed V5

관련 commit: 이 기록을 포함한 `test: verify selected speech video isolation`.

수행한 변경: 다음 미완료 V5만 완료했다. 이미 설치된 macOS Kyoko/Samantha 음성으로
합성 일본어/영어 24초 320×180 VP8/Opus 일반 영상 fixture와 재생성 script, source text/
Korean meaning anchors/voice/size/SHA-256 manifest를 추가했다. 사용자 음성·전사문은 없다.
실제 production selection/catalog/input/core timeline을 사용해 두 audible 영상을 계속
재생하면서 Japanese Start → Japanese repeat Start → English explicit selection을 검증한다.
ordinary 및 두 실제 site-owned source graph에서 총 6회 실제 PCM을 수집한다.
별도 decoded-file waveform correlation과 6500/9000 Hz tag exclusion으로 선택 음성만
수집됨을 확인하고 독립 test-owned tab-output oracle로 두 원래 playback level을 측정한다.
이 tab mix는 input으로 사용하지 않는다. 모든 기존 V1–V4 assertion/threshold를 유지했다.
production modules/companion v0.1.0/설치·서버·프로토콜/기존 설정/later-stage 코드는
변경하지 않았다. 파일 provenance/수치/실패·미검증은 video 보고서에 기록했다.

실행한 명령과 결과:

- PASS: `node tests/fixtures/video-speech/generate.mjs`, exit 0; Japanese 450500 bytes,
  English 446449 bytes, manifest SHA-256과 일치. fixture 생성이며 ASR acceptance 아님.
- FAIL → FIXED: 첫 expanded `npm run test:framework:video`, exit 1; adapter compile/
  port-worklet 13 passed/55.349125 ms 및 V1–V4 PASS, V5 baseline output tags
  0.012343929318266892/0.008652159913031917이 기존 12% expected-output bound 실패.
  독립 local diagnostic에서 첫 loopback window 이후 0.024043493278875082/
  0.015025096203143618로 정상화되는 것을 확인하고 500 ms initial warm-up을 추가했다.
- DIAGNOSTIC FAIL → PASS: 첫 output helper는 favicon bundle ENOENT로 exit 1;
  404 처리 후 exit 0. 실제 decoded tag 0.059790095284170876/0.05994606459915941,
  output strongest bins 6500/9000 Hz를 관측했다. acceptance 성공을 대신하지 않는다.
- FAIL → FIXED: warm-up 후 targeted V5, exit 1; Japanese repeat 60 real chunks,
  selected speech correlation 1.0/wrong 0.16957981050486484, long-window tag
  projection 0.029800045401415974가 unchanged 12% bound 실패. 별도 file diagnostic
  exit 0에서 12개 one-second reference window의 own tags 약 0.06을 확인했다.
  장시간 coherent projection 대신 1024-sample Hann window power를 평균하여 phase
  cancellation에 의해 present tag가 숨겨지지 않게 했다. captured discrepancy의
  underlying phase/transport 원인은 미확인으로 남겼다. PCM/timeline/output 기준은
  그대로 유지하고 sample/gain/timestamp를 변경하지 않았다.
- PASS: targeted V5 short-window run, exit 0; 6회 real captures/두 graph modes,
  selected correlation 1.0, wrong maximum 0.20703848085286755,
  mapping maximum 5.497333333333245 ms. ignored local helper scope이며 full stage 아님.
- PASS: 최종 `npm run test:framework:video`, exit 0; standalone adapter compile,
  13 port/worklet tests/0 failed/0 skipped/0 cancelled/54.665125 ms,
  V1–V5 모든 실제 browser assertion 통과 (`video-3-v5-final-acceptance.log`).
- PASS: 최종 `npm run verify`, exit 0; Biome 85 files/41 ms/no findings,
  Ruff/typecheck/build (main 28 modules/43 ms, content 10 modules/6 ms),
  JS 77 passed/0 failed/0 skipped/0 cancelled/15076.266834 ms,
  Python 222 passed/66.96 s (`video-3-v5-final-verify.log`).
- PASS: 최종 targeted Biome, exit 0, 5 files/17 ms/no findings. 첫 lint의
  approximate numeric constant warning은 Math.SQRT1_2로 수정했다.
- PASS: 최종 `git diff --check`/`git diff --cached --check`, exit 0/no whitespace
  errors; final report/plan 포함하여 commit 전에 재검사했다.

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1, uv 0.12.23/
Python 3.12.15, Chromium 153.0.8010.12. V5 355 real mono/48 kHz float32 chunks,
8192 bytes/연속 sequence/정확한 session-target-epoch/context-clock, Stop 후 PCM 없음,
두 source/CORS/volume/mute/rate/paused 상태 보존. selected low-pass speech correlation
0.9802335596111816–1.0 (>0.85), wrong maximum 0.21245008334894455 (<0.35),
selected tags 0.05983033836362112–0.06019855322378691 (0.06 ±12%),
unselected tag maximum 0.0011082801340152825 (<0.003), speech RMS >0.0396 (>0.008),
maximum video mapping error 4.214333333333343 ms (<150 ms). 두 original output tag는
expected user-volume 0.024/0.015 및 baseline의 ±12% 내 유지됐다. 두 영상은 각각
9.478854/9.478863 s (ordinary), 9.375648/9.375649 s (site-owned) 계속 진행했다.
모든 page errors `[]`. V3 재검증은 각 55 chunks/최대 오차 67.38999999999942 및
28.072333333333518 ms, V4 10개 route와 owned cross-origin frame도 통과했다.

실패·미검증과 증거 위치: [video 보고서](docs/verification/media-framework/video.md)의
V5 수치/방법/전체 실패·명령 표 및 ignored `.ralph/media-framework/video-3-v5-*.log`.
PCM/decoded waveform correlation/fixture source labels/mock engine event를 ASR/번역
정확도로 표시하지 않는다. physical speaker 청취, speech/translation quality, 장시간
acoustic alignment/drift, external sites/extension installation/frame permissions,
encrypted media decryption, standalone host/Safari/iPhone은 미검증이다. root/nested
AGENTS.md 및 요청된 independent runner file은 없었고 user 제공 Agent Core를 따랐다.
현재 필수 Chromium 환경/device/permission 차단 없음. 기존 user apps/recordings/mounts/
browser/profile/settings/companion을 보존했고 blocked access 우회/설치/위임/push/publish 없음.
credentials/weights/user audio·transcripts/임시 `.ralph` state는 commit에서 제외했다.

다음 미완료 항목: **Stage video에는 없음**. 두 required final commands가 실제로
통과한 뒤 V5만 새로 체크했고 V1–V5/Stage video acceptance가 완료됐다. plan/runner를
보존하며 이후 stage로 진행하지 않는다. 전체 framework나 iPhone 완료가 아니다.


### 2026-10-06 / chrome / iteration 1/5 — B1 preparation progress, blocked

관련 commit: 이 기록을 포함한 `feat: add browser model preparation host`.

수행한 변경: 다음 미완료 B1만 진행했다. foreground secure document와 dedicated
worker, version 1 request/status 검증, 실제 user activation, synchronous Stop 및
owned worker termination, pinned model repository/download/cache/load/eviction 상태를
구현했다. 별도 `apps/chrome/preparation.html` bundle에 model ID/version/43,613,734-byte
model storage/download/실제 load 상태와 Stop을 표시한다. candidate는 multilingual
`onnx-community/whisper-tiny` revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`,
q8/WASM이며 default 선택/ASR 정확도 주장이 아니다. Transformers.js 4.3.0과 local
ONNX runtime assets를 exact dependency/lock으로 사용한다. 큰 WASM은 candidate가
소유한 Cache API에 보존해 worker 재시작 offline load를 검증했다. 기존 companion
v0.1.0/설치/manifest/native messaging/server protocol/user settings/core는 보존했다.

실행한 명령과 결과:

- PASS: 최종 `npm run verify`, exit 0; Biome 94 files/72 ms/no findings,
  Ruff/typecheck, 기존 main 28 modules/43 ms/content 10 modules/6 ms,
  JS 82 passed/0 failed/0 skipped/0 cancelled/17,060.406333 ms,
  Python 222 passed/66.90 s (`chrome-1-final-verify.log`).
- PASS: repository port 검사 5 passed/0 failed/0 skipped/0 cancelled,
  standalone 100.058417 ms. fake cache/loader로 late cancel disposal, parallel job 및
  active eviction 거부, owned eviction, offline/quota/미등록 model 실패만 검증했다.
- FAIL/BLOCKED: `npm run test:framework:chrome:preparation`, 최종 exit 1.
  typecheck/5 port tests/separate build 및 실제 download/WASM load/Stop/offline/
  corrupt-cache 거부는 통과했으나 real document hidden assertion이 10,000 ms timeout.
  headless attempt 8과 headed attempt 10에서 같은 차단을 독립 확인했다.
- FAIL: `npm run test:framework:chrome`, exit 1, Missing script. B5 full real-video
  ASR/translation/DOM acceptance는 아직 미구현이다. B1 loading 검사로 대체하지 않았다.
- PASS: 최종 targeted Biome 9 files/14 ms, typecheck/whitespace, `npm audit --json`
  exit 0/zero vulnerabilities. initial 3.8.1의 audited 6 vulnerabilities는 새 dependency를
  exact 4.3.0으로 변경하여 해결했다.

실제 검증 범위: Darwin arm64, Node v24.15.0/npm 11.12.1, uv 0.12.23/
Python 3.12.15, owned Chromium 153.0.8010.12. final headed run은 7개 pinned model
files 43,613,734 bytes와 q8 encoder/decoder download SHA-256, absent/downloading/
cached/loading/ready 분리를 확인했다. 실제 준비 완료 9,756.306834 ms, cached
model 및 packaged runtime의 fresh worker offline 준비 534.1752089999991 ms이며
전사 latency가 아니다. user-gesture 없는 module call 거부, offline first-run 실패,
injected transport error, held download Stop/double Start, 실제 loading 중 Stop과
late ready 거부, same-size corrupt tokenizer의 실제 model-load-failed 및 복원 후
ready를 검증했다. browser PCM/전사/번역/자막 정확도/메모리/장시간은 미검증이다.

실패·미검증과 증거 위치: [chrome 보고서](docs/verification/media-framework/chrome.md)에
모든 build/type/lint/library/fixture 실패와 수정, commands, model/runtime sizes,
10개 preparation attempt의 구분 및 ignored `.ralph/media-framework/chrome-1-*.log`
위치를 기록했다. 두 actual suspension 실패 후 local owned browser 진단에서 같은
window의 두 tab 및 button-open tab이 모두 visible임을 확인했고, background 관련
Playwright default flag를 뺀 독립 headed 진단에서도 모두 visible이었다. 원인은
미확인이다. 실제 hidden/visible lifecycle을 입증할 환경/host behavior가 필요하다.
같은 차단을 새 근거 없이 반복하지 않는다. 이후 browser eviction/disposal/production
preparation UI assertion은 도달하지 않아 미검증이다. fake port 성공으로 대체하지 않는다.
root/nested AGENTS.md, 이전 chrome report, 요청된 independent runner file은 없었다.
사용자 browser/profile 설정/앱/녹화/mounts를 보존했고 blocked access 우회/다른 agents/
app 설치/push/publish/runner 수정/later stage 진입/credentials/weights/user audio·
transcripts/임시 state commit은 없다.

다음 미완료 항목 또는 차단 해제 조건: **B1 유지, 새 체크 없음.** 실제 foreground tab
전환으로 native document hidden/visible 이벤트를 관측하는 permitted Chromium
환경 또는 누락된 host 동작의 새 근거를 제공한 뒤 unchanged visibility assertion과
나머지 B1 checks를 재실행해야 한다. B2–B6 및 Safari/iPhone은 모두 미완료다.
이 iteration은 progress commit 후 RALPH_BLOCKED로 종료한다.

### 2026-10-07 / chrome / B1 중단 원인 조사 및 수정

관련 commit: 이 기록을 포함한 `fix: unblock browser preparation lifecycle acceptance`.

원인은 Playwright 1.63.0의 기본 focus emulation이었다. Chromium은 해당 CDP
session이 잡은 capture handle로 background tab도 visible로 유지한다. 별도 CDP
session에서 false를 보내거나 browser startup flag를 제거해도 기존 session의
handle은 해제되지 않는다. 같은 test-owned Chromium의 native background tab에서
hidden → focus emulation true로 visible → 동일 session의 false로 hidden → 실제
foreground 전환으로 visible을 직접 확인했다. 사용자 browser/profile/settings는
변경하지 않았으며 synthetic event/property override로 검사를 대체하지 않았다.

검증 harness는 bundled Chromium을 새 임시 profile에서 실행하고 default context에
`connectOverCDP(..., { noDefaults: true })`로 연결한다. 기존 10초 hidden/visible
assertion을 보존하고 owned process/profile을 정리한다. 이후 처음 도달한 실제
eviction 검사에서 status가 삭제한 빈 캐시를 재생성하는 오류도 확인했다. 실패하는
회귀 assertion을 먼저 추가하고 status가 `caches.has`를 확인하게 수정했다.

- FAIL → FIXED: 첫 corrected browser run은 native hidden/visible을 통과한 뒤
  삭제한 cache가 남는 assertion으로 exit 1. Port 회귀도 `Reading evicted status
  must not recreate the deleted cache`로 실패했고 같은 assertion을 유지해 수정했다.
- PASS: `npm run test:framework:chrome:preparation`, exit 0. Typecheck/5 port tests/
  별도 build와 11개 actual browser 검사 모두 통과. 실제 hidden/visible lifecycle,
  eviction/disposal/production UI 포함, page errors `[]`. Pinned model 43,613,734 bytes,
  실제 first preparation 9,408.123458 ms, fresh-worker offline preparation 623.665 ms.
- PASS: `npm run verify`, exit 0. Biome 94 files/no findings, Ruff/typecheck/build,
  JS 82 passed/0 failed, Python 222 passed/66.92 s.
- PASS: `git diff --check`, exit 0.

세부 원인/공식 source와 증거는 chrome 보고서 및 ignored
`.ralph/media-framework/chrome-focus-fix-*.log`에 기록했다. B1 준비 검증만 완료했으며
ASR 정확도/번역/실제 영상부터 자막까지의 B2–B6, Safari/iPhone은 미완료다.
전체 `test:framework:chrome` script는 B5에서 구현할 항목으로 아직 없다. B1만 체크하고
다음 항목은 B2 후보 ASR 실제 비교이다. 자동 loop 재시작/push/publish/앱 설치 없음.

### 2026-10-07 / chrome / iteration 1/5 — B2 ASR 후보 비교 진척

관련 commit: 이 기록을 포함한 `feat: evaluate browser ASR candidates`.

수행한 변경: 다음 미완료 항목 B2만 진행했다. B1 repository/loader를 그대로
재사용하는 bounded utterance ASR document host/worker와 별도 실제 비교 harness
`test:framework:chrome:asr`를 추가했다. 기존 tiny와 multilingual base를 pinned
revision/q8로 등록하고 candidate별 cache, 16 kHz mono float PCM 0.1–30초,
matching duration/identity/epoch, 전체 backing buffer 제한·transfer, 한 active job,
명시적 overload, synchronous Stop/owned worker termination, GPU loss/no fallback을
구현했다. 기존 companion v0.1.0/설치/manifest/native messaging/core/server/settings와
runner를 보존했다. Streaming SpeechRecognizer/VAD/live resampling/번역/화면 연결은
이 utterance executor의 구현 범위가 아니며 B3 이후로 진행하지 않았다.

실행한 명령과 결과:

- PASS: 최종 `npm run verify`, exit 0; Biome 100 files/no findings, Ruff/typecheck/
  build, JS 84 passed/0 failed/0 skipped/cancelled/14501.676542 ms,
  Python 222 passed/66.93 s (`chrome-b2-final-verify.log`). 초기 verify도 통과했다.
- PASS: 최종 `npm run test:framework:chrome:preparation`, exit 0; typecheck/
  5 port tests/build 및 11개 real B1 browser checks. Native visibility/Stop/offline/
  corruption/eviction/disposal/UI 모두 통과, model 43,613,734 bytes, first preparation
  8795.821042 ms, offline restart 561.781833 ms, page errors `[]`
  (`chrome-b2-final-preparation.log`). Loader 공유 후에도 B1을 유지했다.
- FAIL: `npm run test:framework:chrome:asr`, 최종 exit 1
  (`chrome-b2-asr-final-invocation.log`). Typecheck/7 port tests(0 failed/skipped/
  cancelled, 57.821667 ms)/build, 두 model × WASM/WebGPU × 일본어/영어 actual
  recognition, metadata/transfer, real pipeline invocation을 관측한 pending Stop,
  overload/PCM 보존, cached WASM 재시작, actual GPUDevice.destroy → gpu-lost,
  network assertion과 page errors `[]` 모두 관측했다. 단 하나의 최종 실패는
  tiny WASM 일본어 CER 9/40=22.5%가 실행 전 정한 20% gate를 초과한 것이다.
  실패 fixture/gate를 삭제·완화하지 않았고 **B2는 미체크/default 미선택**이다.
- FAIL → FIXED: 초기 두 비교에서 WASM은 실제 전사했지만 GPU는 model-load-failed.
  owned document/worker가 실제 apple/metal-3 adapter를 제공하는 새 근거를 확인한
  뒤 library error `webgpuInit is not a function`을 확보했다. Installed ORT WebGPU가
  asyncify를 요구하는데 jsep factory를 넘긴 오류였다. Matching packaged runtime
  선택으로 동일 models/fixtures/gates의 실제 GPU inference가 통과했다.
- FAIL → FIXED: GPU loss를 일반 Stop으로 잘못 반환한 port 회귀 및 oversized
  backing-buffer view/old-worker loss가 replacement를 무효화하는 회귀를 먼저
  실패시켜 수정했다. 같은 assertion들이 통과한다. Fake transport는 정확도 증거가 아니다.
- FAIL → FIXED: tightened cancellation observer 두 시도는 completed result 뒤에
  Stop을 관측해 실패했다. Independent owned-worker scheduling probe가 separate
  listener의 `called → completed → observer`와 handler wrapper의
  `called → observer → completed`를 확인했다. Observation transport를 test-owned
  MessagePort/wrapper로 수정하고 기존 `ASR stopped` assertion을 그대로 통과했다.
  실제 pipeline call/pending 작업의 종료 증거이며 kernel-level cooperative cancel
  주장은 아니다. 첫 ad hoc GPU probe 실패/정리와 corrected probe도 보고서에 기록했다.
- FAIL: `npm run test:framework:chrome`, exit 1, Missing script
  (`chrome-b2-stage-acceptance.log`). B5의 실제 selected video → ASR → 번역 → DOM
  harness는 아직 미구현이며 B1/B2 command로 stage acceptance를 대체하지 않았다.
- PASS: 최종 targeted Biome 10 files/no findings, typecheck 및 whitespace.
  Staged diff/commit 후 worktree 상태를 확인한다.

실제 검증 범위: owned headed Chromium 153.0.8010.12/Darwin arm64, 기존 합성
VP8/Opus fixture의 decoded PCM 한 speech period를 16 kHz로 resample하여 모델에
입력했다. 일본어 6.97225초/영어 6.6665초이며 selected-video production input은
아니다. Tiny pinned 43,613,734 bytes, base revision
`1846881b6b3a3024392c1eea3ad983695bc23925` 79,664,191 bytes, ONNX hash 검증,
GPU asyncify WASM 26,861,777 bytes/factory 53,057 bytes를 사용했다. 실제 최종
일본어 CER: tiny WASM 22.5%, tiny GPU 20%, base WASM/GPU 17.5%; 영어 WER 모두
1/22=4.54545% (`three` → `3`). 일본어 inference는 약 1.11–2.43초, 영어는
0.95–2.07초였다. Browser-owned process-tree RSS baseline 1,280,640 KiB,
각 mode peak 2,506,656/2,959,952/3,375,680/3,444,816 KiB를 250 ms마다 측정했다.
Shared page/allocator/browser/GPU process를 포함하는 합계이며 isolated model/GPU
allocation, leak, phone memory, 장시간 성능을 의미하지 않는다.

실패·미검증과 증거 위치: [chrome 보고서](docs/verification/media-framework/chrome.md)에
exact final latency/round trip/real-time factor/RSS, semantic errors, model sizes/
checksums/licensing, 각 실패와 수정 및 ignored `chrome-b2-*.log` 위치를 기록했다.
Tiny의 오후/역/예약, base의 회의/예약 오인식을 보존했다. Base의 더 낮은 CER만으로
의미 정확도나 default를 승인하지 않는다. Korean translation/DOM, live stream VAD/
resampling/gap/queue, 10분 playback/backlog/loss, distribution licensing/newer
candidates, Safari/iPhone은 미검증이다. Model load/PCM 획득을 전사 정확도로 대체하지 않았다.

다음 미완료 항목: **B2 유지.** 보존한 일본어 실패를 개선하고 qualified candidate/
profile 및 license evidence를 비교한 뒤 default를 선택해야 한다. 현재 required
환경/device/permission 차단은 없으며 stage complete/blocked marker를 사용하지 않는다.
AGENTS.md와 요청된 independent runner file은 없었고 supplied instructions/plan/
architecture/prior chrome report를 읽었다. 새 checkbox 완료/다른 stage/agents/
runner 수정/push/publish/app 설치나 user apps/recordings/mounts/settings 변경 없음.
Credentials/model weights/user audio·transcripts/temporary `.ralph` state를 제외하고
진척만 commit한다.

### 2026-10-07 / chrome / iteration 2/5 — B2 larger ASR candidate and repeatability

관련 commit: 이 기록을 포함한 `feat: compare larger browser ASR candidate`.

수행한 변경: 다음 미완료 B2만 진행했다. 기존 repository/loader/host에
multilingual `onnx-community/whisper-small` q8 후보를 revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`로 등록했다. Seven-file inventory
251,846,613 bytes와 두 ONNX SHA-256을 고정하고 실제 download에서 검증한다.
기존 tiny/base, failing fixture/hash/6500·9000 Hz tags, 20% CER/WER gate,
Stop/overload/restart/actual GPU loss assertions를 모두 보존했다. 최종 browser
harness는 language/model/backend마다 같은 utterance 3 trials와 mode별 RSS
baseline을 기록하고 모든 trial에 기존 acceptance를 적용한다. B1 준비 후보,
companion v0.1.0/설치/native messaging/server/core/사용자 설정/runner는 변경하지 않았다.
새 설정·자동 fallback·streaming/VAD·번역·화면 연결·다른 stage는 추가하지 않았다.

실행한 명령과 결과:

- PASS: `npm run verify`, exit 0; Biome 100 files/47 ms/no findings,
  Ruff/typecheck/기존 build, JS 84 passed/0 failed/skipped/cancelled,
  15385.631042 ms; Python 222 passed/66.98 s (`chrome-2-verify.log`).
- PASS: `npm run test:framework:chrome:preparation`, exit 0;
  typecheck/5 port tests/build 및 11개 real B1 browser checks 통과.
  Native hidden/visible/explicit restart, Stop/offline/corruption/eviction/disposal/
  production UI 포함, 43,613,734 bytes 유지, first preparation 8831.710167 ms,
  offline preparation 577.712625 ms, page errors `[]` (`chrome-2-preparation.log`).
  Injected fault errors/favicon 404는 보고서에 구분했으며 empty console 주장은 없다.
- FAIL: 첫 `npm run test:framework:chrome:asr`, exit 1
  (`chrome-2-small-asr.log`); typecheck/7 port tests(7 passed/0 failed/skipped/
  cancelled, 99.278041 ms)/build, 세 후보 × 두 backend × 두 언어의 12 scored
  actual utterances와 모든 lifecycle/identity/transfer/network assertion 완료.
  Sole final failure: tiny/WASM Japanese CER 9/40=22.5% > unchanged 20%.
- FAIL: 최종 repeat harness의 같은 ASR command, exit 1
  (`chrome-2-small-asr-repeat.log`); typecheck/7 port tests(7 passed/0 failed/
  skipped/cancelled, 60.067125 ms)/build 및 36 scored actual utterances 완료.
  각 language/mode의 3 trials는 같은 text/error rate를 반환했다. Final failure는
  tiny/WASM Japanese trials 1–3의 CER 22.5%뿐이다. 모든 실제 pending Stop,
  overload/111,556 rejected samples 보존, fresh cached WASM restart,
  actual runtime GPUDevice.destroy → gpu-lost/no fallback, metadata/transfer/
  pinned network checks는 완료됐고 page errors/preparation console errors `[]`.
  실패 baseline/trial/gate를 삭제·완화하지 않았으며 추가 ASR 재시도 없음.
- FAIL: `npm run test:framework:chrome`, exit 1, Missing script
  (`chrome-2-stage-acceptance.log`). B5 full selected-video PCM → ASR → Korean
  translation → DOM harness는 미구현이며 preparation/ASR tests로 대체하지 않는다.
- PASS: targeted Biome, exit 0, 3 changed source/test files/no findings
  (`chrome-2-targeted-lint.log`); 문서 포함 unstaged/staged whitespace 및
  commit 후 clean-worktree를 확인한다.

실제 검증 범위: owned headed Chromium 153.0.8010.12/Darwin arm64,
Node v24.15.0/npm 11.12.1/uv 0.12.23/Python 3.12.15. 기존 합성 VP8/Opus 영상의
decoded PCM을 16 kHz로 resample한 일본어 6.97225초/영어 6.6665초이며 live
selected-video capture나 Korean captions는 아니다. Final Japanese CER는
모든 trial에서 tiny/WASM 22.5%, tiny/WebGPU 20%, base 양쪽 17.5%, small 양쪽
1/40=2.5%; English WER는 모두 1/22=4.54545%이다. Small은 테스트된 부정/시간/
역/예약 취소 금지 의미를 보존하지만 첫 run 및 모든 repeat가 speech duration보다
느렸다. Final inference ranges: small/WASM Japanese 7869.900–8040.800 ms,
English 7698.900–7702.400 ms; small/WebGPU Japanese 7446.000–7665.100 ms,
English 7055.900–7067.400 ms. Repeat real-time factors는 약 1.058–1.155이다.
Tiny/base semantic errors와 숫자 三/three → 3 edit는 그대로 유지한다.

실패·미검증과 증거 위치: [chrome 보고서](docs/verification/media-framework/chrome.md)에
exact model sizes/hashes, first-run timings, 6 modes의 final min/max inference/
host round trip, mode baseline/peak RSS, semantic errors, commands 및 ignored
`chrome-2-*.log`를 기록했다. RSS는 250 ms마다 owned browser process tree를 합산하며
shared pages/allocator/prior residency를 포함한다. Model/GPU allocation, leak test,
phone memory나 sustained profile을 입증하지 않는다. 2026 Qwen3-ASR official
release/license 및 두 upstream inventory(no ONNX)/installed JS model support
(no qwen3_asr matches)를 확인했으며 실제 browser accuracy 비교나 weights download는
하지 않았다. Whisper upstream MIT와 conversion card는 확인했지만 distribution
license confirmation은 미완료다. Long speech/VAD/gap/live streaming/resampling,
sustained queue/GPU recovery/memory, broader recognition quality, B3–B6 Korean
translation/revisions/DOM/offline end-to-end/10분 검증 및 Safari/iPhone은 미검증이다.

다음 미완료 항목: **B2 유지, 새 checkbox/default 없음.** 보존한 의미 정확도와
지속 처리 속도를 함께 만족하는 profile 및 distribution license를 검증한 뒤
default를 선택한다. 현재 required environment/device/permission 차단은 없다.
새 근거 없이 동일 accuracy failure를 다시 실행하는 것은 다음 작업이 아니다.
AGENTS.md 및 요청된 independent runner file은 없었고 supplied instructions/plan/
architecture/prior report를 읽었다. Worktree 밖 작업, unrelated files/user settings/
앱/녹화/mount 변경, agents/runner 수정/stage advance/push/publish/app installation
없음. Credentials/model weights/user audio·transcripts/임시 `.ralph` state는 commit에서
제외한다. Stage/whole-framework/iPhone 완료를 주장하지 않는다.

### 2026-10-07 / chrome / iteration 3/5 — B2 FP16 WebGPU profile

관련 commit: 이 기록을 포함한 `feat: compare FP16 browser ASR profile`.

수행한 변경: 다음 미완료 B2만 진행했다. Small q8의 실제 처리 속도가 발화 길이보다
느린 근거에 따라 동일 pinned `onnx-community/whisper-small` revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`의 FP16 WebGPU profile을 추가했다.
7개 model files 487,960,440 bytes와 encoder/decoder SHA-256을 고정하고 실제
다운로드에서 검증한다. Registry/repository/loader가 precision을 전달하고 q8/FP16
cache를 분리한다. 기존 호출은 q8 그대로이며 FP16/WASM은 host가 worker 생성 전에,
worker가 download 전에 거부하고 loader도 검사한다. 자동 fallback/새 사용자 설정은
없다. 모든 기존 candidate/backend/fixture/hash/tag/3 trials/20% CER·WER gate와
Stop/overload/restart/actual GPU loss acceptance를 보존했다. Cache 소유권 및
unsupported backend fake-port 검사를 추가했다. Native visibility/error-state logging,
실제 owned-tab foreground 확인과 100 ms timer polling으로 중단 증거를 개선했고
240초/120초 timeout 및 모든 원래 assertion은 유지했다.

실행한 명령과 결과:

- FAIL → FIXED: 초기 typecheck + 두 port test files, exit 1; typecheck PASS,
  7 passed/1 failed/100.5415 ms. 새 inventory expected total을 487,957,440으로
  잘못 입력했다. 실제 pinned file sizes의 합 487,960,440으로 수정했고 cache isolation
  assertion과 recognition gate를 유지했다. 이후 final port tests는 8 passed/0 failed.
- FAIL: 첫 `npm run test:framework:chrome:asr`, exit 1
  (`chrome-3-fp16-asr.log`). Typecheck/8 port tests(80.7315 ms)/build 및 tiny/base의
  24 scored utterances/lifecycle checks 후 small WASM preparation에서 240000 ms
  timeout. Owned document read-only snapshot: prepared=false, prepareError=
  `ASR stopped`, downloading=9,355,814/251,846,613 bytes. Browser 종료 전 native
  visibility를 확보하지 못해 중단의 정확한 원인은 미확인이다. Small inference/FP16/
  최종 network/page-error checks는 미도달이며 성공 증거로 표시하지 않는다.
- FAIL: 한 번의 독립 second `npm run test:framework:chrome:asr`, exit 1
  (`chrome-3-fp16-asr-second.log`). Final typecheck/8 port tests(8 passed/0 failed/
  skipped/cancelled, 59.307834 ms)/build, 7 modes × 2 languages × 3 trials =
  **42 actual scored utterances**, metadata/transfer, invocation-observed pending
  Stop/overload/111,556 rejected samples 보존, cached WASM recognition 재시작,
  cached GPU preparation 및 실제 runtime GPUDevice.destroy → gpu-lost/no fallback,
  pinned network assertions 모두 완료했다. Final failure는 유지한 tiny/WASM 일본어
  trials 1–3의 CER 9/40=22.5% > 20%뿐이다. 모든 native visibility event list는
  빈 배열, final document는 visible, page errors 및 mode preparation console errors
  `[]`. 첫 중단은 재발하지 않았으며 세 번째 ASR attempt는 하지 않았다.
- PASS: `npm run test:framework:chrome:preparation`, exit 0
  (`chrome-3-preparation.log`); typecheck/6 port tests(56.79475 ms)/build와 11개 real
  B1 checks 모두 통과. Native hidden/visible/explicit restart, Stop/offline/corruption/
  eviction/disposal/UI 포함, tiny q8 43,613,734 bytes 유지, first preparation
  9011.317166 ms, offline fresh-worker preparation 539.234084 ms, page errors `[]`.
  Injected fault console errors와 favicon 404는 보고서에 구분했다.
- PASS: `npm run verify`, exit 0 (`chrome-3-verify.log`); Biome 100 files/44 ms/
  no findings, Ruff/typecheck/기존 build, JS 85 passed/0 failed/skipped/cancelled/
  14889.341209 ms; Python 222 passed/66.96 s.
- FAIL: `npm run test:framework:chrome`, exit 1, Missing script
  (`chrome-3-stage-acceptance.log`). B5 full selected-video → ASR → Korean translation
  → DOM harness는 미구현이며 preparation/ASR tests나 placeholder로 대체하지 않았다.
- PASS: final targeted Biome, exit 0, 11 files/20 ms/no findings. 최종 문서 포함
  unstaged/staged whitespace 및 commit 후 clean-worktree를 확인한다.

실제 검증 범위: owned headed Chromium 153.0.8010.12/Darwin arm64,
Node v24.15.0/npm 11.12.1/uv 0.12.23/Python 3.12.15, 동일 Transformers.js 4.3.0/
locked ORT. 기존 hash-checked synthetic video를 decode/16 kHz resample한 일본어
6.97225초/영어 6.6665초이며 live selected-video PCM/번역/DOM은 아니다. FP16의
모든 trial CER 1/40=2.5%, WER 1/22=4.54545%; 테스트한 회의 부정/내일 오후 세 시/
역/예약 취소 금지 의미를 보존했다. 숫자 三/three → 3 edit는 정규화하지 않았다.
FP16 inference/host round-trip ranges: Japanese 726.400–1386.300 /
727.600–1388.300 ms, English 616.900–633.800 / 617.800–634.800 ms;
real-time factors 0.104184–0.198831 / 0.092537–0.095072. Fresh preparation
58487.16425 ms, mode baseline/peak owned browser-tree RSS 2,400,928/3,501,280 KiB.
이 수치는 worker/document별 독립 clock과 250 ms sampled process-tree 합계이며
isolated GPU allocation/leak/장시간/phone qualification은 아니다. 기존 tiny/base 의미
오류와 small q8의 RTF > 1은 보존했고 모든 mode의 3 trial text는 동일했다.

실패·미검증과 증거 위치: [chrome 보고서](docs/verification/media-framework/chrome.md)에
7 modes의 exact min/max latency/round trip/CER/WER/RSS, FP16 file sizes/hashes,
공식 dtype docs/pinned metadata 및 installed shader-f16 check, interruption 진단과
ignored `chrome-3-*.log`를 기록했다. Distribution licensing은 계속 미확인이다.
Live streaming/VAD/resampling/gap/queue와 sustained GPU recovery/memory, broader
speech quality, B3–B6 번역/revision/DOM/offline end-to-end/10분 검증 및 Safari/iPhone은
미검증이다. Model loading/PCM 획득/mock port를 실제 전사 정확도로 표시하지 않는다.

다음 미완료 항목: **B2 유지/default 미선택/checkbox 추가 없음.** FP16 desktop
profile의 bounded streaming/gap/queue 근거와 distribution license를 검증한 뒤 default를
선택한다. Second run 후 required environment/device/permission 차단은 없으며 first
interruption root cause만 미확인이다. 재발하면 기록된 native visibility/document state와
허용된 foreground 실행 환경을 확인하고 새 근거 없는 두 독립 실패 후 멈춘다.
AGENTS.md 및 요청된 independent runner file은 없었고 supplied instructions/plan/
architecture/prior report를 읽었다. Companion v0.1.0/설치/native messaging/server/core/
사용자 설정/관련 없는 파일/앱/녹화/mounts를 보존했다. Agents/runner 수정/stage advance/
push/publish/app installation/browser permission·profile 우회 없음. Owned test browsers만
정리하며 credentials/weights/user audio·transcripts/temporary `.ralph` state는 commit에서
제외한다. Chrome stage/전체 framework/iPhone 완료를 주장하지 않는다.

### 2026-10-07 / chrome / iteration 4/5 — B2 bounded streaming speech port

Related commit: `feat: bound browser speech recognition streams`, containing
this progress entry and the [Chrome report](docs/verification/media-framework/chrome.md).

Changes: implemented the existing SpeechRecognizer port around the prepared ASR
host. Experimental 16 kHz mono Float32 input only, 200 ms/12,800-byte maximum
chunk, 20 ms RMS energy frames (0.01), 500 ms silence endpoint, 30 s maximum
segment, one active inference/two pending utterances, 30 s retained unrecognized
input and two undelivered results. Gap/sequence/clock/identity/epoch changes and
overload invalidate affected context, expose discarded duration and stop only the
owned worker; cancel/input cleanup rejects late results. Added six fake-executor
port checks and a distinct real `test:framework:chrome:stream` harness. Preserved
all original candidates, fixture samples/hashes/tags, accuracy gates and failed
baselines; no default, user setting or checkbox was changed.

Commands and actual results:

- FAIL then corrected: initial typecheck (six ES2022 Array.fromAsync type errors)
  and initial port test (4 passed/1 failed, 88.672584 ms). Kept ES2022, added a
  local collector and corrected the new arbitrary-frame expected length to
  19,110 samples/1314.375 ms EOF. Later TS2352 on deliberately invalid shared
  buffer test casting was corrected via unknown. No accuracy gate was weakened.
- PASS: first `npm run test:framework:chrome:stream`, exit 0,
  `chrome-4-stream-first.log`: typecheck/5 port tests (48.7225 ms)/build, six real
  scored utterances, gap/overload/actual invocation-observed cancel/GPU loss,
  pinned network/identity/range checks. Read-only Python assertions on all six
  actual outputs passed the preserved meaning anchors.
- PASS: final same streaming command, exit 0, `chrome-4-stream-final.log`:
  typecheck/6 port tests (52.412334 ms)/production build and every real browser
  assertion, now including semantic anchors and 2 s pure zero PCM (0 ASR calls,
  0 transcripts/discarded audio). Final source also rejects shared buffers and
  releases the owned input reference. Normal runs have 0 ms audio loss/backlog
  after drain; deliberate overload discards 29,940 ms (pending peak 29,840 ms),
  gap 100 ms, invoked cancel 7480 ms, actual device loss 7180 ms, each explicit
  with no transcript revival/fallback. Page errors/visibility events/failures [].
- PASS: initial `npm run verify`, exit 0, `chrome-4-verify.log`: Biome 103 files/
  46 ms/no findings, Ruff/typecheck/companion build, 91 JS passed/0 failed/skipped/
  cancelled (15133.193042 ms); 222 Python passed/66.97 s.
- PASS: final `npm run verify`, exit 0, `chrome-4-verify-final.log`, after all
  source/test edits: same lint/typecheck/build, 91 JS passed/0 failed/skipped/
  cancelled (14579.564375 ms), 222 Python passed/66.93 s.
- PASS: final standalone six port tests, exit 0, 73.611916 ms
  (`chrome-4-speech-port-final.log`); final targeted Biome, 3 files/no findings,
  exit 0 (`chrome-4-targeted-lint.log`); document-inclusive unstaged/staged
  whitespace and clean committed worktree checks before delivery.
- FAIL: required `npm run test:framework:chrome`, Missing script, initial
  `chrome-4-stage-acceptance.log`; isolated confirming invocation exit 1,
  `chrome-4-stage-acceptance-exit.log`. B5's full selected-video → ASR → Korean
  translation → DOM harness is unimplemented. No further retry, placeholder or
  ASR/preparation substitute was added.

Real scope: owned headed Chromium 153.0.8010.12/Darwin arm64, Node v24.15.0/
npm 11.12.1/uv 0.12.23/Python 3.12.15, unchanged Transformers.js 4.3.0/ORT and
pinned small FP16 profile (487,960,440 model bytes). Both runs decode/resample
existing synthetic video speech, retain the isolation tones, append explicit
zero silence and pace 100 ms chunks: 22.8 s Japanese + 21.9 s English, **44.7 s**
per invocation, not live selected-element capture or ten-minute acceptance.
Final 3 trials each: Japanese CER 1/40=2.5%, English WER 1/22=4.54545%; 三/three
→ 3 remains an edit. Meaning anchors pass. Endpoint-to-result ranges are
Japanese 747.400–852.400 ms / English 664.800–816.000 ms, one document clock,
not speech-to-first-caption latency/percentiles. Final model preparation
53687.332208/1244.739875 ms; pending maxima 8180/7880 ms; mode baseline/peak
browser-tree RSS KiB 1,286,528/3,521,872 and 2,678,640/3,766,784. RSS includes
shared pages/allocator/browser/GPU process at 250 ms samples, not isolated GPU
allocations, leaks or phone limits. Each invocation downloaded one FP16 inventory
in an owned context and reused its cache for later workers; no weights/profile
or temporary logs are committed. Detailed first/final measurements and exact
fault/development evidence are in the Chrome report and ignored chrome-4 logs.

Next unfinished item: **B2 stays unchecked; no default selected.** Qualify live
selected-video normalization, natural silence/noise VAD and boundary-spanning
speech, sustained queue/GPU recovery/memory and broader meaning accuracy; resolve
conversion/distribution licensing before selection. Fake 30+1 s segmentation
and the isolation-tagged speech do not establish long/natural speech quality.
B3–B6 translation/revision/DOM/offline end-to-end/ten-minute acceptance and all
Safari/iPhone work remain unverified. No required environment/device/permission
blocker was observed. No stage/whole-framework/iPhone completion is claimed.
No AGENTS.md/requested runner file exists; supplied instructions, plan, full
architecture and prior report were read. Companion/published installation/native
messaging/server/settings and unrelated files/apps/recordings/mounts preserved.
No agents, runner edits, stage advance, push/publish/app installation or blocked
browser-access bypass. Credentials, weights, user audio/transcripts and `.ralph`
state are excluded from the commit.

### 2026-10-07 / chrome / iteration 5/5 — B2 selected-video normalization, blocked

Related commit: `feat: normalize selected-video audio for browser ASR`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 stays unchecked; no default or subsequent stage was selected.**

Changes: added bounded streaming normalization at the browser engine boundary
for the existing mono Float32 selected-element worklet (8192-byte input maximum,
16/44.1/48 kHz → 16 kHz). Continuous 64-tap windowed-sinc filtering rejects
aliases without resetting at chunk boundaries; output clocks/ranges retain their
anchors, EOF duration differs by less than 0.0625 ms, and output is at most
200 ms/3200 samples. Identity/epoch/sequence/rate/clock gaps release the input
without joining surviving samples. Added five signal/lifecycle tests and fixed
the speech port's loss of upstream `audio-gap` status after first demonstrating
a failing regression. No graph, companion PCM1 rate, setting, model identity,
candidate comparison, numerical gate, failed baseline or fixture sample changed.

Extended `test:framework:chrome:stream` with a distinct real selected-video
catalog/input → normalizer → speech/FP16 worker fixture. Intended checks include
two simultaneously playing videos, pre-filter isolation tones, video mapping,
actual recognition/meaning, finite EOF, explicit Stop/repeat Start and preserved
playback state. This is B2 input qualification, not B3–B6 Korean caption work.
**The live path did not pass.**

Commands and results:

- FAIL then fixed: initial port tests 11 passed / 1 failed (140.735750 ms),
  upstream gap mislabeled `engine-failed`; isolated same regression exit 1,
  0 passed / 1 failed (43.337917 ms). After fix, typecheck/twelve tests exit 0
  (94.612333 ms). Final rate-change test refinement: 12 passed / 0 failed/
  skipped/cancelled (152.052208 ms). These are synthetic/fake-executor checks,
  not transcription accuracy.
- FAIL then fixed: initial `npm run verify`, exit 1, five Biome fixture
  track/button errors plus one template style notice. Added empty tracks and
  button types/literal, without feeding subtitle text to ASR. Corrected verify
  exit 0 (`chrome-5-verify-final.log`): Biome 106 files/31 ms, Ruff/typecheck/
  companion build, 97 JS passed/0 failed/skipped/cancelled (15320.720834 ms),
  222 Python passed/66.80 s. Final source recheck is recorded in the report.
- PASS: concluding `npm run verify`, exit 0,
  `chrome-5-verify-completed-sources.log`, after all source/test changes:
  Biome 106 files/45 ms/no findings, Ruff/typecheck/unchanged companion build,
  97 JS passed/0 failed/skipped/cancelled (15082.746958 ms),
  222 Python passed/66.93 s. Repository regressions, not live interpretation.
- FAIL/BLOCKED: two `npm run test:framework:chrome:stream` invocations, both
  exit 1 (`chrome-5-stream-first.log`, `chrome-5-stream-second.log`). Typecheck,
  twelve port tests (112.928792 / 97.676916 ms), build, six real decoded ASR
  trials and every existing fault assertion passed in each invocation. Both
  stalled at the first live Japanese capture's unchanged 30,000 ms timeout.
- FAIL: required `npm run test:framework:chrome`, exit 1,
  `chrome-5-stage-acceptance.log`: Missing script. B5's selected-video → ASR →
  Korean translation → DOM harness remains unimplemented. No placeholder,
  preparation/ASR substitute or additional retry was added.
- PASS: final targeted Biome, six edited source/test files/5 ms/no findings,
  exit 0; final document-inclusive unstaged/staged whitespace checks, exit 0,
  committed intended changes and worktree status checked before delivery.

Real verified scope: owned headed Chromium 153.0.8010.12/Darwin arm64, Node
v24.15.0/npm 11.12.1/uv 0.12.23/Python 3.12.15, unchanged libraries/pinned small
FP16 WebGPU model (487,960,440 bytes). Each invocation downloaded one inventory
in its owned context and reused it. The six decoded, paced synthetic utterances
per invocation retained all samples/tags, passed Japanese CER 1/40=2.5% and
English WER 1/22=4.54545% and meaning anchors, with 0 loss and drained backlog.
44.7 s input per run is not ten-minute/live selected-video acceptance. Second
endpoint-to-result ranges: Japanese 748.200–851.100 ms, English 648.500–709.400 ms;
pending maxima 8180/7780 ms. Mode baseline/peak browser-tree RSS KiB:
1,281,232/3,182,368 and 1,699,072/3,809,104. Same process/shared-page/allocator/
GPU-process caveats as prior reports; not GPU allocations, leak/device limits or
caption latency. Exact first/second timings, pure silence, overload/gap/cancel/
actual GPU-loss evidence and limitations are in the report; logs/weights/profile
bytes are not committed.

Blocker and resume: **two independent live attempts** stalled. Second failure
snapshot: both videos time 0, paused false, ended/seeking false, readyState 4,
no media errors; raw input 0 chunks/0 samples, normalized input 0, transcripts 0;
speech port running with 0 pending/loss; document visible/no visibility events,
model ready. Required native playback/capture did not advance. Root cause,
AudioContext clock and any device/host involvement are unverified; no specific
permission denial/missing hardware is claimed. Stop further browser attempts
without new evidence. Resume in a permitted Chromium environment where these
videos advance and the selected worklet produces PCM, or after new evidence
identifies/corrects this stall, then retain and rerun all live assertions.

Next unfinished item is **B2**: actual live normalization/ASR/isolation/mapping/
Stop and repeat Start remain unverified, as do broader natural silence/noise/
boundary speech, sustained recovery/memory and licensing/default qualification.
All B3–B6/Safari/iPhone checks remain unfinished. No stage/whole-framework/iPhone
completion is claimed. No AGENTS.md/requested runner file exists; instructions,
plan, architecture/report read. Published companion/install/native/server paths,
settings, unrelated files/apps/recordings/mounts preserved. No agents, runner edit,
stage advance, push/publish/app install or browser-access bypass. Credentials,
weights, user audio/transcripts and temporary `.ralph` state excluded from commit.

### 2026-10-07 / Chrome B2 live-input 중단 해결 — runner 절전 방지

관련 commit: `fix: keep Ralph awake across iterations`.

실패 시간의 macOS power log에서 06:17:51 iteration 소유 caffeinate 종료 → Idle
Sleep → 06:17:54 DarkWake 651초를 확인했다. 두 실제 영상 검증 실패가 이 구간에
발생했다. 다음 iteration의 system-sleep guard는 이미 DarkWake가 시작된 후 생성돼
실제 화면/미디어 clock 복귀를 보장하지 못했다. 현재 깨어 있는 상태에서 동일한
fixture/model/production input/normalizer와 모든 기존 수치·timeout 기준이 통과했다.

runner는 macOS에서 전체 invocation을 `caffeinate -disu`로 감싼다. 내부 inherited
marker로 중복 guard를 피하고 모든 iteration/stage 전환 사이에도 assertion을
유지한다. command 종료 시 해제하고 dry-run/영구 전원 설정은 보존한다.

- FAIL → PASS: outer guard 없음 회귀를 먼저 확인한 뒤 수정. Runner 20 tests 통과.
- PASS: 실제 macOS `pmset`으로 owned display/system/user-active assertion을 확인하고
  종료 후 모두 해제됨을 검증. 이 lifecycle 검사만의 npm commands는 stubs였다.
- PASS: 진단 instrumentation 없는 `caffeinate -disu npm run test:framework:chrome:stream`,
  exit 0. 12 port tests, 6 decoded ASR trials, fault gates 및 실제 영상 4 rounds 통과.
  일본어 완료 2회 CER 2.5%, 영어 WER 4.54545%, Stop은 cancelled/text 없음.
  최대 실제 영상 mapping 오차 51.233334 ms, 최종 packet→text 943.7/881.4/794.7 ms.
  두 audible 영상 재생 상태/입력 분리/normalization/Stop·repeat Start 및 zero-loss
  기준을 유지했다. 실제 samples/수치/명령은 Chrome 보고서에 기록했다.
- PASS: `npm run verify`, exit 0, lint/typecheck/build, JS 98 passed,
  Python 222 passed/66.90 s; 최종 whitespace 검사 통과.

증거는 Chrome 보고서와 ignored `.ralph/media-framework/chrome-{sleep,live}-*.log`.
Production media/ASR/model/fixture/acceptance는 변경하지 않았다. 실제 sleep/lid-close를
강제로 만들지 않았고 사용자 앱/profile/settings/녹화/mount는 보존했다. 실제 입력
차단은 해제됐지만 B2의 broader quality/noise/boundary/sustained-memory/licensing/
default qualification은 아직 미완료이므로 B2 checkbox는 유지한다. 다음 항목은
B2의 남은 비교·자격 검증이다. B3–B6/Safari/iPhone 및 full Chrome acceptance는 미완료.
자동 loop 재시작/push/publish/앱 설치 없이 수정과 증거만 커밋한다.

### 2026-10-07 / chrome / iteration 1/5 — resumed B2 continuous-input headroom

Related commit: `fix: reserve browser ASR queue headroom`, containing this entry
and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default is selected.** Only B2 was extended.

Changes: added five-copy Japanese/English decoded-fixture trials with no appended
silence, preserving every source sample, original isolation tone, hash, prior
candidate failure and acceptance gate. The new real check first failed in both
languages at 30.1 s: a full 30 s inference job occupied the entire 30 s retained
audio budget, so the next 100 ms packet caused overload and discarded 30100 ms.
Both runs had zero completed transcripts. This is a queue/profile defect,
not the historical native-clock blocker or successful ASR accuracy.

Reduced only the experimental segment maximum to 20 s, leaving 10 s headroom
within the unchanged 30 s queue budget/model job bound. Kept one active job,
two pending jobs/two undelivered results, explicit loss and late-result rejection.
Added a stalled-inference regression and asserted contiguous 20+11 s segmentation.
No playback, model/backend/default, settings or companion protocol was changed.
Continuous acceptance requires full input, zero loss, contiguous bounded final
results, unchanged <=0.2 CER/WER and every existing meaning anchor five times.

Commands and actual results (ignored evidence under `.ralph/media-framework/`):

- FAIL → PASS: `caffeinate -disu npm run test:framework:chrome:stream`,
  **exit 1 then 0**, `chrome-20261007-1-{boundary,headroom-stream}.log`.
  Before fix: twelve port tests and all six short ASR/fault/four live rounds
  passed; both continuous trials failed `overloaded` at 30100 ms with no text.
  After fix: thirteen tests (96.437416 ms), build and every real assertion pass.
  No third browser run or acceptance weakening.
- PASS: final source/harness `npm run verify`, **exit 0**,
  `chrome-20261007-1-headroom-verify.log`: Biome 106 files/39 ms/no findings,
  Ruff/typecheck/unchanged companion build, **99 JS passed / 0 failed/skipped/
  cancelled** (20698.714041 ms), **222 Python passed** (66.83 s).
  Earlier pre-fix verifies also passed: 98 JS/222 Python (21920.786917 ms/66.85 s)
  and 99 JS/222 Python (23866.759542 ms/66.93 s); not real continuous acceptance.
- PASS: pre-fix eight speech-port tests (408.528375 ms), post-fix typecheck /
  thirteen port-normalizer tests (105.021542 ms), targeted Biome three files.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, unchanged
  `Missing script: "test:framework:chrome"`, `chrome-20261007-1-stage-acceptance.log`.
  B5's real selected-video → ASR → Korean translation → DOM harness remains
  unimplemented. No placeholder or B2-command substitute was added.
- PASS: document-inclusive unstaged/staged whitespace and post-commit worktree
  cleanliness checked before delivery.

Real measured scope: owned headed Chromium 153.0.8010.12 / Darwin 25.6.0 arm64,
Node v24.15.0/npm 11.12.1/uv 0.12.23/Python 3.12.15. Unchanged small FP16 WebGPU
profile, revision `36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files /
487960440 bytes, one fresh inventory per invocation and cached subsequent loads.
Five complete synthetic periods now deliver Japanese 557780 samples/34861.25 ms,
English 533320/33332.5 ms. Each returns two contiguous final ranges split at
20000 ms, **0 ms loss / 0 pending**, max pending **21800 / 21500 ms**. Japanese
CER **7/200 = 3.5%** includes five 三→3 edits plus duplicated ない at the join;
English WER **5/110 = 4.54545%**. Every meaning anchor count is **5**.
Actual host job round trips: Japanese 1816.900/1305.500 ms; English
1510.800/1044.100 ms. RSS baseline/peak KiB: 1645568/3813840 and
2355744/3698976. These process-tree samples/round trips are not isolated GPU
allocation, leaks, physical limits, percentiles or caption latency.

Existing short trials and four live rounds also pass. Live Japanese twice CER
2.5%, English WER 4.54545%, zero normal loss, max mapping 46.111334 ms,
last-packet-to-text 881.700/942.600/822.600 ms. Stop reports cancelled/no text;
capture detaches, repeat Start and original playback/isolation assertions pass.
Pure zero PCM, overload/gap/invocation-observed cancellation/actual GPU loss
remain explicit passing fault checks. Exact initial/final numbers, limits,
commands and evidence paths are in the Chrome report; no user transcripts,
weights/profile bytes or temporary `.ralph` state are committed.

Next unfinished item: **B2**, broader natural speech/noise/boundary quality,
sustained queue/GPU recovery/memory and licensing/default qualification. The
20 s segment is experimental, with finite headroom; passing repeated synthetic
decoded input is not natural VAD, long live speech or ten-minute acceptance.
B3–B6/Korean translation/revision/DOM/offline interpretation/Safari/iPhone and
external installation remain unfinished. No required environment/device/permission
blocker was observed; no blocked/stage-complete marker applies. No checkbox changed.
AGENTS.md/requested independent runner file were absent; instructions/plan/
architecture/report read. Published companion/settings/unrelated files/user apps/
recordings/mounts preserved. No agents/runner edits/stage advance/push/publish/
app installation/browser-access bypass. No whole-framework/iPhone completion.

### 2026-10-07 / chrome / iteration 2/5 — B2 active GPU loss and recovery

Related commit: `test: verify browser ASR recovery after GPU loss`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default is selected.** Only B2 qualification advances.

Changes: extended the existing real streaming harness with an observed actual
recognition invocation followed by destruction of its actual runtime GPUDevice,
for both Japanese and English. Assert explicit `gpu-lost`, audio discard, no text,
no automatic replacement and rejected retry with retained caller PCM. A real
Prepare-button click must reload the same model from cache on the same host,
create exactly one replacement worker and permit fresh-epoch recognition.
Three complete paced utterances per language must pass every existing numerical/
meaning/identity/range/queue gate without loss or remote downloads. Production
host/worker/model/profile, existing fixtures, failed baselines and gates are
unchanged; the idle GPU-loss check is preserved. No production bug was observed.

Commands and evidence (ignored `.ralph/media-framework/` logs):

- PASS: `caffeinate -disu npm run test:framework:chrome:stream`, **exit 0**, one
  browser invocation, `chrome-20261007-2-gpu-recovery-stream.log`. Typecheck,
  thirteen port/normalizer tests (98.194250 ms), build and all original/new
  real assertions pass. No retry or lowered threshold.
- PASS: final `npm run verify`, **exit 0**, `chrome-20261007-2-verify.log`:
  Biome 106 files/49 ms/no findings, Ruff/typecheck/unchanged companion build,
  **99 JS passed / 0 failed/skipped/cancelled** (21628.020917 ms),
  **222 Python passed** (66.87 s). Repository regression scope only.
- FAIL: required `npm run test:framework:chrome`, **exit 1**,
  `chrome-20261007-2-stage-acceptance-exit.log`, missing script. The first shell
  wrapper also printed this same npm failure and returned 0 after `cat`; that
  wrapper return is not a pass. B5 full interpretation acceptance is unimplemented.
- PASS: targeted Biome one file/no findings, final document-inclusive unstaged/
  staged whitespace, exit 0; intended commit and clean worktree checked.

Real scope: owned headed Chromium 153.0.8010.12, macOS 26.6.2/25G83 arm64,
Node v24.15.0/npm 11.12.1/uv 0.12.23, unchanged small FP16 WebGPU profile at
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files/487960440 bytes.
One inventory was downloaded in the fresh context, subsequent prepares cached.
Active Japanese/English jobs 0–7480 ms/119680 samples and 0–7180/114880 were
observed and interrupted; loss **7480 / 7180 ms**, **0 pending / 0 text**, no
automatic worker replacement. Interrupted-job accuracy is unverified. Explicit
same-host cached recovery took **1235.679125 / 1232.231791 ms**; fresh epoch 4
trials all scored **2.5% CER / 4.54545% WER**, every meaning anchor, **0 loss /
0 pending**, max pending **8180 / 7680 ms**, **0 HTTPS requests**. Endpoint-to-text
ranges **764.400–854.900 / 645.800–678.700 ms**, input **22.8 / 21.9 s**.
Recovery RSS baseline/peak KiB **1938016/3547248 / 1529408/3732448**; process-tree
sampling caveats in the report, not leak/hardware-pressure/mobile evidence.

All earlier six decoded trials, overload/gap/Stop/idle GPU-loss/pure silence,
four live selected-video rounds and both five-copy continuous trials pass.
Live final-packet-to-text **925.700/864.300/769.800 ms**, maximum mapping error
**48.513 ms**, playback/isolation preserved. Continuous CER/WER **3.5%/4.54545%**,
every meaning anchor count 5, max pending **21700/21500 ms**, zero loss/drained.
Full numbers, original signal/sample counts and timing boundaries are in the report.

Next remains **B2**: broader natural speech/noise/boundary quality, sustained
queue/recovery/memory limits, licensing and default selection. Two finite loss
cycles with short decoded recovery are not long live speech, a ten-minute run,
natural VAD, storage/GPU pressure, full offline interpretation or Korean captions.
B3–B6/Safari/iPhone remain unverified. No absent environment/device/permission
blocker was observed, so no terminal marker or checkbox change applies.
Published companion/settings and unrelated state preserved; no agents, runner
edits, stage advance, push/publish/install or browser-access bypass. No AGENTS.md/
requested runner failure file exists. Logs/weights/profile/user audio/transcripts
are excluded from commit. Work stays in this worktree.

### 2026-10-07 / chrome / iteration 3/5 — B2 live multi-period boundary qualification

Related commit: `test: expose live browser ASR boundary quality failure`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default is selected.** Only B2 was extended.

Changes: added three-period live Japanese/English trials using the original
hash-checked 24-second videos and production selected-video input/normalization/
ASR. Recorded actual host calls, delivered samples during inference, ranges,
mapping, bounded queues and RSS. Retained all original trials, failed baselines,
Stop/restart/isolation/playback assertions and numerical/meaning/latency gates.
Extended quality failures are retained while collecting the other language and
still rejected by the final assertion. Production/model/profile/settings/companion
and fixture bytes are unchanged. No later-stage implementation was started.

Commands and actual results (ignored `.ralph/media-framework/` evidence):

- FAIL: first `caffeinate -disu npm run test:framework:chrome:stream`, **exit 1**,
  `chrome-20261007-3-live-boundary-stream.log`: typecheck, thirteen port tests
  (**94.776750 ms**) and build pass; new first-range assertion incorrectly
  expected 0 instead of the energy gate's **60 ms quiet prefix**. Corrected
  only this new test assumption; extended trials were not reached.
- FAIL: second same command, **exit 1**,
  `chrome-20261007-3-live-boundary-stream-second.log`: thirteen port tests
  (**105.335500 ms**), original decoded/fault/recovery/four live checks pass.
  Extended Japanese actual recognition fails **56/120 = 46.66667% CER** against
  unchanged **20%** gate. Real samples, contiguous two segments, zero loss/drained
  queue pass; returned extra repeated phrases. Extended English was not reached.
- FAIL: third same command, **exit 1**,
  `chrome-20261007-3-live-boundary-stream-final.log`: thirteen port tests
  (**101.378583 ms**), prior checks pass; Japanese independently reproduces
  **56/120 CER**. English returns three complete utterances, then a new inferred
  count assertion fails **1 !== 2** because the last **13.3125 ms** is classified
  quiet, with **0 reported discard**. Corrected only the new speech-span count
  and allowed one **<20 ms** trailing quiet frame, retaining the zero-discard
  gate. No further browser attempt after two independent Japanese quality failures.
  Later five-copy continuous trials were not reached in these three commands.
- PASS: local Python checks against the third run's recorded results, **exit 0**,
  corrected bounded quiet prefix/tail, contiguous ranges, final identity/revision,
  zero discard/drained and bounded queues. Recomputed Japanese **56/120 CER**,
  English **3/66 = 4.54545% WER**. This is recorded-result analysis, not fresh
  browser acceptance. Final revised browser assertions remain **unverified in
  a fresh run**; retained Japanese failure still prevents qualification.
- PASS: `npm run verify`, **exit 0**, `chrome-20261007-3-verify.log`: Biome
  **106 files / 45 ms / no findings**, Ruff/typecheck/unchanged companion build,
  **99 JS passed / 0 failed/skipped/cancelled / 21574.524625 ms**,
  **222 Python passed / 66.95 s**. Its lint preceded the last test-only range
  correction; final two-file Biome (**8 ms**) and `node --check` also pass.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261007-3-stage-acceptance.log`, missing script. B5 full interpretation
  acceptance remains unimplemented; no placeholder or B2-command substitution.
- PASS: final document-inclusive unstaged/staged whitespace and post-commit
  worktree cleanliness checked before delivery.

Real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**; unchanged small FP16 WebGPU
model revision `36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files /
**487960440 bytes**. Each invocation prepared one fresh inventory, then cached
workers. Third extended Japanese raw/normalized samples **1007616/335872**,
ranges **60–20060 / 20060–20992 ms**, first-call delivered input advanced
**20095.375→20992 ms** while inference was pending. Zero loss/pending,
peak pending **20932 ms**, mapping **42.713 ms**; actual host calls
**2573.400/306.200 ms**, final-packet-to-text **1985.200 ms**, RSS baseline/peak
**3819232/3819408 KiB**. English **962560/320853 samples**, returned range
**40–20040 ms**, quiet tail **13.3125 ms**, zero loss/pending, peak pending
**20013.3125 ms**, mapping **44.759667 ms**, host call **1557.500 ms**,
recorded final-packet-to-text **1557.800 ms**, RSS **3509136/3509136 KiB**.
English scoring after the count assertion was not reached inside the harness.
RSS is an owned process-tree diagnostic with shared-page/allocator/browser/GPU
inclusion, not isolated GPU allocation, leaks, memory pressure or phone evidence.
Exact original short/fault/recovery numbers, timing limits and failed/unverified
scope are preserved in the report. No user transcripts/weights/profile/logs committed.

Next unfinished item: **B2 live Japanese quality/segmentation improvement and
re-evaluation**, followed by a fresh final-harness run, broader natural speech/
noise, sustained queue/recovery/memory, licensing and default qualification.
Acquired PCM/loaded models/zero loss are not transcription accuracy. B3–B6,
full offline/Korean-caption/ten-minute acceptance, Safari/iPhone remain unfinished.
No absent required environment/device/permission was observed; no terminal marker
or checkbox change applies. No AGENTS.md/requested runner file exists. All required
documents/instructions read; work stays in this worktree. Companion/settings and
unrelated files/apps/recordings/mounts preserved. No agents, runner edits, stage
advance, push/publish/install or browser-access/profile bypass; no whole-framework
or iPhone completion claim.

### 2026-10-07 / chrome / iteration 4/5 — B2 speech-band pause boundaries

Related commit: `fix: split long browser ASR at speech-band pauses`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default is selected.** Only B2 is changed.

Changes: retained the prior Japanese live CER failures, original fixtures/candidates
and quality gates. The first diagnostic mistakenly scaled captured PCM by speaker
volume; the live isolation check shows the input retains its 0.06 carrier before
that gain. An unscaled decoded-audio/production-normalizer diagnostic observed
Japanese minimum full-band/detector RMS **0.030946507 / 0.004713234**, with
**220 / 200 / 240 ms** quiet intervals, using two 2 kHz stages. This is acoustic
diagnostic evidence, not natural VAD or ASR accuracy. Long segments now permit a cut after
ten seconds at 200 ms of detector energy below 0.01, with unchanged ASR PCM,
20 s maximum, 30 s retained-input budget, 500 ms full-band endpoint and explicit
fault handling. Continuation preserves every quiet frame at an early cut. No
text deduplication, padding, fallback, model/settings/companion/playback change.

A regression failed before the fix (1 job vs 2, exit 1), then failed again when
strengthened to the unscaled 0.06 carrier against the interim 3 kHz detector.
The final 2 kHz detector passes with exact
0–11200 / 11200–15000 ms jobs and byte-identical reconstructed signal input.
The fake executor demonstrates segmentation/accounting, not real recognition.
The long live harness requires two pause-delimited results for both languages;
span/20000 no longer determines count. The five-copy decoded test now checks
counts within ceil(duration/20000)–ceil(duration/10000), every non-final range
10–20 s (tightened from <=30 s), contiguous coverage and exact EOF. All original one-period counts,
identity/range/sample/overlap/zero-loss/isolation/mapping/playback/Stop/recovery,
<=20% CER/WER, repeated meaning and <2000 ms latency gates are preserved.

Commands and actual evidence (ignored `.ralph/media-framework/` logs):

- PASS: final `npm run verify`, **exit 0**, `chrome-20261007-4-verify-final.log`:
  Biome **106 files / 47 ms / no findings**, Ruff/typecheck/unchanged companion
  build, **100 JS passed / 0 failed/skipped/cancelled / 21331.810166 ms**,
  **222 Python passed / 66.90 s**. Final 2 kHz source/test verification after
  the browser command; subsequent changes only finish Markdown evidence.
- PASS: corrected local energy diagnostics, **exit 0**. The initial temporary
  server failed imported asset delivery (exit 1); one edit command's unavailable
  `python` failed (exit 1), then `python3` corrected the server. The later unscaled
  diagnostic supplied the final cutoff evidence. No required browser/device/
  permission was absent; diagnostic decoding is not live capture or ASR.
- FAIL → PASS: isolated original regression **0 passed/1 failed/99.425417 ms**;
  strengthened 0.06-carrier regression against 3 kHz **0 passed/1 failed /
  118.460209 ms**. Both returned **exit 1**. Final typecheck + fourteen port/
  normalizer tests pass (**102.450333 ms**, synthetic/fake executor scope),
  `chrome-20261007-4-unscaled-port.log`. Actual zero PCM after the cut is retained.
- PASS: interim and final `caffeinate -disu npm run test:framework:chrome:stream`,
  **exit 0** each, `chrome-20261007-4-pause-stream-{first,final}.log`. Fourteen
  port tests **95.937125 / 101.382375 ms**, build and every real browser gate
  pass. Interim Japanese still cut at 20 s despite **8.33333% CER**; it does not
  demonstrate an earlier boundary fixing repetition. Final 2 kHz actually cuts
  earlier and supplies the measurements below. Only these two browser attempts.
- PASS: interim `npm run verify`, **exit 0**, `chrome-20261007-4-verify.log`:
  Biome **106 files / 35 ms / no findings**, Ruff/typecheck/unchanged companion
  build, **100 JS passed / 0 failed/skipped/cancelled / 22054.464666 ms**,
  **222 Python passed / 66.94 s**. This covered interim 3 kHz and overlapped the
  first browser run's early trials; final 2 kHz verification is recorded above.
- FAIL then fixed: initial targeted Biome **exit 1**, returning `forEach`
  callback in the new test; a block callback fixes it. Subsequent three-file
  checks pass **exit 0 / 9 and 18 ms / no findings**.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261007-4-stage-acceptance.log`: missing script. Unchanged package
  scripts still lack B5 full selected-video → ASR → Korean translation → DOM
  acceptance. No placeholder, weakened quality gate or B2-only substitute.
- PASS: final document-inclusive unstaged/staged whitespace checks, exit 0;
  intended files committed and clean worktree checked before delivery. No
  credentials/weights/transcripts or temporary `.ralph` files staged.

Final real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**; unchanged
Transformers.js/ORT, small FP16 WebGPU model revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files/**487960440 bytes**.
Two fresh inventories, one per browser invocation, then cached worker preparations;
no new model/dependency/fixture or default. Final browser run was independent of
the final verify workload.

Three-period live Japanese raw/normalized samples **1007616/335872**, ranges
**60–11860 / 11860–20992 ms**, **3/120 = 2.5% CER**, all anchors **3**, last
packet-to-text **978.600 ms**, pending peak **12995.375 ms**, mapping **45.899 ms**.
English **962560/320853 samples**, ranges **40–11200 / 11200–20053.3125 ms**,
**3/66 = 4.54545% WER**, all anchors **3**, last-packet-to-text **800.900 ms**,
pending peak **12162 ms**, mapping **43.831 ms**. Both **0 loss / 0 pending**;
Japanese delivered input advances **11860.6875→13055.375 ms** during actual
inference. RSS baseline/peak KiB **3649696/3655680 / 3099728/3099728**.

Five-copy decoded Japanese **557780 samples/34861.25 ms**, three contiguous
ranges split at **11780/23040 ms**, **5/200 = 2.5% CER**; English
**533320/33332.5 ms**, split at **11140/21360 ms**, **5/110 = 4.54545% WER**.
All anchors **5**, **0 loss / 0 pending**, peaks **12900/12100 ms**, host runs
**36022.000/34298.900 ms**, RSS **1555872/3846912 / 1903376/3685952 KiB**.
These are synthetic decoded inputs, separate from the live selected-video path.

All original short decoded/live checks, actual GPU loss/cached explicit recovery,
Stop/restart, fault gates, zero PCM and pinned network checks pass. Original live
last-packet-to-text **866.500/843.300/751.100 ms**, same **2.5% CER/4.54545% WER**;
Stop **900.6875 ms discarded/0 pending/no text**. Full sample counts, faults,
host-call/recovery timings and RSS caveats are in the Chrome report. No speaker
measurement, isolated GPU allocation/leak/pressure or percentile claim is made.

Next unfinished item: **B2**, broader speech/noise/boundary evidence, sustained
queue/GPU recovery/memory, conversion/distribution licensing and default selection.
Prior failed candidates remain. Natural VAD, ten-minute/offline full interpretation,
Korean translation/revisions/caption DOM, external installation and Safari/iPhone
remain **unverified**. No checkbox changed, no stage/whole-framework/iPhone claim
and no absent required environment/device/permission blocker or terminal marker.
No AGENTS.md/requested runner failure file exists. Instructions/plan/architecture/
report read; only this worktree changed. Companion/settings/unrelated files/user
apps/recordings/mounts preserved. No agents, runner edit, stage advance, push/
publish/install or browser access/profile/permission bypass. Logs/state/weights/
credentials/user audio/transcripts excluded from commit; only owned test resources
are cleaned up.
