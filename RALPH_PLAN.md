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
완료된 단계의 재검증이 실패하면 즉시 종료하는 대신 실패 로그를 Codex에 넘겨
해당 단계만 수정·검증·커밋하도록 한다. 독립 재검증이 통과해야 다음 단계로
진행한다. 복구 작업도 단계 iteration 한도에 포함되며, 최초 재검증 실패 이후
수정 후 검증이 연속 두 번 실패하면 종료한다. 실패·복구 로그는 함께 보존한다.
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
차단이 확인되면 위 marker로 종료한다. runner는 선택 단계의 완료 검증 실패를
다음 iteration의 수정 작업으로 전달하고, 수정 후 완료 검증 연속 두 번 실패,
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
실제 오디오 입력/재생 검증은 test-owned headed Chromium에서 수행한다.
화면 없는 실행에서 발생한 native 출력/파형 실패를 합격으로 바꾸지 않으며,
제품이 사용하는 실제 브라우저 경로의 PCM·출력·시간·재시작 조건을 검증한다.

## Stage chrome

목표: companion/Ollama 서버 없이 실제 영상 음성 인식·번역·자막이 동작하는 Chrome 빌드.

### 현재 작업 순서와 B2 종료 조건 (2026-10-08 사용자 확정)

B2의 엔진 비교·연결과 최종 품질·성능 개선을 분리한다. 현재 순서는
**B3 번역 → B4 화면 연결 → B5 통합·장시간 검증 → B6 품질·성능 개선**이다.
아래 규칙이 Progress log와 Chrome 보고서의 과거 “B2 유지/default 미선택”
지시보다 우선한다. 최종 수치가 미달한다는 이유로 B2를 다시 열거나 B3–B5에서
모델·VAD·디코더 비교를 반복하지 않는다. 각 항목의 연결·취소·revision 등 기능
오류는 해당 항목에서 수정한다.

B2 종료에는 실제 일본어/영어 인식 결과, WebGPU/WASM 후보 비교, 메모리·지연·
오류율 증거, 큐/과부하/GPU loss/cancel 계약 검증과 기본 모델 선택이 필요하다.
모델 로드만으로 완료하지 않는다. 기존 실측·회귀 검증이 이 범위를 충족하므로
B2를 완료 처리하고 다음 항목을 B3로 정한다. 모든 품질 fixture의 최종 합격이나
B5의 아직 없는 전체 Chrome acceptance 명령은 B2 종료 조건이 아니다.

구현용 기본 선택은 **`smallFp16` / WebGPU**다. 모델은
`onnx-community/whisper-small`, revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, 모델 파일 **487,960,440 bytes**다.
최근 동일 입력 비교에서 일본어 CER **4.306% / 2.917%**, 영어 WER **4.545%**,
작업당 replay 추론 **0.459–1.391초**로 Turbo보다 작고 빠르다. B4가 이 선택을
실제 Chrome 앱의 engine composition에 연결한다. 기존 B1 tiny 준비 화면은
기본 모델을 사용하는 완성 앱이 아니며, WebGPU 미지원 시 자동 WASM/model 전환을
추가하지 않는다. B6 실측 결과에 따라 기본 모델을 다시 선택할 수 있다.

남아 있는 일본어 예약 누락·부정/문장 중복, louder-noise 의미 실패와 실시간
지연 목표는 **B6의 미해결 문제**다. 저장된 PCM replay 속도는 실제 endpoint
지연의 합격 증거가 아니다. 과거 실패와 기존 엄격한 harness/assertion은 보존한다.
B5에는 정상 입력의 보존·큐 한도/배출, Stop/GPU/cancel 시 명시적 폐기와 이전
revision 차단 등 기능 조건이 계속 적용된다. B5 종료는 이 기능 조건의 통과와
실제 10분 측정 기록으로 판단한다. 품질·지연
assertion만 실패한 경우 그 실패를 B6 미해결 목록에 남기고 B6로 진행한다.
복합 검증 명령의 비성공 exit를 성공으로 표시하지 않는다. B6의 최종 품질 합격
대상은 앱이 사용하는 기본 모델/profile이며, 비교용 후보의 실패를 삭제하거나
모든 후보를 합격시키려고 반복하지 않는다. B5가 수치를 수집했다고 B6를
완료 처리하지 않으며, B6와 전체 acceptance까지 통과해야 Chrome stage 완료
marker를 낼 수 있다.

- [x] B1. browser engine의 execution host/worker와 model repository를 구현한다. 모델 준비의 ID·버전·다운로드·캐시·실제 로드 상태를 표시하고 document/user activation 제약을 처리한다.
- [x] B2. 일본어/영어 browser ASR 후보의 실제 WebGPU/WASM 실행과 메모리·지연·정확도를 비교하고 구현용 기본 모델을 선택한다. bounded queue·과부하·GPU loss·cancel 계약을 검증한다. 최종 품질·성능 합격은 B6에서 검증한다.
- [x] B3. Chrome Translator document adapter를 구현하고 실제 일본어/영어 → 한국어 지원을 검사한다. 최신 원문 revision과 번역을 정확히 짝짓고 원문을 먼저 표시하며 final 작업이 partial에 밀리지 않게 한다.
- [ ] B4. 새 Chrome 단독 빌드에 선택 영상 입력·엔진·공통 정책·원문/시간/번역 화면을 연결한다. 기존 companion 빌드의 native messaging/설치 경로는 보존하며 새 빌드에는 필요한 권한만 포함한다.
- [ ] B5. `test:framework:chrome`이 companion/Ollama가 없는 환경에서 실제 영상 PCM → ASR → 번역 → DOM을 검증하게 한다. 캐시된 모델 offline run, 첫 다운로드 오류, Stop/재시작, 10분 재생의 backlog/지연/손실을 측정한다. B5는 연결·수명주기·입력 보존을 검증하고 품질·성능 수치를 기록하며, 수치 목표를 맞추기 위한 최적화는 B6에서 수행한다.
- [ ] B6. Chrome 기능 연결과 B5 통합 검증 뒤 마지막으로 ASR·번역 품질과 성능을 개선한다. 일본어 부정·취소·시간·미래 의도, 긴 문장 경계·반복·누락, 영어 fixture와 잡음·작은 음성·연속 발화를 평가한다. 기존 CER/WER ≤20%, 핵심 표현의 기대 횟수 일치, 실시간 endpoint-to-text <2초 기준과 장시간 backlog·손실 검증을 통과하고 수치·메모리·수용 기준을 문서화한다. 실패 문장·기록을 삭제하거나 테스트·기준을 약화시키지 않는다. 기준을 못 맞추면 개선 또는 차단으로 보고한다.

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

### 2026-10-07 / chrome / iteration 5/5 — B2 sustained decoded-input qualification

Related commit: `test: measure sustained browser ASR processing`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default is selected.** Only B2 advances.

Changes: preserved the original five-period continuous regressions and all
short/live/fault/recovery/candidate/fixture/quality gates. Added at least ten
minutes per language of actual FP16 WebGPU ASR over real-time paced decoded
synthetic fixture PCM: 87 complete Japanese periods / 91 English. Every original
sample/isolation tag/sentence remains, without silence padding, gain change or
expected text in inference input. Require aggregate <=20% CER/WER, aggregate
meaning-anchor counts >= repeats, complete contiguous bounded ranges/exact EOF,
actual invocation/sample correspondence, <=30 s pending audio, zero loss and
final drain. Sustained segments also require the existing <2000 ms endpoint-to-
text limit and measured input runtime. Added minute queue/RSS measurements.
Production/model/default/settings/dependencies/fixtures/package scripts and
later-stage implementation are unchanged. This is decoded synthetic ASR,
**not ten-minute live selected-video → Korean captions or leak qualification**.

Commands and actual results (ignored `.ralph/media-framework/` logs):

- **FAIL:** `caffeinate -disu npm run test:framework:chrome:stream`, **exit 1**,
  one invocation, `chrome-20261007-5-sustained-stream.log`. Typecheck, **14
  port/normalizer tests / 0 failed/skipped/cancelled / 94.436583 ms**, build,
  all original short/live/fault/recovery and five-period regressions pass. Both
  sustained trials complete; sole final failure is **English missing repeated
  meaning anchors (83 < 91)**. No retry of this unchanged quality failure.
- **PASS:** final `npm run verify`, **exit 0**, `chrome-20261007-5-verify.log`:
  Biome **106 files / 46 ms / no findings**, Ruff/typecheck/unchanged companion
  build, **100 JS passed / 0 failed/skipped/cancelled / 21502.833291 ms**,
  **222 Python passed / 66.96 s**. Verification follows the browser run, with
  no concurrent repository-test workload during inference.
- **FAIL:** required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261007-5-stage-acceptance.log`: missing script. B5 full selected-
  video → ASR → Korean translation → DOM acceptance is still unimplemented.
  No placeholder or ASR-only stage-command substitute is added.
- **PASS:** local Python recorded-result equality check: English returned
  exactly **83 complete normalized fixture periods**, each `three` → `3`.
  **8 × 22 missing words + 83 numeric substitutions = 259 edits**. This is
  actual-result analysis, not another model run or a causal acoustic diagnosis.
- **PASS:** `node --check tests/framework-chrome-stream.mjs`, targeted Biome
  **1 file / 9 ms / no findings**, exit 0. Final document-inclusive unstaged/
  staged whitespace, intended commit and clean-worktree checks before delivery.

Real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83
arm64**, Node **v24.15.0**/npm **11.12.1**/uv **0.12.23**, locked test Python
**3.12.15**; unchanged Transformers.js/ORT and pinned small FP16 WebGPU model
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files/**487960440 bytes**.
One fresh inventory, cached later workers. Japanese sustained input **9705372
samples / 606585.750 ms**, host **607531.700 ms**, 53 segments, **93/3480 =
2.672414% CER**, every meaning-anchor count exactly **87**, endpoint-to-text
**944.300–1226.100 ms**, pending peak **13840 ms**: all sustained gates pass.
English **9706424 samples / 606651.500 ms**, host **607591.600 ms**, 46 segments,
**259/2002 = 12.937063% WER**, endpoint-to-text **659.000–1092.600 ms**, pending
peak **14420 ms**: numerical/range/queue/latency gates pass, **meaning fails**.
Every required English anchor occurs **83**, below **91**. Actual PCM jobs still
cover every sample/range through EOF. Zero reported ASR audio loss and final
pending **0** in both languages do not imply successful recognition of every
spoken period; the missing English speech's segmentation/model cause remains
unverified. No gate or failed sentence is removed.

Owned browser-tree RSS baseline/peak/final KiB: Japanese
**1669936/3759536/1491888**, English **1679552/3599072/1471600**. All ten minute
windows report zero loss and bounded queues; final partial minute drains. Exact
minute queue/RSS tables, job/capture/sample/fault numbers and timings are in the
Chrome report. RSS is sampled at 250 ms, with one snapshot per minute, and includes
shared-page double counting, allocator/browser/GPU-process residency and harness
PCM copies. This is not isolated model/GPU allocation, leak freedom, pressure
qualification or phone evidence. Latency uses the document clock after endpoint
packet delivery, excludes speech accumulation/translation/display, and is an
observed range, not population percentiles. RSS uses a separate Node clock with
no cross-clock subtraction. No audio/transcripts/weights/profile/logs are committed.

All original short decoded/live checks pass at **2.5% CER / 4.54545% WER**,
including three-period live meaning counts 3 and capture/inference overlap.
Original five-period decoded tests retain all anchors 5 times and zero loss.
Live maximum mapping error **51.270 ms**; Stop emits cancelled/no text,
**920.6875 ms discarded / 0 pending**. Actual active GPU loss and explicit
same-host cached recovery still pass (zero remote recovery requests). Page errors
and native visibility events are `[]`; final accuracy failure list has only the
sustained English meaning failure. Original candidate failures are preserved.

Next unfinished item remains **B2**, first the sustained English missing-speech
quality failure, then broader natural speech/noise/boundary quality, sustained
live acquisition/recovery/pressure, storage/GPU memory limits,
conversion/distribution licensing and evidence-based default selection. Failed
baselines remain; no unchanged failure is retried without new evidence. B3–B6,
full offline/Korean translation/revisions/DOM, ten-minute live end-to-end,
external installation and Safari/iPhone remain unverified. No checkbox or
stage/whole-framework/iPhone completion claim. No required environment/device/
permission was absent; this is quality failure/incomplete implementation, so no
blocked or stage-complete marker applies.

No root/nested AGENTS.md/requested runner failure file exists; instructions,
plan, architecture and prior report read. Work stays in this worktree. Published
companion/install/native messaging/server/settings and unrelated files/apps/
recordings/mounts preserved. No agents, runner edits, stage advance, push/publish/
app installation or browser access/profile/permission bypass. Logs/state/weights/
credentials/user audio/transcripts excluded from the commit; only owned test
browser/profile resources are cleaned up.


### 2026-10-08 / video / completed-stage recheck repair

The next `all` invocation stopped before Chrome in V3's source-replacement output
check: RMS 0.03538971938093776 versus baseline 0.04246887152389713 exceeded the
12% bound while replacement playback was only 0.191086 seconds old. Require
actual replacement playback >=0.5 seconds before the existing output observation;
all tolerances and production behavior remain unchanged. Exact original
transport/decoder cause is unverified. Regression: the runner's
`2026-10-08T00-52-38-744Z-video-verification.txt`; final
`caffeinate -disu npm run test:framework:video` PASS, 13 unit tests and V1–V5,
including both graphs' replacement output. A pre-fix broader diagnostic's V5
correlation failure is documented in the video report; no V5 change was made.
No checklist changed; Chrome B2 and later work remain incomplete.
Full `caffeinate -disu npm run verify` PASS: lint/typecheck/build, 100 JS and
222 Python tests (66.91 s); evidence `video-transition-verify.log`. Targeted
Biome and whitespace checks PASS. Commit this repair so the runner can restart
with a clean worktree.

### 2026-10-08 / chrome / iteration 1/20 — B2 repeated-speech decoding

Related commit: `fix: preserve repeated speech in browser ASR`, containing this
entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default is selected.** Only B2 advances.

Changes: independently replayed all eight omitted English speech-period ranges
from the preceding sustained run, plus a passing neighbor. The unchanged FP16
worker reproduces eight omissions with contiguous real decoded PCM. Enabled
Whisper timestamp decoding only for the experimental FP16 profile, retaining
q8 baselines, pinned models/caches, 256-token bound, original PCM/segmentation/
queue budgets and every existing acceptance gate. Added nine exact-range real
ASR regressions: <=20% WER, each meaning exactly twice, identity/revision/range/
sample accounting and <2000 ms host calls. No text oracle or replacement audio
supplies inference. The host still returns job-range text, not model timestamps.

Commands/results (ignored `.ralph/media-framework/` evidence):

- FAIL: pre-change `caffeinate -disu node .ralph/media-framework/chrome-20261008-1-replay.mjs`,
  `chrome-20261008-1-replay-before.log`: all eight omissions reproduced; uncaught
  assertion actual 1/expected 2. Shell exit status was not captured (**unverified**).
- PASS: same diagnostic after the decoding change, **exit 0**,
  `chrome-20261008-1-replay-timestamps.log`, all meanings twice in all nine jobs,
  **1098.800–1615.600 ms** host calls.
- FAIL: first `caffeinate -disu npm run test:framework:chrome:stream`, **exit 1**,
  `chrome-20261008-1-stream.log`: typecheck/14 port tests, short ASR/replays/
  recovery and preceding live rounds pass; final English live playback-state
  equality fails for volume **0.25 → 0.8845703125**. Later scoring/continuous
  runs not reached. A 30-cycle owned-button diagnostic passes (**exit 0**,
  `chrome-20261008-1-controls.log`) without reproducing the mutation; no inference
  claim follows. Live buttons now use trusted keyboard activation beside the
  native controls. All activation/playback-state assertions remain. Exact cause
  of the first volume change is still **unverified**.
- PASS: final streaming command, **exit 0**, `chrome-20261008-1-stream-final.log`:
  typecheck, **14 port/normalizer tests / 101.968292 ms**, build and all original/
  new real browser checks, including both ten-minute decoded-input trials.
- PASS: final `npm run verify`, **exit 0**, `chrome-20261008-1-verify.log`:
  Biome **106 files / 47 ms**, Ruff/typecheck/unchanged companion build,
  **100 JS passed / 0 failed/skipped/cancelled / 21024.682459 ms**,
  **222 Python passed / 67.01 s**. Runs after inference, without test-load overlap.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-1-stage-acceptance.log`: missing script. B5's full selected-
  video → ASR → Korean translation → DOM acceptance is still unimplemented.
  No placeholder or ASR-only stage substitute.
- PASS: final nine replays, each **2/44 = 4.545455% WER**, all meanings twice,
  **1100.200–1201.500 ms** host calls; local Python exact normalized-English
  comparison verifies all 91 original periods with numeric spelling edits.
  A first summary extractor's **exit 1 / KeyError** is corrected; final extraction
  **exit 0**, with details in the report. This is analysis, not another model run.
- PASS: standalone typecheck, targeted Biome (**2 files / 21 ms**), script syntax
  and whitespace. Document-inclusive/staged whitespace, intended commit and
  clean worktree are checked before delivery. No temporary `.ralph` state staged.

Real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked Python **3.12.15**;
unchanged Transformers.js **4.3.0**/ORT, small FP16 WebGPU model revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files/**487960440 bytes**.
Four model-bearing invocations prepare one fresh inventory each, then reuse
owned cache; the control diagnostic loads no model. No new dependency/default.

Sustained decoded Japanese: **87 periods / 9705372 samples / 606585.750 ms**,
host **607630.000 ms**, **53 segments**, **96/3480 = 2.758621% CER**, every
meaning **87**. Its 96 edits versus previous 93 are retained. English: **91 /
9706424 / 606651.500 ms**, host **607720.800 ms**, **46 segments**,
**91/2002 = 4.545455% WER**, every meaning **91**, improved from previous **83**
and **259/2002 WER**. Both retain exact contiguous samples/ranges through EOF,
**0 loss / 0 final pending**, endpoint-to-text **1018.600–1338.100 /
973.700–1260.000 ms**, peak pending **13940 / 14600 ms**. All minute windows
report zero loss; final partial minutes drain. Exact queue/RSS tables are in the
report. RSS baseline/peak/final KiB **1762192/3659248/1529456 /
1610672/3214608/1460016**, not isolated GPU allocations, leak/pressure/mobile
qualification. Latency uses one document clock and excludes speech accumulation,
translation/display; it is an observed range, not percentiles. These are real
ASR over paced decoded synthetic PCM, **not ten-minute live Korean captions**.

All original short decoded/live tests retain **2.5% CER / 4.545455% WER**, live
three-period meanings exactly 3, complete sample accounting and capture/inference
overlap. Five-period decoded meanings exactly 5, zero loss/drained. Live maximum
mapping error **65.915 ms**, Stop cancelled/no text/**835.375 ms discarded**;
source isolation, repeat Start and both videos' original playback states pass.
Actual GPU loss/cached explicit recovery, overload/gap/cancel, zero PCM and pinned
network checks pass. Final page errors/visibility events/accuracy failures `[]`.

Next unfinished item remains **B2**: broader natural speech/noise/boundary
recognition, sustained live acquisition/recovery under pressure, storage/GPU
memory limits, conversion/distribution licensing and evidence-based default
selection. Original q8 failures remain; no unchanged comparison retry. Learned
VAD, model timestamp accuracy, full offline/Korean translation/revisions/DOM,
ten-minute live end-to-end, B3–B6, external installation and Safari/iPhone remain
**unverified**. No checkbox or stage/whole-framework/iPhone completion claim.
No required environment/device/permission was absent; neither terminal marker
applies. Requested AGENTS.md/independent runner file absent at initial read;
instructions/plan/architecture/prior report read. Only this worktree changes.
Companion/install/native messaging/server/settings and unrelated files/apps/
recordings/mounts preserved. No agents, runner edits, stage advance, push/publish/
app installation or browser access/profile/permission bypass. Credentials,
weights, user audio/transcripts and `.ralph` logs/state excluded from the commit;
only owned test browser/profile resources are cleaned up.


### 2026-10-08 / chrome / iteration 2/20 — B2 deterministic noise evaluation

Related commit: `test: expose browser ASR noise quality failures`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 stays unchecked; no default is selected.** Only B2 advances.

Changes: added `npm run test:framework:chrome:noise`, a real production speech
port/host/worker evaluation with ten paced synthetic cases. Six-second white
noise at nominal RMS 0.006/0.02 and 120 Hz hum/RMS 0.04 must produce no text;
below-gate noise must make no ASR call. Three complete unchanged decoded fixture
periods plus 600 ms leading/800 ms inter-period gaps and additive seeded white
noise at both levels must meet the original <=20% CER/WER, preserve each meaning
exactly three times, return authoritative identity/final/source revision and
bounded latency/queues. Actual mixed PCM/job hashes, sample equality and louder-
noise contiguous EOF coverage distinguish missing recognized speech from loss.
No existing test/candidate/fixture/gate, production behavior, model/default,
dependency lock, companion, setting or later-stage implementation changes.

Commands/results (ignored `.ralph/media-framework/` evidence):

- FAIL: first `caffeinate -disu npm run test:framework:chrome:noise`, **exit 1**,
  `chrome-20261008-2-noise.log`: typecheck/build and real pinned model preparation
  **64741.750333 ms** pass; test evaluation cannot access module-scoped recognizer
  import. No noise trial reaches inference. Exposed the import in the owned test
  document. An informational template-style lint finding (exit 0) is also fixed.
- FAIL: corrected same command, **exit 1**, once,
  `chrome-20261008-2-noise-final.log`: **10 completed cases / 14 actual ASR calls**,
  **seven failing cases / nine quality assertions**. No unchanged retry.
  Quiet noise both languages: zero ASR/text, PASS. White noise/hum in both
  languages: invented text, FAIL. Japanese speech + quiet noise: **3/120 = 2.5%
  CER**, every meaning 3, PASS. Japanese louder noise: **49/120 = 40.833333%
  CER**, meaning counts only 1/2, FAIL. English quiet speech: **4/66 = 6.060606%
  WER** passes numerically, but third `meet` becomes `need`, so meeting meaning
  count 2 fails. English louder noise: **24/66 = 36.363636% WER**, every meaning
  only 2, FAIL. No error or sentence is normalized away.
- PASS: all ten cases complete at real-time cadence with **0 discarded / 0
  final pending**; actual jobs exactly equal mixed input slices, identity/revision/
  sample/range checks, <2000 ms endpoints and <=30 s queues pass. These do not
  turn failed recognition into successful transcription. Louder-noise complete
  Japanese/English inputs **383040 / 368640 samples**, ranges **0–15560–23940 /
  0–15060–23040 ms**. All source speech remains; fewer recognized periods are
  not reported input loss. All fourteen host calls **381.700–982.000 ms**,
  endpoint-to-text **383.300–987.300 ms**, peak pending at most **16500 ms**.
- PASS: final `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-2-verify.log`: Biome **107 files / 48 ms / no findings**,
  Ruff/typecheck/unchanged companion build, **100 JS passed / 0 failed/skipped/
  cancelled / 21766.127792 ms**, **222 Python passed / 66.90 s**. It starts after
  inference; subsequent edits only finish Markdown records.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-2-stage-acceptance.log`: missing script. B5's full selected-
  video → ASR → Korean translation → DOM harness remains unimplemented; no
  placeholder or B2 substitute is added.
- PASS: syntax, targeted Biome **1 file / 26 ms / no findings**, preliminary
  whitespace, exit 0. Local Python recorded-outcome/accounting analysis **exit 0**;
  louder-noise English equals exactly two original periods with `three` → `3`,
  explaining **22 missing words + 2 numeric edits = 24**. This is result analysis,
  not another inference or a passing accuracy result. Document-inclusive/staged
  whitespace, intended commit and clean worktree are checked before delivery.

Real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**; unchanged Transformers.js
**4.3.0**/locked ORT, small FP16 WebGPU model revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files/**487960440 bytes**.
Two browser invocations download one fresh inventory each; the first performs
no inference, the second reuses cache for nine subsequent workers. Completed-run
preparation **56440.175833 ms**, cached preparation **1217.414917–1221.528584 ms**
is loading, not ASR latency. Pinned remote paths, page errors/native visibility
`[]` pass. Per-case measurements and RSS tables are in the report; overall RSS
baseline **1296128 KiB**, per-case peaks **3498944–3819920 KiB**, not isolated
GPU/model memory, leak freedom, hardware/storage pressure or mobile limits.
White noise/hum are synthesized; noisy speech is decoded fixture PCM, not live
acquisition, natural-speaker robustness, learned VAD or Korean captions.

Next unfinished item remains **B2**: improve no-speech noise rejection and noisy
speech meaning/repetition while retaining these cases and gates, then broader
natural speech/boundary/noise, sustained live acquisition/recovery under pressure,
storage/GPU memory qualification, conversion/distribution licensing and a default
chosen from passing evidence. Earlier preparation/comparison/streaming commands
were not rerun against unchanged source; prior successes and failed candidates
remain historical evidence. The new noise command must pass to qualify its scope.
Model timestamp accuracy, full offline interpretation, ten-minute live Korean
captions, B3–B6, external installation, Safari/iPhone remain **unverified**.
No required environment/device/permission is absent; this is quality failure and
incomplete implementation, so neither terminal marker applies. No checkbox or
stage/whole-framework/iPhone completion claim.

Root/nested AGENTS.md and the requested independent runner file are absent at
initial read; supplied instructions, plan, architecture and prior report read.
All changes stay in this worktree. Companion/install/native messaging/server/
settings and unrelated files/apps/recordings/mounts are preserved. No agents,
runner edit, stage advance, push/publish/app installation or browser access/
profile/permission bypass. Only owned test browser/profile resources are cleaned
up. Credentials, weights, user audio/transcripts and temporary `.ralph` logs/state
are excluded from the commit.

### 2026-10-08 / chrome / iteration 3/20 — B2 learned detector evaluation

Related commit: `test: evaluate learned browser speech detection`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Changes: added `npm run test:framework:chrome:vad` and an isolated learned VAD
evaluation worker, before changing production segmentation. Pinned full-precision
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`, one ONNX
file/**2243022 bytes**, SHA-256
`a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808`.
The pinned card/LICENSE identify MIT/Silero Team; no upstream major version or
Whisper conversion/distribution license is inferred. Existing locked ORT Web
**1.31.0-dev.20260914-8d85527a0**, one-thread WASM only, local **14264838-byte**
runtime; no dependency/lock, production port/model/worker/segmentation/normalizer,
default, setting, companion or later-stage change. Every original ASR case,
sentence/tag/hash/gate and failed baseline remains.

The evaluator replays the exact ten iteration 2 mixed noise inputs, verified
against committed golden hashes both before transfer and inside the actual
worker. 512 new samples/64 context at 16 kHz, state reset per input, real-time
32 ms cadence, contiguous EOF sample coverage and explicit detector-only final
padding. Fixed pre-run gates: noise-only zero frames >=0.5, each complete speech
period >=250 ms detected activity, total actual inference <10% of input duration.
These are detector presence/performance probes, not transcript accuracy/meaning
or frame-level recall labels. No ASR, expected text, translation or caption DOM
is run. Production still uses its energy detector; previous ASR noise quality
failures remain unresolved.

Commands/results (ignored `.ralph/media-framework/` evidence):

- FAIL then fixed: preliminary typecheck **exit 1 / TS2322**, inferred float32
  Tensor incompatible with general runtime Tensor output. Annotated state using
  the actual exported Tensor type; both browser commands typecheck successfully.
  No inference reached the compile failure. Initial lint/syntax/whitespace pass.
- PASS: first `caffeinate -disu npm run test:framework:chrome:vad`, **exit 0**,
  `chrome-20261008-3-vad.log`: all ten cases and fresh-worker offline zero
  control pass; preparation **1759.900 / offline 99.800 ms**. Added stricter
  all-HTTPS-request accounting and explicit identical-control recurrent reset
  checks after this invocation started; the separate final run covers them.
- PASS: final same command, **exit 0**, `chrome-20261008-3-vad-final.log`:
  **10 completed paced cases / 4066 actual detector frames**, plus **32 actual
  offline zero-control frames**; hashes/ownership/samples/cadence/padding,
  fixed activity/performance, recurrent reset, pinned remote paths/page errors/
  native visibility and offline checks pass. Preparation **1751.700 ms**,
  offline cached fresh worker **99.900 ms**, **0 HTTPS requests**. No third run.
- PASS: final `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-3-verify.log`: Biome **109 files / 34 ms / no findings**,
  Ruff/typecheck/unchanged companion build, **100 JS passed / 0 failed/skipped/
  cancelled / 21725.9045 ms**, **222 Python passed / 66.86 s**. Starts after
  inference; subsequent changes finish only Markdown records.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-3-stage-acceptance.log`: missing script. B5 full selected-
  video → ASR → Korean translation → DOM remains unimplemented; no substitute
  or placeholder is added.
- PASS: final two-file Biome **4 ms / no findings**, syntax and preliminary
  whitespace, **exit 0**. Summary extraction first failed **exit 1 / SyntaxError**
  from malformed shell heredoc; corrected extraction **exit 0**. Separate result
  comparison **exit 0** confirms all ten exact prediction arrays/hashes/activity
  measurements equal across independent invocations. Analysis is not inference.
  Document-inclusive/staged whitespace and committed cleanliness are checked
  before delivery; no temporary `.ralph` state is staged.

Real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. Each
invocation downloads only this **2243022-byte** VAD artifact once, then uses
its own cache offline. No speech ASR model is downloaded/run. All six noise
controls have **zero active frames**: quiet/white/hum maximum probabilities
**0.048502624 / 0.039015114 / 0.203411162**. Japanese low/high noisy speech
activity per period **6356.250/6328.250/6364.250 / 6484.250/6424.250/6364.250 ms**;
English **6370.500/6362.500/6322.500 / 6370.500/6426.500/6418.500 ms**. All
inference totals <10% of duration; final observed per-case total/max-frame
**124.800–524.700 / 1.400–7.300 ms**, maximum worker delivery lag **6.100 ms**.
Exact per-case timing/RSS/padding tables are in the report. RSS overall baseline
**1286560 KiB**, case peaks **1632576–1791728 KiB**, sampled every 250 ms for
owned browser/renderers/GPU processes, including shared-page/allocator effects.
This is not isolated model memory, simultaneous VAD+ASR memory, leak/pressure/
mobile qualification. Timing uses one worker clock, with no cross-clock
subtraction or ASR/caption latency claim.

**Next unfinished item remains B2:** integrate a qualified learned detector once
with production model-cache/lifetime/queue ownership and rerun the retained real
ASR noise/meaning/repetition gates. Detector-guided segmentation and actual word
preservation remain unverified. Broader natural speakers/noise/boundaries,
sustained live acquisition/recovery under pressure, storage/GPU memory limits,
Whisper conversion/distribution licensing and evidence-based default selection
remain unfinished. Existing ASR/preparation/streaming/noise commands were not
rerun against unchanged production source; their prior passes and failed quality
baselines stay historical. Full offline interpretation, Korean translation/
revisions/DOM, ten-minute live end-to-end, B3–B6, external installation and
Safari/iPhone remain **unverified**. No missing required environment/device/
permission was observed; neither terminal marker applies. No checkbox or
stage/whole-framework/iPhone completion claim.

Root/nested AGENTS.md and requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent at initial read;
instructions/plan/architecture/prior Chrome evidence read. Only this worktree
changes. Published companion v0.1.0/install/native messaging/server/settings and
unrelated files/apps/recordings/mounts are preserved. No agents, runner edit,
stage advance, push/publish/app installation or browser access/profile/permission
bypass. Only owned test browser/profile resources are closed/removed. Credentials,
model/runtime weights, user audio/transcripts and temporary ignored `.ralph`
logs/state are excluded from the commit.

### 2026-10-08 / chrome / iteration 4/20 — B2 learned speech admission

Related commit: `feat: gate browser ASR with learned speech detection`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Changes: integrated the previously evaluated full-precision Silero VAD artifact
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`, **2243022
bytes**, with the production registry/repository and a one-thread WASM worker/
document host. Downloads and cached loads verify the pinned SHA-256. Model progress
and real readiness are separate; model/runtime caches are owned and independent
of ASR. One recurrent stream/one pending frame, 512 new + 64 context samples at
16 kHz, production host-owned fixed 0.5 threshold, real EOF detector-only padding,
Stop/suspension/late-result invalidation and caller PCM retention. The recognizer
runs this explicit detector once per frame, admits only segments containing detected
speech, and keeps the existing energy endpoint/speech-band boundary policy and
20 s/30 s/job/result limits. Learned framing is 32 ms; the existing energy-only
comparison remains 20 ms, with no automatic fallback/default/setting changes.

Added `test:framework:chrome:noise:learned` and transport/segmentation regressions.
Both noise profiles retain the ten original mixed inputs and all numerical,
meaning, latency, sample coverage and zero reported queue-loss gates; both now
also assert the seven immutable mixed-input hashes. No fixture/tag/sentence,
candidate failure, dependency/lock, ASR decoding/normalization, companion or later
stage is changed. No expected text supplies recognition.

Commands/results (ignored `.ralph/media-framework/` logs, excluded from Git):

- FAIL before fix: speech regression **exit 1 / 9 passed / 1 failed /
  120.415334 ms**, `chrome-20261008-4-regression.log`; negative detector still
  admitted energetic noise to ASR. Initial typecheck **exit 1 / TS18046 + TS2322**
  (tool output) was corrected with response-count/pending-request narrowing.
- PASS: updated unit tests **10 passed / 101.030125 ms**, then **12 passed /
  109.000792 ms**, final host-interface **12 passed / 197.124792 ms**, all exit 0,
  `chrome-20261008-4-unit{,-final,-final-host}.log`; fake transport/executor only.
- FAIL: first `caffeinate -disu npm run test:framework:chrome:noise:learned`,
  **exit 1**, `chrome-20261008-4-learned-noise.log`: typecheck/12 unit tests,
  ten actual cases/4066 VAD calls/10 ASR jobs and offline/accounting checks pass,
  four louder-noise speech quality assertions fail. Moved the fixture's fixed
  probability-to-speech decision into the production host before the final run.
- FAIL: final same command, **exit 1**, `chrome-20261008-4-learned-noise-final.log`:
  **12 unit tests / 91.535250 ms**, ten completed real cases/**4066 detector calls /
  10 actual ASR jobs**, PCM/range/revision/hash/queue/latency/network and offline
  assertions pass; the same four louder-noise quality assertions fail. No third
  learned attempt. Both invocations' complete probabilities, hashes and actual
  transcript strings are exactly equal (separate analysis **exit 0**, not inference).
- FAIL: `caffeinate -disu npm run test:framework:chrome:noise`, **exit 1**,
  `chrome-20261008-4-energy-noise.log`: all ten cases/**14 ASR jobs** complete,
  **seven cases / nine quality assertions fail**, reproducing the preserved
  energy-profile noise hallucinations and meaning/error failures. Its accounting,
  hash, queue and latency gates pass; no unchanged energy-only retry.
- PASS: `caffeinate -disu npm run test:framework:chrome:preparation`, **exit 0**,
  `chrome-20261008-4-preparation.log`: **6 repository tests / 101.979958 ms**,
  typecheck/build, all **11 B1 browser checks**, including native visibility,
  real loading/Stop/offline/corruption/eviction/UI. Tiny q8 **43613734 bytes**,
  load **9345.616042 / offline 540.388833 ms**, page errors `[]`. Preparation
  is not transcription accuracy; expected injected console errors remain.
- PASS: final `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-4-verify.log`: Biome **112 files / 56 ms / no findings**,
  Ruff/typecheck/unchanged companion build, **103 JS passed / 0 failed/skipped/
  cancelled / 21695.400542 ms**, **222 Python passed / 66.90 s**. Runs after all
  browser inference/preparation; subsequent edits finish only Markdown records.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-4-stage-acceptance.log`: missing script. B5 full selected-video
  PCM → ASR → Korean translation → DOM remains unimplemented; no substitute.
- PASS: final targeted eight-file Biome **19 ms / no findings**, script syntax
  and preliminary whitespace, exit 0. Final document-inclusive/staged whitespace,
  intended commit and committed worktree cleanliness are checked before delivery.

Real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. Unchanged
small FP16 WebGPU ASR model/version/**487960440 bytes**, plus actual learned WASM
VAD; 100 ms paced **decoded synthetic PCM**, not live selected-element capture.
All six speech-free controls make **zero active VAD frames / ASR calls / text**.
Low-noise Japanese **3/120 = 2.5% CER**, English **3/66 = 4.545455% WER**, all
meanings exactly three times. Louder-noise Japanese **47/120 = 39.166667% CER**,
English **24/66 = 36.363636% WER**; meanings occur only one/two times, so both
fail error and meaning gates despite complete contiguous ASR PCM coverage.

Final joint preparation **54769.621666 ms**, cached **1220.571458–1420.684375 ms**;
loading is not ASR latency. Actual ASR calls **707.300–944.800 ms**, endpoint-to-
text **713.400–947.300 ms**, VAD case inference totals **121.800–450.100 ms**,
max frame **14.100 ms**. All cases have **0 reported discarded / 0 final pending**,
maximum pending **16500 ms**. Quiet-input ASR ranges and detector padding are
explicit in the report; queue-loss counters do not prove phoneme preservation.
Fresh VAD/ASR workers load offline with **0 HTTPS requests**, actual VAD zero
control **0.012012064 probability / 7.900 ms**, pending host-frame Stop rejects
and retains 2048 caller bytes. This is not offline speech ASR/full interpretation
or invocation-observed kernel cancellation. Final paths are pinned (16 unique),
page errors/native visibility `[]`. RSS overall baseline **1296688 KiB**,
per-case peaks **3273072–3839920 KiB**, sampled every 250 ms for owned browser/
renderers/GPU processes; includes shared pages/allocators/joint residency, not
isolated model memory, leak freedom, pressure/storage/mobile qualification.

**Next unfinished item remains B2:** improve louder-noise speech accuracy and
meaning/repetition with these retained cases/gates, qualify learned boundaries
on broader natural/live speech and sustained queue/GPU recovery/memory/storage,
resolve Whisper conversion/distribution licensing, then choose a default from
passing evidence. Full streaming/sustained ASR comparison and isolated VAD commands
are not rerun this iteration; historical evidence is preserved, not a fresh learned-
profile pass. Learned live input/phoneme boundaries/active GPU loss, VAD-specific
real cache faults/eviction, offline speech recognition/full interpretation, Korean
translation/revisions/DOM, ten-minute live captions, B3–B6, external installation
and Safari/iPhone remain **unverified**. No required environment/device/permission
is absent; measured quality failures/unfinished implementation warrant neither
terminal marker. No checkbox or stage/whole-framework/iPhone completion claim.

Root/nested AGENTS.md and requested independent runner file are absent at initial
read; instructions/plan/architecture/prior Chrome evidence read. All work stays in
this worktree. Published companion v0.1.0/install/native messaging/server/settings
and unrelated files/apps/recordings/mounts are preserved. No agents, runner edit,
stage advance, push/publish/app installation or browser access/profile/permission
bypass. Only owned explicit test browsers/profiles are closed/removed. Credentials,
model/runtime weights, user audio/transcripts and temporary `.ralph` logs/state
are excluded from the commit.

### 2026-10-08 / chrome / iteration 5/20 — B2 learned pause boundaries

Related commit: `fix: split browser ASR at learned speech pauses`, containing this
entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Changes: the explicit learned profile uses the existing recurrent detector to
identify >=500 ms pauses, splitting on the next onset within one 32 ms frame
of the pause midpoint. It retains both sides in the existing buffer and submits
exact unfiltered input slices. This delayed boundary policy preserves energetic
leading/inter-period/trailing noise, but can defer submission through long silence
until the next onset, EOF or unchanged 20 s cap; long-silence latency is unqualified.
The energy-only comparison's endpoints/filter, 30 s retained budget, one active
plus two queued jobs/two pending results, model/backend/decoding, repository,
contracts, user settings and defaults are preserved. No extra VAD pass or retry.

Three regressions cover exact contiguous noisy-input ranges/EOF, odd-frame pause
then maximum cut, and pending learned-job overload with late-result rejection.
No package script/acceptance harness/fixture/hash/tag/sentence/meaning/error-rate/
latency/coverage gate is changed. No expected text supplies inference.

Commands and results, evidence under ignored `.ralph/media-framework/`:

- FAIL before fix: standalone speech tests, **exit 1 / 11 passed / 1 failed /
  121.126125 ms**, `chrome-20261008-5-regression.log`: one 0–8640 ms job merges
  three detector-labeled utterances over energetic noise.
- PASS: typecheck and speech/VAD tests, **exit 0 / 13 passed / 115.706167 ms**,
  `chrome-20261008-5-unit.log`. FAIL during review: standalone speech tests,
  **exit 1 / 12 passed / 1 failed / 139.594750 ms**,
  `chrome-20261008-5-alignment-regression.log`: half-frame retained context from
  an odd pause overflows the later maximum segment. Frame-aligned split fixes it.
- PASS: final speech/VAD tests, **exit 0 / 15 passed / 182.174833 ms**,
  `chrome-20261008-5-unit-final.log`. Fake transport/detector/executor only,
  not real speech accuracy or GPU recovery.
- FAIL: first `caffeinate -disu npm run test:framework:chrome:noise:learned`,
  **exit 1**, `chrome-20261008-5-learned-noise.log`: typecheck/**13 tests /
  97.120542 ms**, all ten real cases/**4066 detector calls / 12 ASR jobs** and
  hash/accounting/latency/network/offline/Stop gates complete. Sole failure:
  louder-noise Japanese meaning counts. Japanese low/high **3/120 / 8/120 CER**,
  English low/high **3/66 / 4/66 WER**. Build predates frame-alignment correction
  and final overload test. Initial joint preparation **54488.666250 ms**.
- FAIL: final same command, **exit 1**,
  `chrome-20261008-5-learned-noise-final.log`: typecheck/**15 tests / 121.145125 ms**,
  all ten real cases/**4066 VAD calls / 12 ASR jobs**, every hash/PCM/range/
  revision/queue/latency/offline assertion passes. Sole failure is the same
  Japanese exact-three meaning gate. No third attempt at the same failure.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-5-stage-acceptance.log`: missing script. Full B5 selected-video
  PCM → ASR → Korean translation → DOM acceptance is unimplemented; no substitute.
- PASS: targeted two-file Biome, **exit 0 / 23 ms / no findings**, and preliminary
  whitespace. Required verify and final staged/committed checks follow below.

Real scope: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged Transformers.js/ORT.
Same pinned small FP16 WebGPU ASR **487960440 bytes** plus Silero WASM VAD
**2243022 bytes**, one inventory each per fresh browser invocation. Inputs are
100 ms paced **decoded synthetic PCM**, not live selected-element acquisition.
No remote inference, companion or Ollama. All six noise-only controls have
**zero active VAD frames / ASR calls / text**. Final Japanese low/high:
**3/120 = 2.5% / 9/120 = 7.5% CER**; English low/high:
**3/66 = 4.545455% / 4/66 = 6.060606% WER**. All rates pass 20%, but Japanese
high-noise 会議 occurs **2**, 駅 **1**, others **3**; the meaning gate fails.
The other three speech cases retain every meaning **3** times. Final high-noise
ranges cover every sample from zero through EOF, with three jobs/language.
Report contains every exact range, per-case VAD/timing/RSS measurement and limit.

Final joint preparation **54992.495667 ms**, cached **1218.996959–1422.250708 ms**;
not recognition latency. ASR host calls **690.800–986.700 ms**, endpoint-to-text
**694.200–1494.300 ms**, maximum pending **9500 ms**, all cases **0 reported
lost / 0 final pending ms**. VAD totals **113.900–431.100 ms**, max frame
**18.700 ms**, padding explicitly excluded from ASR. Fresh VAD/ASR workers load
offline with **0 HTTPS requests**, real VAD zero-frame control **0.012012064 /
8.700 ms**, pending VAD Stop rejects and retains **2048 caller bytes**. No offline
speech recognition/full interpretation or invocation-observed kernel cancellation
claim. Remote paths **16**, page errors/native visibility `[]`. RSS baseline
**1294672 KiB**, case peaks **3276432–3844528 KiB**, sampled at 250 ms for owned
browser/renderers/GPU processes; shared pages/allocators/joint residency/PCM,
not isolated model/GPU allocation, leak/pressure/mobile qualification.

**Next remains B2:** improve louder-noise Japanese meanings, qualify natural
speakers/noise/word boundaries and delayed long-silence latency, sustained learned
live input/queue/GPU recovery/storage/memory and Whisper conversion/distribution
licensing before selecting a default. Full ASR comparison/stream/sustained,
energy-only noise, isolated VAD and B1 preparation UI are not rerun this iteration;
historical evidence is preserved, not fresh learned-profile acceptance. Offline
speech ASR/full interpretation, Korean translation/revisions/DOM, ten-minute live
Korean captions, B3–B6, external installation and Safari/iPhone remain unverified.
No absent required environment/device/permission or terminal marker; no checklist
or selected-stage/whole-framework/iPhone completion claim.

Root/nested AGENTS.md and requested independent runner file are absent at initial
read; supplied instructions/plan/architecture/prior Chrome evidence read. Work
stays in this worktree. Companion v0.1.0/install/native messaging/server/settings
and unrelated files/apps/recordings/mounted images are preserved. No agents,
runner edit, stage advance, push/publish/app installation or browser access/
profile/permission bypass. Only owned test browsers/profiles cleaned up. No
credentials, weights, user audio/transcripts or temporary `.ralph` state committed.

Final required verification: PASS, `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-5-verify.log`: Biome **112 files / 51 ms / no findings**, Ruff,
typecheck/unchanged companion build (**28 main / 10 content modules**),
**106 JS passed / 0 failed/skipped/cancelled / 21536.304625 ms**,
**222 Python passed / 66.91 s**, Python **3.12.15**. Runs after both model/browser
invocations; subsequent edits only complete Markdown records. Required full
Chrome acceptance remains failed and B2 remains unfinished.

PASS: document-inclusive unstaged/staged whitespace (`git diff --check` /
`git diff --cached --check`), **exit 0**. Only the plan/report/recognizer/tests
are staged, excluding ignored `.ralph` evidence/state. Intended commit and
post-commit cleanliness are checked before delivery.


### 2026-10-08 / chrome / iteration 6/20 — B2 bounded learned silence

Related commit: `fix: bound learned ASR silence submission`, containing this
entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default ASR model is selected.** Only B2 advances.

Changes: the experimental learned profile submits after >=1,500 ms of detected
silence (1,504 ms with full 32 ms frames), retaining 256 ms of exact context for
later speech. It no longer needs another onset or EOF to submit a completed
utterance during a long pause. Existing short-pause midpoint cuts, exact unfiltered
ASR samples, 20 s segment/30 s retained limits, pending-job/result bounds and
cancellation rules remain. No extra timer/VAD/model/backend/fallback/dependency,
public configuration or user setting is added. The energy-only comparison is
unchanged. Two regressions cover an open input, resumed contiguous PCM and
speech-free EOF rejection; mocks establish segmentation/lifetime, not accuracy.

Added independent `node tests/framework-chrome-silence.mjs`: two complete copies
of each unchanged fixture with >=5 s synthetic gaps/tail and seeded 0.006 RMS
noise, at 100 ms paced delivery. These new cases retain every original speech
sample/tag/sentence; the original ten-case/three-period noise harness, hashes,
exact-three meaning/error/coverage/latency gates and candidate comparisons remain
unchanged. The new command is not full selected-video/Korean-caption acceptance.
Criteria established before execution: real text before next onset/EOF, <3 s
from last detected active-frame delivery, <2 s endpoint-to-text, <=20% CER/WER,
every meaning twice for the two new periods, exact ASR slices/full speech coverage,
contiguous ranges, bounded queues, zero loss/drained queues and real VAD coverage/
padding/inference budget. First independently observed input hashes are pinned
for the final run. Expected text scores outputs only; no phrase injection.

Commands and results, evidence under ignored `.ralph/media-framework/`:

- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1 / 14 passed / 2 failed / 171.103709 ms**,
  `chrome-20261008-6-regression.log`: no open-stream long-silence result; energetic
  speech-free EOF remains attached until 7,424 ms.
- PASS after fix: speech/VAD tests, **exit 0 / 17 passed / 143.194042 ms**,
  `chrome-20261008-6-unit.log`, and `npm run typecheck`, **exit 0**.
- PASS: local Node/tsx historical detector-schedule replay, **exit 0 / four cases**,
  `chrome-20261008-6-schedule-replay.log`: all iteration 5 job ranges/EOF unchanged.
  Synthetic energetic context/fake ASR only, not historical PCM/accuracy inference.
  Those measured pauses are <=928 ms after speech. No third unchanged attempt
  at iteration 5's twice-observed louder-noise Japanese quality failure is made.
- PASS: first `caffeinate -disu node tests/framework-chrome-silence.mjs`, **exit 0**,
  `chrome-20261008-6-silence.log`, both new cases/four actual ASR jobs. Japanese
  **2/80 CER**, English **2/44 WER**, every meaning twice. Last-active-to-text
  **2,376.100–2,441.000 / 2,262.900–2,299.300 ms**. Joint first/cached preparation
  **54,174.446625 / 1,323.269584 ms**, not ASR latency. Before final run, only new
  harness hash assertions and redundant scaffold simplification are added.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-6-stage-acceptance.log`: missing script; B5 complete selected
  video → ASR → Korean translation → DOM is unimplemented. No substitute.
- PASS: script syntax, targeted three-file Biome **20 ms / no findings** and
  preliminary whitespace, **exit 0**. Final browser/verify evidence follows below.


Final real browser: PASS, same long-silence command, **exit 0**,
`chrome-20261008-6-silence-final.log`: fixed input hashes, **1,518 real VAD calls /
four ASR jobs**, all declared quality/latency/coverage/revision/queue/network
assertions. Japanese **2/80 = 2.5% CER**, English **2/44 = 4.545455% WER**, every
meaning twice. Endpoint-to-text **1,080.000–1,251.700 / 940.500–979.000 ms**;
last-active-delivery to text **2,379.700–2,451.700 / 2,240.300–2,279.700 ms**.
Actual ASR host calls **733.900–944.700 ms**, peak pending **13,004 / 12,660 ms**,
zero reported lost/final pending. Ranges **576–8,896 / 8,896–20,832 ms** Japanese,
**576–8,640 / 8,640–20,320 ms** English; each complete original speech period
is covered by exact unfiltered PCM. Speech-free leading context **576 ms** and
EOF tails **3,720 / 3,656 ms** are deliberately rejected, separate from queue
loss. Detector padding **384 samples/language** never enters ASR. Real detector
inference totals **456.100 / 446.600 ms**, max frame **12.900 / 11.200 ms**.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js/ORT. Input is **paced decoded synthetic PCM**, not live selected
video or natural speech/noise. Same pinned small FP16 WebGPU ASR **487,960,440
bytes** and Silero WASM VAD **2,243,022 bytes**, one inventory each per owned fresh
browser invocation, then cached fresh English workers. First/cached preparation
**55,280.454209 / 1,220.172375 ms**, not recognition latency. No remote inference,
companion/Ollama; remote paths **16**, page errors/native visibility events `[]`.
RSS baseline **1,298,448 KiB**, case peaks **3,321,952 / 3,815,104 KiB**, sampled
at 250 ms for only the owned browser tree; includes shared pages/allocators/joint
models/PCM, not isolated GPU allocations, pressure, leaks or mobile qualification.
Detailed hashes/sample counts/timing/RSS are in the report. Latencies use one
document clock and exclude earlier speech accumulation, translation and display.

**Next remains B2:** improve retained louder-noise Japanese meaning, qualify
natural speakers/noise/word boundaries, learned live input and sustained queue/
GPU-loss/storage/pressure/memory, resolve Whisper conversion/distribution
licensing and then select a default. The original noise suite/model comparison/
stream/sustained/isolated VAD/B1 UI commands are not rerun; historical results are
not fresh full-profile passes. New long-silence cases pass, but broader quiet
phonemes/boundaries remain unverified. Offline speech/full interpretation, Korean
translation/revisions/DOM, ten-minute live Korean captions, B3–B6, installation
and Safari/iPhone are unfinished. No absent required environment/device/permission
or terminal marker; no checkbox or stage/framework/iPhone completion claim.

Root/nested AGENTS.md and requested runner evidence file are absent at initial
read; supplied instructions/plan/architecture/prior report read. Work stays here;
companion v0.1.0/install/native messaging/server/settings and unrelated files/apps/
recordings/mounted images are preserved. No agents, runner change, stage advance,
push/publish/app installation or browser access/profile/permission bypass. Only
owned test browsers/profiles cleaned up. No credentials, weights, user audio/
transcripts or temporary `.ralph` state staged/committed.


Final required verification: PASS, `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-6-verify.log`: Biome **113 files / 51 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**108 JS passed / 0 failed/skipped/cancelled / 21,126.336958 ms**,
**222 Python passed / 66.94 s**, Python **3.12.15**. Runs after both actual
model/browser invocations; subsequent changes complete only Markdown records.
Full Chrome acceptance and B2 remain unfinished, as distinguished above.

PASS: final document-inclusive unstaged/staged whitespace checks, **exit 0**.
Only the plan/report/recognizer/unit tests/new silence harness are staged;
ignored `.ralph` state is excluded. Intended commit and post-commit cleanliness
are checked before delivery.


### 2026-10-08 / chrome / iteration 7/20 — B2 learned live selected-video qualification

Related commit: `test: qualify learned ASR on live selected video`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no default model is selected.** Only B2 advances.

Changes: added `npm run test:framework:chrome:live:learned`, an independent owned
browser harness and an opt-in learned detector in the existing live fixture.
Real selected-element 48 kHz PCM → production 16 kHz normalization → WASM VAD →
FP16 WebGPU ASR is measured with two simultaneously playing, unchanged hash-checked
synthetic videos. Production engines/core/contracts/models/dependencies and
settings are unchanged. The default fixture still uses the energy profile.
No oracle/decoded PCM or expected-text prompt enters inference; fixture text only
scores results. Korean translation/DOM and full-stage acceptance are not supplied.

Gates retain <=20% CER/WER, all meaning anchors once/exactly three times, selected
and other-video tag isolation, <150 ms video mapping error, exact normalization/
clock/sample and ASR input/range accounting, <=20 s segments, <=30 s retained
budget, zero completed-run loss/drained queues, <2 s final-packet-to-text, <=100 ms
leading skipped context and <20 ms trailing context. Real detector coverage/
padding/inference budget, actual Stop/restart/playback preservation and capture
continuing during Japanese long-input inference are asserted. No prior acceptance,
fixture or threshold is weakened.

Commands/evidence under ignored `.ralph/media-framework/`:

- FAIL: first `caffeinate -disu npm run test:framework:chrome:live:learned`,
  **exit 1**, `chrome-20261008-7-live-learned.log`: typecheck/**22 unit tests /
  126.421583 ms** pass; a new segment-count check interrupts final English scoring.
  Japanese single/restart 1/40 CER, English single 1/22 WER, Japanese long 10/120
  CER, all their meanings pass. English 320,853 captured samples, ASR range
  32–20,032 ms, rejected EOF context 21.3125 ms. That context exceeds the retained
  <20 ms criterion (not reached before the assertion); no speech-loss/phoneme
  label is inferred, and this historical alignment remains qualification work.
- FAIL: diagnostic same command, **exit 1**,
  `chrome-20261008-7-live-learned-final.log`: typecheck/**22 unit tests**, all six
  real rounds complete. Japanese long 7/120 CER, English long 3/66 WER and every
  meaning exactly three, no rejected tail. Sole failure is the new count calculation:
  it falsely demands two jobs for the admitted English 64–20,053.3125 ms window
  by counting already-permitted leading quiet audio. Corrected it to count the
  contiguous admitted window, retaining all leading/trailing/segment/coverage
  limits. This is new diagnostic evidence; no third unchanged attempt is made.
- PASS: `caffeinate -disu node .ralph/media-framework/chrome-20261008-7-energy-live-control.mjs`,
  **exit 0**, `chrome-20261008-7-energy-live-control.log`. Explicit local control
  extracts the existing stream harness's complete six-round live block and owned
  setup, with its original assertions and default fixture call unchanged. Every
  gate passes, including two jobs for both long inputs, Stop/restart, playback,
  isolation, meaning and <=20% error. Japanese 1/40, 1/40, 3/120 CER; English
  1/22, 3/66 WER; final-packet latency 824–1,058.800 ms, peak pending 13,060.6875
  ms, zero completed-run loss/final pending. This is not a full stream/sustained/
  GPU-loss rerun; the temporary control source is not committed.
- PASS: corrected final learned command, **exit 0**,
  `chrome-20261008-7-live-learned-corrected.log`: typecheck/**22 tests / 0 failed/
  skipped/cancelled / 134.290166 ms**, six actual live rounds/**1,960 VAD calls /
  six ASR jobs**, all declared gates. Japanese single/restart 1/40 CER, long
  10/120 CER; English single 1/22 WER, long 3/66 WER; all meanings once/three
  times. Completed runs have zero reported loss/final pending/rejected EOF context.
  Leading skipped context is 64 ms; all remaining captured input equals contiguous
  actual ASR slices. Long Japanese ranges 64–20,064 / 20,064–20,992 ms; English
  64–20,053.3125 ms. Final-packet-to-text 847.100–1,652.100 ms, peak pending
  20,928 ms, video map error <=51.265 ms, max VAD inference 10.400 ms. Earlier
  Japanese 20 s ASR call takes 2,120 ms; the final-packet gate is not a per-job
  two-second or first-caption latency claim. Full raw/sample/padding/RSS tables
  and preserved failures are in the report.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-7-stage-acceptance.log`: missing script, B5 full selected-video
  PCM → ASR → Korean translation → DOM unimplemented. No placeholder/substitute.
- PASS: final harness syntax, targeted Biome (34 ms/no findings) and preliminary
  whitespace, **exit 0**.
- PASS: `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-7-verify.log`: Biome 114 files/52 ms/no findings, Ruff/typecheck,
  unchanged companion build (28 main/10 content modules), **108 JS passed /
  0 failed/skipped/cancelled / 24,828.208084 ms**, **222 Python passed / 66.89 s**,
  Python 3.12.15. Runs after all actual browser/model invocations; subsequent
  changes only complete Markdown evidence.

Environment: owned headed Chromium 153.0.8010.12, macOS 26.6.2/25G83 arm64,
Node v24.15.0/npm 11.12.1/uv 0.12.23, unchanged locked Transformers.js/ORT.
Same pinned small FP16 WebGPU ASR (487,960,440 bytes/seven files) and Silero WASM
VAD (2,243,022 bytes/one file); three fresh learned browser caches download one
inventory of each, then reuse it for fresh workers. The default control downloads
one ASR inventory. Final first/cached preparation 67,553.088875 /
1,223.875334–1,423.112625 ms, distinct from transcription latency. All 16 final
remote paths/requests are pinned artifacts/allowed redirects; page errors/native
visibility events are empty. RSS baseline 1,437,920 KiB, case peak 3,801,536 KiB
(after preparation), sampled at 250 ms for only the owned browser tree including
shared pages/allocators/GPU/models and test PCM snapshots; not isolated memory,
preparation peak, pressure/leak or phone evidence. Stop discards 831.375 ms with
no text/pending, and detaches capture while both original videos continue.
Latencies use one document clock and exclude utterance accumulation/loading/
Korean translation/display; 20 s accumulation can precede first long-input text.

**Next remains B2:** retained louder-noise Japanese meaning failure, natural
speaker/noise/word boundaries and live EOF alignments (including the first run's
21.3125 ms tail), sustained learned live acquisition/recovery under pressure,
storage/memory, conversion/distribution licensing and evidence-based default
selection. A later passing alignment does not fix that earlier observation.
Original noise/full comparison/stream/sustained/VAD/B1 UI commands are not rerun;
historical results are not fresh full-profile passes. Offline speech/full
interpretation, Korean translation/revisions/DOM, ten-minute live Korean captions,
B3–B6, installation and Safari/iPhone remain unverified. No absent required
environment/device/permission, terminal marker, checkbox or completion claim.

Root/nested AGENTS.md/requested runner evidence are absent at initial read;
supplied instructions/plan/architecture/prior report read. Only this worktree is
changed. Published companion/install/native messaging/server/settings and unrelated
files/apps/recordings/mounted images are preserved. No agents, runner edit,
stage advance, push/publish/app installation or blocked-browser access/profile/
permission bypass. Only owned test browsers/profiles cleaned up. No credentials,
weights, user audio/transcripts or temporary ignored `.ralph` state enter Git.


PASS: document-inclusive unstaged/staged whitespace checks, **exit 0**. Only the
plan/report/package scripts/live fixture/new learned live harness are staged;
ignored `.ralph` state is excluded. Commit and post-commit cleanliness are checked
before delivery.


### 2026-10-08 / chrome / iteration 8/20 — B2 fixed EOF alignment qualification

Related commit: `test: expose browser ASR EOF alignment failures`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Added `npm run test:framework:chrome:eof` and an independent real-browser harness
for iteration 7's unresolved live EOF alignment. The smaller approach measures
coverage and actual recognition before altering production admission. Three
complete, unchanged hash-checked synthetic speech periods/language are decoded
and resampled to 16 kHz; 512 leading zeros and 0/341/511 trailing zeros form the
first six cases. The final harness preserves those cases, adds 853/1,365 trailing
zeros and measures rejected-tail RMS/peak without retaining PCM. Real production
WASM VAD and FP16 WebGPU ASR consume 100 ms paced decoded input. This is not live
selected-element acquisition, natural speech, Korean translation or caption DOM.
No expected-text prompt, filtering, gain change, removed sentence or blacklist.
Production engines/core/contracts/models/dependencies/settings are unchanged.

Retained gates: <=20% CER/WER, every meaning exactly three times, <=20 s jobs,
<=30 s retained audio, zero reported drop/drained queue, <=100 ms leading context,
**<20 ms trailing context**, <2 s endpoint-to-text, exact ASR input/range/revision
and detector coverage/padding, <10% duration in VAD inference, cached fresh
workers and pinned network/page-lifetime assertions. The new harness separately
requires every original tail sample to reach ASR. Existing comparison/noise/live/
sustained/full-stage acceptance remains untouched.

Initial commands (ignored `.ralph/media-framework/` evidence):

- FAIL: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 1**,
  `chrome-20261008-8-eof.log`: typecheck/build, six real cases/**3,847 detector
  calls / nine ASR jobs** complete. Japanese **7/120 = 5.833333% CER**, English
  **3/66 = 4.545455% WER**, every meaning three times; no original tail rejection,
  no reported drop/final pending. Japanese first-job endpoint latency
  **2,096.200 / 2,044.400 / 2,004.100 ms** fails <2 s. Its final-job latency
  **1,416.700–1,549.300 ms** passes; that different metric does not override the
  first-job failures. English tail-341/511 reject **20.8125 / 31.4375 ms** and
  fail <20 ms despite zero queue loss. English zero-tail passes every gate.
  Final code adds waveform measurements and two offsets before a second run;
  no third unchanged attempt is made. The report retains ranges/sample counts.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-8-stage-acceptance.log`: missing script. B5 full selected-video
  PCM → ASR → Korean translation → DOM acceptance is unfinished; no placeholder.
- PASS: script syntax, targeted one-file Biome (**39 ms / no findings**) and
  preliminary whitespace, **exit 0**.

Final real-model results and required repository verification are recorded below
following actual execution.


Final real browser: FAIL, same EOF command, **exit 1**,
`chrome-20261008-8-eof-final.log`: typecheck/build, **ten real cases / 6,419 VAD
calls / 15 ASR jobs** complete; **nine** failures. All five Japanese first-job
endpoint latencies **2,033.300–2,058.000 ms** exceed <2 s; English tail-341/511/
853/1365 reject **20.8125 / 31.4375 / 52.8125 / 84.8125 ms**, exceeding <20 ms.
All Japanese **7/120 CER**, all English **3/66 WER**, every meaning exactly three;
no original tail rejection, zero reported drop/drained queues. Every ASR job is
an exact contiguous input slice, <=20 s; peak pending **21,002.0625 ms**. All
four rejected English tails measure **RMS 0 / peak 0**, consisting solely of
appended zeros after the original end at **20,031.5 ms**. This is known generated
silence rejection, not evidence of live phoneme loss or a fix of iteration 7's
21.3125 ms live context. The raw <20 ms gate remains unchanged and failing.
Japanese final-job latency **1,413.400–1,501.600 ms** cannot override its earlier
first-job failures. No third attempt; no speculative production fix/default.

PASS: Python recorded-result analysis, **exit 0**: six repeated full-input hashes
and transcript strings equal across invocations; all ten final recognition/
meaning/PCM/queue checks pass and rejected tails are exactly zero. Analysis is
not another inference or a passing qualification command. The report contains
all ten input hashes, ranges/sample/padding/RSS and per-case timing tables.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js/ORT. Same pinned small FP16 WebGPU ASR (**487,960,440 model
bytes / seven files**) and Silero WASM VAD (**2,243,022 bytes / one file**).
Each of two browser invocations downloads one inventory each in a fresh owned
cache, then prepares cached fresh workers. Final first/cached preparation
**56,891.995917 / 1,218.376334–1,321.242250 ms**, not recognition latency.
Allowed artifact/redirect paths **16**, no remote inference/companion/Ollama;
page errors/native visibility events empty. Actual host calls **301.200–2,048.200
ms**, max VAD inference **11.400 ms**. Ten finite decoded sessions total
**205,285 ms input**, not one sustained or ten-minute live run. Latencies use
one document clock, excluding speech accumulation/loading/translation/display;
VAD/RSS clocks remain separate. Owned-tree RSS baseline/peak **1,303,264 /
3,946,208 KiB**, 250 ms sampling including preparation/shared pages/allocators/
models/browser/GPU/PCM; not isolated memory, pressure/leaks or phone evidence.

**Next remains B2:** improve measured forced-boundary latency/EOF coverage with
these preserved gates, then qualify natural speech/noise/boundaries and earlier
live EOF behavior. Louder-noise Japanese meaning, sustained learned live queue/
GPU-loss recovery under pressure, storage/memory, conversion/distribution
licensing and a qualified default remain unfinished. Original noise/comparison/
stream/sustained/VAD/B1 commands are not rerun; prior evidence stays historical.
Offline speech/full interpretation, Korean translation/revisions/DOM, ten-minute
live Korean captions, B3–B6, installation and Safari/iPhone remain unverified.
No missing required environment/device/permission, terminal marker, checkbox or
stage/framework/iPhone completion claim.

Root/nested AGENTS.md/requested independent runner evidence are absent at initial
read; instructions/plan/architecture/prior report read. Only this worktree changes;
companion/install/native messaging/server/settings and unrelated files/apps/
recordings/mounted images are preserved. No agents, runner edit, stage advance,
push/publish/app installation or blocked browser access/profile/permission bypass.
Only owned test browsers/profiles cleaned up. Credentials/weights/user audio/
transcripts and temporary ignored `.ralph` state are excluded from the commit.


Final required verification: PASS, `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-8-verify.log`: Biome **115 files / 56 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**108 JS passed / 0 failed/skipped/cancelled / 21,660.429583 ms**,
**222 Python passed / 66.92 s**, Python **3.12.15**. Verification runs after both
actual browser/model invocations; later edits only finish Markdown evidence.
This does not override the failed EOF qualification or missing full Chrome
acceptance. Final document-inclusive unstaged/staged whitespace and post-commit
cleanliness are checked before delivery. Staged paths are only this plan, the
Chrome report, package script and EOF harness; no temporary `.ralph` state,
credentials, model weights or user data are staged.


### 2026-10-08 / chrome / iteration 9/20 — B2 earlier learned long-input boundaries

Related commit: `fix: bound long browser ASR at learned pauses`, containing this
entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Assumption: iteration 8's failed latency/EOF gates require changed segmentation,
not another unchanged retry or a generated-silence exception. The retained trace
shows Japanese **256 ms** and English **224 ms** pauses after ten seconds.
The smaller fix uses existing detected pauses: **>=200 ms after 10 s**, still
**>=500 ms before 10 s**, midpoint split only on the next speech onset. The
1,500 ms immediate long-silence endpoint, 256 ms retained context, 20 s maximum,
30 s retained-audio budget, pending job/result limits and energy comparison remain.
No inference audio filtering/padding, expected-text prompt, model/backend/dependency,
fallback, product default or settings changes. Two regression tests cover the late
short pause plus five exact EOF offsets and unchanged early short-pause behavior.
No acceptance harness, fixture, input hash, sentence or threshold is altered.

Exact command evidence (ignored local `.ralph/media-framework/` logs):

- FAIL before fix: standalone speech tests, **exit 1**, **17 passed / 1 failed /
  174.034875 ms**, `chrome-20261008-9-regression.log`: only 0–20,000 ms is submitted,
  failing earlier contiguous **0–11,200 / 11,200–20,031.5 ms** EOF coverage.
- PASS after fix: `npm run typecheck` and targeted speech/VAD/normalization tests,
  **exit 0**, **24 passed / 172.869125 ms**, `chrome-20261008-9-unit.log`.
  Fake transport/segmentation/lifecycle only, not recognition accuracy.
- PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**, once,
  `chrome-20261008-9-eof.log`: **ten cases / 6,419 real WASM VAD calls / 20 FP16
  WebGPU ASR jobs**. Japanese **6/120 = 5% CER**, English **3/66 = 4.545455% WER**,
  every meaning exactly three, **814.100–1,688.600 ms per-endpoint-to-text**,
  **32 ms leading / 0 ms trailing context**, every original/tail sample submitted,
  exact contiguous ASR slices, peak pending **16,268 ms**, zero loss/drained queue.
  All ten full input hashes match iteration 8. Jobs split at **14,688 ms Japanese /
  11,200 ms English**, avoiding the forced cut for these exact inputs. Report
  contains every per-case timing/range/RSS measurement. All gates unchanged.
- PASS: `caffeinate -disu npm run test:framework:chrome:live:learned`, **exit 0**,
  once, `chrome-20261008-9-live.log`: typecheck/**24 tests / 206.399125 ms**,
  **six live selected-video rounds / 1,961 actual VAD calls / seven ASR jobs**.
  Japanese single/three-period **2.5% CER**, English **4.545455% WER**; every
  meaning once/three times as applicable. **859.100–1,015.100 ms last-packet-to-
  text**, **64 ms leading / 0 ms trailing context**, completed runs zero lost/
  final pending, peak pending **16,319.375 ms**. The live latency metric is
  distinct from per-endpoint latency. Stop interrupts **27 detector frames**,
  explicitly discards **799.375 ms**, emits no text and drains; fresh Start passes.
  Both videos retain playback state/advance; actual normalized selected samples,
  tag isolation, mapping (**24.579–59.260 ms error**) and continued acquisition
  during inference pass. This is short synthetic speech, not natural speakers or
  Korean translation/DOM/ten-minute captions.
- PASS: explicit Python recorded-result checks, **exit 0**, for identical EOF
  hashes/quality and all live recognition/meaning/EOF/queue/Stop gates. Initial
  live metadata extraction **exit 1 / TypeError** applied `len` to an integer;
  corrected extraction reports **16** remote requests. No inference rerun.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-9-stage-acceptance.log`: missing B5 full selected-video PCM →
  ASR → Korean translation → DOM harness. No placeholder/substitute or weaker gate.
- PASS: targeted two-file Biome **23 ms / no findings**, whitespace, **exit 0**.
- PASS: final `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-9-verify.log`: Biome **115 files / 52 ms**, Ruff/typecheck,
  unchanged companion build **28 main / 10 content modules**, **110 JS passed /
  0 failed/skipped/cancelled / 20,986.647666 ms**, **222 Python passed / 66.95 s**,
  Python **3.12.15**. Runs after all real browser/model invocations; later edits
  only complete Markdown records.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js **4.3.0**/ORT. Same pinned small FP16 ASR **487,960,440 model bytes /
seven files**, Silero WASM **2,243,022 bytes / one file**. Each of two browser
invocations downloads one inventory each into fresh owned caches; later fresh
workers use cached files. Initial EOF/live preparation **67,917.292958 /
77,344.567125 ms**, cached **1,220.205041–1,420.398417 ms**, separate from ASR.
Each run has **16 pinned artifact/redirect paths**, no remote inference/companion/
Ollama, empty page-error/native visibility observations. Tree RSS EOF baseline/
peak **1,299,040 / 3,987,392 KiB**; live baseline/case peak **1,430,672 /
4,029,280 KiB**. Report explains sample timing/shared-page/allocator/model/harness
limits; not isolated GPU memory, leak/pressure/storage or phone qualification.

**Next remains B2:** qualify long/no-pause/quiet boundaries and natural speech/
noise, improve retained louder-noise Japanese meaning, sustained learned live
queue/GPU recovery and memory/storage, resolve conversion/distribution licensing
and select a qualified default. Short/no-pause forced-boundary remainders remain
unqualified. Original noise/full comparison/stream/sustained/VAD/B1 commands are
not rerun; prior passes/failures remain historical. Offline full speech/
interpretation, Korean translation/revisions/DOM, ten-minute live captions, B3–B6,
installation and Safari/iPhone are unverified. No required permission/environment/
device is absent; no checkbox, completion claim or terminal marker is warranted.

Root/nested AGENTS.md and requested independent runner evidence are absent at
initial read; supplied instructions/plan/architecture/prior report read. Only this
worktree changes; companion/install/native messaging/server/settings and unrelated
files/apps/recordings/mounted images preserved. No agents, runner edit, stage
advance, push/publish/app installation or browser access/profile/permission bypass.
Only owned test browsers/profiles cleaned up. Final document-inclusive unstaged/
staged whitespace, commit scope and post-commit cleanliness checked before delivery;
only recognizer, regression tests, report and plan staged. Credentials/weights/user
audio/transcripts/temporary ignored `.ralph` state are excluded from commits.


### 2026-10-08 / chrome / iteration 10/20

관련 commit: 이 기록을 포함한 `fix: retain quiet browser speech onset context`.
**B2 remains unchecked; no model default is selected.** Only B2 advances.

수행한 변경: added `test:framework:chrome:quiet`, reusing the EOF harness for
unchanged Japanese/English synthetic sentences at input gains 1/0.25/0.1, three
complete periods, 512 zero prefix and 511 zero tail samples. Every quality,
meaning, latency, EOF and queue gate is retained; the original ten EOF cases stay.
Actual tenth-volume input exposes lost initial context. A failing regression
reproduces 1,696–3,200 ms instead of 0–3,200 ms; lower only the learned path's
context-retention RMS from 0.01 to 0.001, keeping learned speech admission at
probability 0.5, energy-only comparison, all segmentation/job/queue limits and
exact unfiltered ASR PCM. No new model/backend/dependency/default/settings.
The unit also verifies 40 s rejected quiet input without ASR and bounded retention.

실행한 명령과 결과 (ignored local `.ralph/media-framework/` evidence):

- FAIL before fix: standalone speech tests, **exit 1**, **18 passed / 1 failed /
  216.075084 ms**, `chrome-20261008-10-regression.log`: exact 1,696 ms onset loss.
- PASS after fix: `npm run typecheck` and targeted speech/VAD/normalization tests,
  **exit 0**, **25 passed / 202.460709 ms**, `chrome-20261008-10-unit.log`.
  Fake transport/lifecycle, not accuracy.
- FAIL: `caffeinate -disu npm run test:framework:chrome:quiet`, **exit 1**, twice,
  `chrome-20261008-10-quiet-{first,final}.log`. Final **six real cases / 3,849 WASM
  VAD calls / 24 FP16 WebGPU ASR jobs**. Onset **192→32 ms Japanese /
  1,696→32 ms English** at gain 0.1; every final case **32 ms leading / 0 ms
  trailing**, exact contiguous PCM, all tail positions, zero loss/drained queue,
  <10% VAD cost pass. Japanese gains 0.25/0.1 retain latency failures at
  **2,034.800 / 2,066.100 ms**. English quieter inputs retain `not meet today`
  only **two** times instead of three; all other meaning counts three.
  Japanese final **6/120, 7/120, 7/120 CER**, English **3/66, 4/66, 4/66 WER**;
  gain 0.1 English improves from **10/66 WER**, still fails meaning. Four final
  qualification failures remain; no third unchanged quiet retry.
- PASS: explicit Python recorded-result analysis, **exit 0**: all six complete
  input hashes and every VAD probability/activity are identical before/after;
  final onset/EOF/exact-job/queue/cost checks pass. Analysis is not another run.
- PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**,
  `chrome-20261008-10-eof.log`: **ten original cases / 6,419 actual VAD calls /
  20 ASR jobs**, all gates pass; Japanese **5% CER**, English **4.545455% WER**,
  every meaning three times, **809.200–1,668.700 ms per endpoint**, **32 ms
  leading / 0 ms trailing**, exact PCM/ranges, peak pending **16,268 ms**,
  zero loss/drained queue. Python analysis confirms all input hashes match
  iteration 9. All per-case measurements and six quiet input hashes are in report.
- FAIL: required `npm run test:framework:chrome`, **exit 1**,
  `chrome-20261008-10-stage-acceptance-final.log`: missing B5 full PCM → ASR →
  Korean translation → DOM harness. An earlier invocation's log-reading wrapper
  returned 0 while npm reported the same missing script; not passing acceptance.
  No substitute/placeholder/weaker gate or further unchanged retry.
- PASS: targeted Biome **3 files / 20 ms**, syntax and preliminary whitespace,
  **exit 0**. Final document/staged whitespace checked before committing.
- PASS: final `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-10-verify.log`: Biome **115 files / 52 ms**, Ruff/typecheck,
  unchanged companion **28 main / 10 content modules**, **111 JS passed /
  0 failed/skipped/cancelled / 21,677.050 ms**, **222 Python passed / 66.92 s**,
  Python **3.12.15**. Runs after three real browser/model invocations; later edits
  only complete Markdown records. Required Chrome acceptance still fails.

실제 검증한 범위: controlled attenuated decoded synthetic PCM, actual WASM VAD
and FP16 WebGPU ASR; no live acquisition, natural quiet/noisy speaker or Korean
translation/DOM. Owned Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked Transformers.js **4.3.0**/
ORT. Each browser invocation downloads one fresh inventory of the same pinned
small FP16 ASR (**487,960,440 bytes / seven files**) and Silero
(**2,243,022 bytes / one file**), then uses cached fresh workers. Final quiet/EOF
initial preparation **56,855.619250 / 54,506.992958 ms**; separate from recognition.
Each has 16 pinned artifact/redirect paths, empty page errors/visibility events;
no remote inference/companion/Ollama. Final quiet/EOF RSS peaks **3,820,784 /
4,078,384 KiB**; 250 ms owned-tree samples include preparation/browser/renderers/
GPU/shared-page double counting/allocators/models/harness PCM. Not isolated model
memory, leak freedom, pressure/storage or phone qualification.

다음 미완료 항목: **B2**, improve retained quiet Japanese forced-boundary latency
and English meeting-negation loss with these gates/cases intact, then qualify
no-pause/quiet phoneme boundaries/natural speakers/noise, earlier louder-noise
Japanese meaning, sustained learned live pressure/GPU recovery, storage/memory,
conversion/distribution licensing and default selection. Historical live/noise/
full-candidate/stream/sustained/VAD/B1 checks are not rerun. Offline full speech/
interpretation, Korean translation/revisions/DOM, ten-minute live captions, B3–B6,
installation and Safari/iPhone remain unverified. No required environment/device/
permission is absent; this is failed qualification/incomplete implementation,
so no terminal marker or checkbox change is warranted.

Supplied instructions/plan/architecture/prior report read; root/nested AGENTS.md
and requested independent runner evidence absent at initial read. Only this
worktree changes; companion/install/native messaging/server/settings and unrelated
files/apps/recordings/mounted images preserved. No agents, runner edits, stage
advance, push/publish/app installation or blocked browser/profile/permission
bypass. Only owned test browsers/profiles cleaned up. Commit scope is recognizer,
regression test, EOF harness, package script, report and plan. Credentials, weights,
user audio/transcripts and temporary `.ralph` state are excluded. Post-commit
cleanliness checked before delivery; no stage/framework/iPhone completion claim.


### 2026-10-08 / chrome / iteration 11/20

Related commit: `fix: split late browser speech at shorter pauses`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Assumption: resolve the retained quiet Japanese forced-boundary latency using
existing learned pause evidence before adding a detector/model/segmentation
mechanism. Prior late pauses shrink to **192/160 ms** at input gains 0.25/0.1,
below the 200 ms rule. Permit **five full frames / 160 ms after ten seconds**,
still splitting at the next learned onset's pause midpoint. All earlier 500 ms
pauses, admission probability 0.5, context RMS 0.001, 1,500 ms silence endpoint/
256 ms retained context, 20 s segment/30 s queue and pending/result bounds remain.
No harness/fixture/hash/sentence/gate/model/backend/dependency/default/settings
change; ASR PCM is contiguous and unfiltered. The fake regression crosses
128/160/192 ms late pauses with five EOF offsets, verifies the too-short control,
exact PCM/coverage/bounds and zero final loss/pending.

Exact command evidence (ignored local `.ralph/media-framework/` logs):

- FAIL: initial speech tests, **exit 1 / 19 passed / 1 failed / 211.850667 ms**,
  `chrome-20261008-11-regression.log`: the newly added 128 ms control incorrectly
  expects an unadmitted 31.5 ms tail job. Correct only its fake fixture to 21 s
  with admitted speech after the maximum cut, preserving all existing fixtures.
- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1 / 19 passed / 1 failed / 220.662750 ms**,
  `chrome-20261008-11-regression-final.log`: corrected five-frame pause submits
  **0–20,000 / 20,000–21,031.5** instead of **0–14,496 / 14,496–21,031.5 ms**.
- PASS after fix: `npm run typecheck` and targeted speech/VAD/normalization tests,
  **exit 0 / 26 passed / 263.828375 ms**, `chrome-20261008-11-unit.log`.
  Fake transport/lifecycle only, not recognition accuracy.
- FAIL: `caffeinate -disu npm run test:framework:chrome:quiet`, **exit 1**, once,
  `chrome-20261008-11-quiet.log`: **six cases / 3,849 real WASM VAD calls / 24
  FP16 WebGPU ASR jobs**. All Japanese gates now pass: gain 1/0.25/0.1 **3/120,
  3/120, 6/120 CER**, every meaning three, midpoint **11,776 / 14,720 / 14,752
  ms**, endpoint **834.900–1,560.900 ms**. Quieter Japanese improves from
  **2,034.800 / 2,066.100** to **1,489.300 / 1,560.900 ms**. Exactly two retained
  English meaning failures remain at gains 0.25/0.1 (`not meet today` twice,
  required three); WER **4/66** still passes the error gate. Baseline English
  **3/66 WER / every meaning three**. All six latency/EOF/exact-job/queue/VAD
  cost gates pass, **32 ms leading / 0 ms trailing**, zero loss/drained queue.
  No unchanged quiet retry; all case timing/RSS/VAD evidence is in the report.
- PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**, once,
  `chrome-20261008-11-eof.log`: **ten unchanged cases / 6,419 real VAD calls /
  20 ASR jobs**, every original gate passes. Japanese **2.5% CER**, English
  **4.545455% WER**, every meaning three, **899.800–1,414.000 ms per endpoint**,
  **32 ms leading / 0 ms trailing**, exact contiguous PCM through every tail
  offset, peak pending **13,168 ms**, zero loss/drained queue.
- PASS: `caffeinate -disu npm run test:framework:chrome:live:learned`, **exit 0**,
  once, `chrome-20261008-11-live.log`: typecheck/**26 tests / 263.294291 ms**,
  **six selected-video rounds / 1,961 actual VAD calls / seven ASR jobs**.
  Japanese short/three-period **2.5% CER**, English **4.545455% WER**, every
  meaning once/three times; **852.000–1,088.200 ms last-packet-to-text**, leading
  **32–96 ms / 0 ms trailing**, completed runs zero loss/pending, peak pending
  **13,204.6875 ms**, max mapping error **48.573333 ms**. Stop interrupts 27
  real detector frames, explicitly discards **863.375 ms**, emits no text and
  drains; fresh Start passes. Both videos keep playback state/advance; isolation,
  exact captured/normalized input and capture/inference overlap pass. Different
  live/EOF latency metrics are kept separate. No Korean translation/DOM claim.
- PASS: explicit Python recorded-result assertions, **exit 0**, confirm every
  quiet/EOF input hash and VAD probability/activity matches iteration 10 and
  all current gates except the two retained English meaning failures, plus live
  recognition/meaning/latency/queue/Stop. Initial live extraction **exit 1 /
  KeyError: queue** used model statuses instead of queueStatuses; corrected
  extraction passes. Analysis/reporting failure is not another model run.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-11-stage-acceptance.log`: missing B5 full PCM → ASR → Korean
  translation → DOM harness. No placeholder/substitute/weaker gate or retry.
- PASS: targeted Biome **two files / 7 ms / no findings**, preliminary whitespace,
  **exit 0**. Final document-inclusive unstaged/staged whitespace also checked.
- PASS: final `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-11-verify.log`: Biome **115 files / 53 ms**, Ruff/typecheck,
  unchanged companion build **28 main / 10 content modules**, **112 JS passed /
  0 failed/skipped/cancelled / 21,219.986792 ms**, **222 Python passed / 66.85 s**,
  Python **3.12.15**. Runs after all three real browser/model invocations; later
  edits only finish Markdown evidence. Required Chrome acceptance still fails.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js **4.3.0**/ORT. Same pinned small FP16 WebGPU ASR
**487,960,440 bytes / seven files** and Silero WASM **2,243,022 bytes / one file**.
Each invocation downloads one inventory each into a fresh owned cache and reuses
it. Initial quiet/EOF/live preparation **61,777.770125 / 53,783.445292 /
52,841.797500 ms**, distinct from recognition; each has 16 pinned remote paths,
empty page errors/visibility events, no remote inference/companion/Ollama. Quiet/
EOF/live case RSS peaks **3,810,272 / 3,855,968 / 3,807,200 KiB**; live cases
start after preparation. 250 ms owned-tree sums include shared pages/allocators/
GPU/browser/models/harness PCM, not isolated memory/leak/pressure/mobile evidence.

**Next remains B2:** retained quiet English fragmented negation, no-pause/quiet
phoneme boundaries/natural speakers/noise, earlier louder-noise Japanese meaning,
sustained learned live queue/GPU recovery, memory/storage, conversion/distribution
licensing and default selection. Noise/full-candidate/stream/sustained/VAD/B1
commands are not rerun; their prior evidence is historical. Offline full speech/
interpretation, Korean translation/revisions/DOM, ten-minute Korean captions,
B3–B6, installation and Safari/iPhone remain unverified. No required environment/
device/permission is absent: failed quality/incomplete implementation warrants
neither terminal marker. No checkbox or completion claim is made.

Supplied instructions/plan/architecture/prior report read; root/nested AGENTS.md
and requested independent runner evidence file are absent. Only this worktree
changes; companion/install/native messaging/server/settings and unrelated files/
apps/recordings/mounted images preserved. No agents, runner edit, stage advance,
push/publish/app installation or browser/profile/permission bypass. Only owned
test browsers/profiles cleaned up. Commit scope: recognizer, regression tests,
report and plan; no credentials/weights/user data/temporary `.ralph` state.
Post-commit cleanliness checked before delivery.


### 2026-10-08 / chrome / iteration 12/20

Related commit: `fix: confirm browser speech onset before pause cuts`, containing
this entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Assumption: retained quiet English meaning loss first needs boundary inspection,
before a model change. Prior active blips cause cuts at **448 / 13,856 ms** inside
meeting negation. Add bounded local state to confirm resumed onset with **five
consecutive frames / 160 ms**, then submit the stored pause midpoint. Inactivity
cancels an unconfirmed candidate. Pause eligibility **500 ms before ten seconds /
160 ms afterward**, learned threshold/context, immediate **1,500 ms** silence/
**256 ms** context, **20 s** jobs/**30 s** queue, pending/result limits and energy
comparison stay unchanged. No harness/fixture/hash/sentence/gate/model/backend/
dependency/default/settings change; admitted ASR PCM remains contiguous/unfiltered.

Exact command evidence (ignored local `.ralph/media-framework/` logs):

- FAIL before fix: speech regression command, **exit 1 / 20 passed / 1 failed /
  289.832916 ms**, `chrome-20261008-12-regression.log`: isolated active frame
  prematurely cuts at **2,880 ms**. The tail-log shell wrapper exits 0; actual
  test fails. New regression crosses 1/2/4/5 active frames, later real onset,
  exact concatenated PCM/detector coverage/bounds and zero final loss/pending.
- FAIL initial targeted tests, **exit 1 / 26 passed / 1 failed / 277.623625 ms**,
  `chrome-20261008-12-unit-initial.log`: exact overload discard expectation needs
  **4,128 → 4,256 ms** for four extra acquired frames. Only this exact timing is
  updated; the same pending-job bound/failure/late-result assertions remain.
- PASS: speech/VAD/normalization tests, **exit 0 / 27 passed /
  272.377667 ms**, `chrome-20261008-12-unit.log`. Fake transport only.
- PASS: `caffeinate -disu npm run test:framework:chrome:quiet`, **exit 0**, once,
  `chrome-20261008-12-quiet.log`: typecheck/build, **six actual cases / 3,849 WASM
  VAD calls / 19 FP16 WebGPU ASR jobs**. Every unchanged gate passes. Quiet
  English gains 0.25/0.1 improve from **4/66 → 3/66 WER**, meeting-negation count
  **2 → 3**; all meanings three. Baseline English **3/66**, Japanese gain
  1/0.25/0.1 **3/120, 3/120, 6/120 CER**. Endpoints **424.300–1,652.000 ms**,
  **32 ms leading / zero trailing**, exact contiguous PCM through EOF,
  **zero loss/pending**, peak pending **16,368 ms**. Case ranges/RSS/VAD/latency
  details are preserved in the report.
- PASS: explicit recorded-result Python assertions, **exit 0**, tool output:
  all six input hashes and every VAD probability/activity/sample position match
  iteration 11; current quality/meaning/latency/jobs/EOF/queue pass. Initial
  reporting **exit 1 / TypeError** uses unsupported `zip(strict=True)` in system
  Python **3.9.6**; explicit equal lengths correct it. No inference rerun.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-12-stage-acceptance.log`: B5 full selected-video PCM → ASR →
  Korean translation → DOM harness remains missing. No placeholder/substitute/
  weakened gate or unchanged retry.
- PASS: targeted Biome **two files / 21 ms / no findings** and preliminary
  whitespace, **exit 0**. Original EOF/live and final verification follow.

Actual quiet scope: paced attenuated decoded synthetic PCM and real learned VAD/
ASR, no natural quiet/noisy speakers or Korean translation/DOM. Owned Chromium
**153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node **v24.15.0**, npm
**11.12.1**, uv **0.12.23**, locked Transformers.js **4.3.0**/ORT unchanged.
One fresh inventory each of unchanged small FP16 WebGPU ASR **487,960,440 bytes /
seven files** and Silero WASM **2,243,022 bytes / one file**; cached fresh workers
follow. Quiet initial preparation **53,364.752291 ms**, cached
**1,220.161167–1,326.351166 ms**, 16 pinned paths, no page errors/visibility
events/remote inference/companion/Ollama. RSS baseline **1,297,712 KiB**, peak
**3,943,904 KiB**; 250 ms owned-tree samples include browser/renderers/GPU/shared
pages/allocators/models/harness PCM. Not isolated memory, leaks, pressure or mobile.


Original EOF acceptance:

- PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**, once,
  `chrome-20261008-12-eof.log`: **ten unchanged cases / 6,419 real VAD calls /
  20 ASR jobs**, all gates pass. Japanese **2.5% CER**, English **4.545455% WER**,
  every meaning three, **885.200–1,485.800 ms per endpoint**, **32 ms leading /
  zero trailing**, exact contiguous PCM through every tail, peak pending
  **13,168 ms**, zero loss/drained queue. Recorded-result Python assertions,
  **exit 0**, confirm all ten input hashes/VAD probabilities match iteration 11
  and all quality/latency/coverage/queue gates pass. No inference rerun.
- Same owned browser/OS/models; one fresh inventory each, cached fresh workers,
  initial preparation **54,996.201917 ms**, cached **1,217.726000–1,421.138916 ms**,
  16 pinned paths, empty page errors/visibility events. RSS baseline
  **1,292,544 KiB**, peak **3,877,552 KiB**, same limitations as above.


Live selected-video acceptance:

- PASS: `caffeinate -disu npm run test:framework:chrome:live:learned`, **exit 0**,
  once, `chrome-20261008-12-live.log`: typecheck/**27 tests / 257.395500 ms**,
  **six actual rounds / 1,959 real VAD calls / seven ASR jobs**. Japanese
  short/three-period **2.5% CER**, English **4.545455% WER**, every meaning
  once/three times; **812.600–1,005.800 ms last-packet-to-text**, **32–64 ms
  leading / zero trailing**, completed runs zero loss/pending, max mapping
  error **45.885667 ms**. Long Japanese split **14,752 ms**, peak pending
  **16,490 ms**; captured input differs from historical runs. Finite capture
  advances **15,060.6875–16,554 ms** during its first actual inference.
  Stop interrupts **27 detector frames**, discards **831.375 ms**, emits no
  text, drains/detaches and preserves playback; fresh Start passes. Isolation,
  input identity/exact slices/playback state/cached worker gates pass.
- PASS: recorded-result live assertions, **exit 0**, tool output, for every
  scored meaning/accuracy/latency/queue and Stop/playback. Initial metadata
  display **exit 0** uses `rounds` and prints excessive `liveRuns` output;
  corrected extraction selects six rounds/scalars. Reporting only, no rerun.
- Live initial preparation **53,956.750250 ms**, cached workers
  **1,319.228791–1,327.095000 ms**; one fresh inventory each of the unchanged
  candidates, then reuse, 16 pinned paths/requests and empty page errors/
  visibility events. RSS baseline **1,430,096 KiB**, case peak **3,791,824 KiB**;
  case measurements start after preparation and share the stated limitations.

**Next remains B2:** no-pause/quiet phoneme boundaries, natural speakers/noise,
earlier louder-noise Japanese meaning, sustained learned live queue/GPU recovery,
memory/storage, conversion/distribution licensing and default selection. The
retained quiet-English synthetic meaning failures now pass, but no checkbox is
completed. Noise/full-candidate/stream/sustained/VAD/B1 commands are not rerun;
prior evidence stays historical. Offline full interpretation, Korean translation/
revisions/DOM, ten-minute captions, B3–B6, installation and Safari/iPhone remain
unverified. No required environment/device/permission is absent; incomplete
qualification/implementation warrants neither terminal marker.

Root/nested AGENTS.md and requested independent runner evidence are absent;
supplied instructions/plan/architecture/prior report read. Only this worktree
changes; companion/install/native messaging/server/settings and unrelated user
files/apps/recordings/mounted images preserved. No agents, runner edit, stage
advance, push/publish/app installation or browser/profile/permission bypass.
Only owned test browsers/profiles cleaned up. Commit scope: recognizer,
regression tests, report and plan; no credentials/weights/user data/temporary
`.ralph` state. Final required verification/whitespace/commit cleanliness follow.


Final required verification:

- PASS: `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-12-verify.log`: Biome **115 files / 54 ms**, Ruff/typecheck,
  unchanged companion **28 main / 10 content modules**, **113 JS passed /
  0 failed/skipped/cancelled / 21,813.770292 ms**, **222 Python passed / 66.94 s**,
  Python **3.12.15**. Runs after all three actual browser/model invocations;
  subsequent changes only finish Markdown evidence. Required full Chrome
  acceptance still fails; B2–B6 remain unchecked.
- PASS: final document-inclusive unstaged/staged `git diff --check`, exact
  four-file commit scope and post-commit worktree cleanliness checked before
  delivery. Only recognizer, regression tests, report and plan are committed.


### 2026-10-08 / chrome / iteration 13/20 — B2 cached offline recognition

Related commit: `test: qualify cached browser ASR offline`, containing this entry
and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Assumption: rerun original louder-noise qualification against iteration 12's
confirmed-onset segmentation before attributing the retained Japanese meaning
failure to a boundary or changing the model. The unchanged ten-case run still
fails meeting/station meanings. Extend only that harness's existing offline
model-ready/VAD check with two **actual production ASR jobs** over original,
hash-checked Japanese/English synthetic PCM. Decode before disconnecting, prepare
fresh owned workers offline, require cached/loading/ready with no downloading,
then assert sample/range/session/epoch/language/utterance/final revision identity,
transferred buffer detachment, **<=20% CER/WER**, every meaning **exactly once**,
**<2,000 ms** host recognition and zero HTTPS requests. Online fresh-worker
rounds after the first must also be cached with no downloading. No production,
model/backend/dependency/default/fixture/hash/sentence/original gate/settings or
later-stage change; complete offline streaming/interpretation is not established.

Exact command evidence (ignored local `.ralph/media-framework/` logs):

- FAIL: first `caffeinate -disu npm run test:framework:chrome:noise:learned`,
  **exit 1**, `chrome-20261008-13-noise.log`, before extension: typecheck,
  **22 port tests / 254.824791 ms**, build, **ten completed cases / 4,066 real
  WASM VAD frames / 12 FP16 WebGPU ASR jobs**. Sole failure: Japanese louder
  noise exact-three meaning gate, **9/120 = 7.5% CER**, 会議 **2**, 駅 **1**,
  other five anchors **3**. Low-noise Japanese **3/120 CER**, low/louder-noise
  English **3/66 / 4/66 WER**, all their meanings **3**. Six noise-only controls
  have zero active frames/ASR/text. Every case has zero loss/drained queue,
  exact admitted PCM/full detector coverage, maximum pending **9,700 ms**.
  Speech endpoints **711.500–1,668.600 ms**. Offline VAD control/cancel and zero
  HTTPS pass, but that original check has no actual offline speech job.
- FAIL: second/final same command, **exit 1**,
  `chrome-20261008-13-noise-offline.log`: typecheck, **22 port tests /
  266.483250 ms**, build, ten original cases plus two actual offline ASR jobs
  complete. Same sole Japanese meaning failure and all four unchanged scores/
  counts; online endpoints **687.800–1,649.100 ms**, maximum pending **9,800 ms**,
  zero loss/drained queues. All new cache/offline-ASR assertions pass.
- PASS inside that failing suite: actual offline Japanese **111,556 samples /
  0–6,972.25 ms / 1/40 = 2.5% CER**, English **106,664 samples / 0–6,666.5 ms /
  1/22 = 4.545455% WER**, every meaning exactly **1**. Worker inference/host
  recognition **880.400/882.100 ms** Japanese, **732.700/734.000 ms** English.
  Epoch **5**, authoritative metadata, transferred buffer **0 bytes**, both
  repositories **cached/cached/loading/ready**, no download, **zero HTTPS**.
  Offline VAD probability **0.012012064**, **8.700 ms**, retained **2,048-byte**
  caller PCM and `VAD stopped` cancellation. Short decoded jobs, no live media,
  offline speech VAD/segmentation, translation or DOM. Source hashes/ranges and
  per-case latency/queue/RSS are preserved in the report.
- PASS: explicit Python assertions over recorded results, **exit 0**, tool
  output: all ten input hashes, every detector probability/sample position,
  scores and meaning counts match the first run. Analysis only, no inference
  rerun. A metadata grep printed an overly large aggregate JSON, **exit 0**;
  scalar extraction provides the useful evidence. Not an acceptance failure.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-13-stage-acceptance.log`: missing B5 full selected-video PCM
  → ASR → Korean translation → DOM script. No substitute/placeholder/retry.
- PASS: `node --check tests/framework-chrome-noise.mjs`, targeted Biome
  **one file / 19 ms / no findings**, preliminary whitespace, **exit 0**.
  Final repository/document-inclusive checks follow. The only post-browser
  source edit is a comment/scope label describing offline coverage.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked Transformers.js
**4.3.0**/ORT unchanged. Each of two invocations downloads one fresh inventory of
unchanged pinned small FP16 WebGPU ASR **487,960,440 bytes / seven files** and
Silero WASM **2,243,022 bytes / one file**, then cached fresh workers; model IDs/
revisions in the report. First/second initial preparation **55,427.402083 /
52,951.998459 ms**; cached online ranges **1,219.166667–1,521.696875 /
1,218.148000–1,321.839041 ms**. Both have **16 pinned paths** and empty page
errors/visibility events. First/second owned-tree RSS baseline **1,292,272 /
1,311,264 KiB**, case peak **3,761,216 / 3,885,920 KiB**. Every 250 ms the test
sums only its owned browser/renderers/GPU tree, including preparation, shared
pages, allocators/models/harness PCM. Not isolated memory/leaks/pressure/mobile.

**Next remains B2:** improve louder-noise Japanese meeting/station recognition
without weakening gates; qualify no-pause/quiet phoneme boundaries, natural
speakers/noise, sustained learned live queue/GPU recovery, memory/storage,
conversion/distribution licensing and select a default from passing comparison.
Two short cached offline recognition jobs pass; full offline learned streaming/
interpretation, Korean translation/revisions/DOM, ten-minute live captions,
B3–B6, installation and Safari/iPhone remain unverified. Other noise/candidate/
stream/sustained/VAD/B1/EOF/quiet/live commands are not rerun; earlier evidence
remains historical. B2–B6 remain unchecked; no stage/framework/iPhone claim.
No required environment/device/permission is absent; this is failed quality/
incomplete implementation, so neither marker applies. No third unchanged quality
retry follows the second independent Japanese failure.

Supplied instructions/plan/architecture/prior report read; root/nested AGENTS.md
and requested independent runner file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent. Only this worktree
changes; companion/install/native messaging/server/settings and unrelated
files/apps/recordings/mounted images preserved. No agents, runner edits, stage
advance, push/publish/app installation or browser/profile/permission bypass.
Only owned test browsers/profiles cleaned up. Commit scope: noise harness,
report and plan. Credentials/weights/user audio/transcripts/ignored temporary
`.ralph` state excluded. Final required verification and commit checks follow.


Final required verification and commit checks:

- PASS: `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-13-verify.log`: Biome **115 files / 51 ms**, Ruff/typecheck,
  unchanged companion build **28 main / 10 content modules**, **113 JS passed /
  0 failed/skipped/cancelled / 21,577.451375 ms**, **222 Python passed / 66.91 s**,
  Python **3.12.15**. Runs after both actual browser invocations; subsequent
  edits only complete Markdown evidence. Japanese noisy meaning and required
  full Chrome acceptance still fail as recorded; B2–B6 stay unchecked.
- PASS: final document-inclusive unstaged/staged `git diff --check`, exact
  three-file commit scope and post-commit worktree cleanliness checked before
  delivery. Only noise harness, report and plan are committed.


### 2026-10-08 / chrome / iteration 14/20 — B2 sustained learned qualification

Related commit: `test: qualify sustained learned browser ASR`, containing this
entry and the [Chrome report](docs/verification/media-framework/chrome.md).
**B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Assumption: earlier sustained energy-detector evidence does not qualify longer
learned-VAD processing. Extend the existing EOF harness with
`test:framework:chrome:sustained:learned`, retaining all ten original EOF cases,
then adding five periods and >=two minutes per language. Reuse unchanged,
hash-checked decoded synthetic PCM with no extra interperiod gaps; production
models/segmentation/queue limits/dependencies/settings/fixtures remain unchanged.
Keep every original accuracy, exact meaning-count, per-endpoint latency,
coverage, sample identity, loss, queue, cache, remote-path and lifetime gate.
New assertions require input exceeding the complete queue budget, inference/
delivery overlap, minute queue observations and start/60/120-second RSS samples.
No beam-search fix: installed generation still has an unimplemented beam branch.

Exact command evidence (ignored local `.ralph/media-framework/` logs):

- PASS: `caffeinate -disu npm run test:framework:chrome:sustained:learned`,
  **exit 0**, once, `chrome-20261008-14-sustained-learned.log`: typecheck,
  **22 port tests / 257.540292 ms**, build, **14 real cases / 16,440 WASM VAD
  frames / 46 FP16 WebGPU ASR jobs**, all retained/new gates pass. Ten retained
  EOF cases: Japanese **3/120 = 2.5% CER**, English **3/66 = 4.545455% WER**,
  every meaning exactly three, endpoints **904.500–1,470.500 ms**.
- New five-period Japanese/English: **5/200 CER / 5/110 WER**, every meaning
  **5**, three jobs each, endpoints **1,306.700–1,472.100 /
  1,071.500–1,427.000 ms**, peak pending **13,261.1875 / 12,568 ms**.
- New sustained Japanese **18 periods / 2,009,031 samples / 125,564.4375 ms**:
  **18/720 = 2.5% CER**, every meaning **18**, ten jobs, endpoint latency
  **837.000–1,643.800 ms**, max pending **15,636 ms**. English **19 periods /
  2,027,639 samples / 126,727.4375 ms**: **19/418 = 4.545455% WER**, every
  meaning **19**, ten jobs, endpoints **915.100–1,695.300 ms**, max pending
  **18,092 ms**. Every long nonfinal job overlaps paced delivery. Both actual
  host durations exceed input duration; minute queues have zero loss and drain.
- All 14: **32 ms leading / zero trailing**, no original tail omission, exact
  contiguous admitted PCM, complete detector coverage, zero reported loss/
  final pending. Report retains exact long boundaries, hashes, minute queues,
  memory samples and preparation/model/environment details. Real paced decoded
  synthetic recognition, not sustained live input/natural noise/translation/DOM.
- PASS: recorded-result Python assertions, **exit 0**, tool output, confirm all
  14 score/meaning/latency/coverage/queue checks and every long nonfinal overlap.
  All ten retained PCM/period hashes, scores/counts and every VAD probability/
  activity/sample position match iteration 12. Analysis only, no inference rerun.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-14-stage-acceptance.log`: missing full B5 selected-video PCM
  → ASR → Korean translation → DOM script. No substitute/retry/weakening.
- PASS: `node --check tests/framework-chrome-eof.mjs`, targeted Biome **one file /
  6 ms / no findings**, preliminary whitespace, **exit 0**. Final verify follows.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**; unchanged locked
Transformers.js **4.3.0** / ORT / small FP16 WebGPU ASR **487,960,440 bytes** /
Silero WASM **2,243,022 bytes**. One fresh inventory each then cached workers;
initial preparation **52,330.776833 ms**, cached **1,218.948458–1,437.474166 ms**,
**16 pinned paths**, no page errors/native visibility events. Owned-tree baseline
RSS **1,300,592 KiB**, case peak **3,872,176 KiB**. 250 ms process-tree samples
include preparation/shared pages/renderers/GPU/allocators/models/harness PCM;
not isolated memory, leaks, pressure or mobile evidence. Per-case and minute
measurements are copied into the report; document and worker latency clocks
are kept separate, with no cross-context timestamp subtraction.

**Next remains B2:** retained louder-noise Japanese meaning failure, no-pause/
quiet phoneme boundaries, natural speakers/noise, sustained learned live queue/
GPU recovery, memory/storage pressure, conversion/distribution licensing and
passing default comparison. Noise suite is not rerun; iteration 13's two quality
failures remain. Other candidate/stream/live/quiet/VAD/B1 evidence stays historical.
Full offline learned streaming/interpretation, Korean translation/revisions/DOM,
ten-minute live captions, B3–B6, installation and Safari/iPhone remain unverified.
B2–B6 stay unchecked. No required device/environment/permission is absent;
incomplete qualification/implementation warrants neither terminal marker.

Instructions/plan/architecture/prior report read; root/nested AGENTS.md and the
requested independent runner evidence are absent. Only this worktree changes;
companion/install/native messaging/server/settings and unrelated files/apps/
recordings/mounted images preserved. No agents, runner edit, stage advance,
push/publish/app installation or browser/profile/permission bypass. Owned test
browsers/profiles cleaned up. Commit scope: EOF harness, package command, report,
plan. Credentials/weights/user data/ignored temporary state excluded. Final
verification, whitespace and commit cleanliness checks follow.


Final required verification:

- PASS: `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-14-verify.log`: Biome **115 files / 61 ms**, Ruff/typecheck,
  unchanged companion **28 main / 10 content modules**, **113 JS passed /
  0 failed/skipped/cancelled / 21,016.428500 ms**, **222 Python passed / 66.87 s**,
  Python **3.12.15**. Runs after the actual browser/model suite; later changes
  complete Markdown evidence only. Required full Chrome acceptance remains
  missing, and historical Japanese noise meaning failures remain failures.
  B2–B6 stay unchecked.
- Final document-inclusive unstaged/staged whitespace, exact four-file commit
  scope and post-commit worktree cleanliness are checked before delivery.
  Only EOF harness, package command, report and plan are committed.


### 2026-10-08 / chrome / iteration 15/20

Related commit: this record is included in `test: expose sustained learned live ASR failures`.
**B2 remains unchecked; no default is selected.** Only the next unfinished Chrome
item B2 advances. Assumption: paced decoded two-minute qualification cannot prove
sustained selected-element acquisition. Extend the existing learned live harness
with `test:framework:chrome:live:sustained:learned`, retaining six original rounds
and adding >=120 seconds of actual selected-video PCM per language, **18 Japanese /
19 English periods**. Generate longer owned synthetic test videos from complete
original decoded 48 kHz periods, including carriers; re-encoded media stays ignored.
Real video playback feeds production input/normalizer/VAD/ASR, with labels used
only for scoring. No production model/profile/dependency/settings/default change.

Retain all original gates and require actual sustained duration, capture/inference
overlap in all but at most one job, every-minute queue observations, start/60/120 s
RSS and **<2,000 ms per endpoint**. Keep <=20% CER/WER, every meaning exactly the
period count, <=100 ms leading/<20 ms trailing context, <=20 s jobs/<=30 s pending,
zero reported loss/drain, exact admitted ASR slices, complete detector coverage,
<10% detector cost, source isolation/mapping/playback/Stop/restart/cached workers.
This is synthetic sustained ASR, not natural speech/noise or Korean captions.

Exact evidence in ignored `.ralph/media-framework/`:

- FAIL: first `caffeinate -disu npm run test:framework:chrome:live:sustained:learned`,
  **exit 1**, `chrome-20261008-15-sustained-live-first.log`: typecheck/**27 tests /
  259.018709 ms**/build, six original rounds and sustained Japanese pass.
  Japanese **2,009,088 normalized samples / 18/720 = 2.5% CER / every meaning 18 /
  ten jobs / endpoints 809.300–1,676.600 ms / peak pending 15,604.6875 ms**,
  zero loss/drained. English returns ten jobs over **2,027,520 samples**, then
  fails playback equality before its scoring/coverage assertions. Both generated
  videos naturally end/paused at **127.633601 / 127.600929 s**. The one-second
  media margin is shorter than result/capture-detach observation. This new fixture
  defect is corrected by extending only the uncollected suffix to five seconds;
  capture stop positions, periods and every gate remain unchanged. Second run follows.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-15-stage-acceptance.log`: missing full B5 video → ASR → Korean
  translation → DOM script. No placeholder/substitute/acceptance weakening.
- PASS: script syntax, targeted Biome **two files / 25 ms / no findings** and
  preliminary whitespace, **exit 0**. Three initial informational template-style
  findings (lint exit 0) are corrected before the first browser invocation.

Corrected browser evidence, remaining B2 scope and required final verify/Git
checks are recorded below after execution; no checkbox is changed.


Corrected real-browser evidence:

- FAIL: second/final `caffeinate -disu npm run test:framework:chrome:live:sustained:learned`,
  **exit 1**, `chrome-20261008-15-sustained-live-final.log`: typecheck/**27 tests /
  271.912458 ms**/build, **eight real rounds / 9,844 WASM VAD frames / 32 FP16
  WebGPU ASR jobs**. Six original rounds and sustained English pass. Exactly two
  retained Japanese failures: **駅 19 instead of 18**, and an endpoint
  **2,099.400 ms** instead of <2,000 ms. No third browser invocation.
- Japanese actual raw/normalized **6,027,264 / 2,009,088 samples**, capture/document
  **125,568 / 127,025.500 ms**, **34/720 = 4.722222% CER**, other meanings 18,
  fifteen jobs/fourteen overlaps, endpoints **764.700–2,099.400 ms**, pending
  peak **18,271.375 ms**. Failed job **63,648–79,808 ms** is 16,160 ms, not a
  forced maximum; host call **1,843.300 ms**. Passing final-packet latency
  **1,464.900 ms** does not override the endpoint failure.
- English **6,082,560 / 2,027,520 samples**, **126,720 / 127,796.500 ms**,
  **19/418 = 4.545455% WER**, all meanings 19, ten jobs/nine overlaps, endpoints
  **1,078.100–1,494.800 ms**, peak pending **14,826 ms**; all new gates pass.
- Both long runs: exact admitted PCM, complete detector coverage/contiguous ASR
  ranges, **32 ms leading / zero trailing**, bounded jobs/queues, zero reported
  loss/drained, original advancing playback and capture detach. Maximum mapping
  **59.063667 / 48.230333 ms**, VAD totals **2,426.500 / 2,502.500 ms**, below 10%.
  Case baseline/peak/final RSS KiB **2576096/2580464/1646640 /
  2752752/2753600/1656096**. Report retains exact boundaries, minute queues,
  hashes, RSS start/60/120 s and sampling/clock/interpretation limits.
- Original scored rounds retain **1/40, 1/40, 3/120 CER / 1/22, 3/66 WER**,
  every meaning once/three times, **826.200–1,068.700 ms** last-packet latency,
  zero loss/drain. Stop explicitly discards **863.375 ms**, cancelled/no text,
  zero pending; capture detach/restart and both-video playback preservation pass.
- PASS: recorded-result Python assertions, **exit 0**, tool output: all accounting/
  coverage/playback/cache checks, every long nonfinal overlap, exactly two Japanese
  qualification failures and generated-media hashes/bytes. Both invocations' source
  period hashes/sample/repeat counts match; only requested suffix grows by 4,000 ms.
  Re-recorded/re-captured waveforms are not asserted byte-identical, and no causal
  attribution to suffix/segmentation/codec is established. Analysis only, no rerun.
- PASS: final script syntax, targeted Biome **two files / 32 ms / no findings**
  and preliminary document-inclusive whitespace, **exit 0**.

Same owned Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked Transformers.js **4.3.0** /
ORT / small FP16 WebGPU **487,960,440 bytes** / Silero WASM **2,243,022 bytes**.
One fresh inventory each per invocation, then cached workers; two inventories
of each candidate total, no new model. Final preparation **53,753.264792 ms**,
cached **1,223.167041–1,627.839250 ms**, **16 pinned paths/requests**,
page errors/native visibility events `[]`. Final initial RSS **1,440,608 KiB**,
case peak **3,900,432 KiB**, 250 ms owned-tree sampling after preparation for
case peaks, shared pages/renderers/GPU/allocators/models/harness included; not
isolated allocations, preparation peak, leaks, memory/storage pressure or mobile
performance. Media is new synthetic VP8/Opus from the unchanged original periods;
all generated files/captured PCM remain ignored, with source/file hashes in report.

**Next B2:** new sustained Japanese station repetition/endpoint failures, retained
louder-noise Japanese meaning failure, no-pause/quiet phoneme boundaries, natural
speakers/noise, sustained learned live GPU/pressure recovery, ten-minute live input,
memory/storage, conversion/distribution licensing and default selection. No original
noise/full-candidate/stream/EOF/quiet/paced-sustained/VAD/B1 reruns; historical
passes/failures preserved. Offline learned streaming/full interpretation, Korean
translation/revisions/DOM, B3–B6, installation and Safari/iPhone remain unverified.
B2–B6 stay unchecked; no required device/environment/permission is absent and
neither terminal marker applies. No stage/framework/iPhone completion claim.

Instructions/plan/architecture/prior report read; root/nested AGENTS.md and requested
independent runner evidence absent. Only this worktree changes; companion/install/
native messaging/server/settings and unrelated files/apps/recordings/mounted images
preserved. No agents, runner edit, stage advance, push/publish/app installation or
blocked-browser/profile/permission bypass. Only owned test browser/profile/recorder
resources cleaned up. Credentials/weights/user data/ignored temporary state excluded.
Final required verify and five-file commit/whitespace/cleanliness checks follow.


Final required verification:

- PASS: `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-15-verify.log`: Biome **115 files / 57 ms / no findings**, Ruff,
  typecheck, unchanged companion **28 main / 10 content modules**,
  **113 JS passed / 0 failed/skipped/cancelled / 21,180.684167 ms**,
  **222 Python passed / 66.91 s**, Python **3.12.15**. Runs after both browser
  invocations; later changes finish Markdown evidence only. Does not override
  retained Japanese sustained meaning/endpoint failures or missing full Chrome
  acceptance. B2–B6 remain unchecked.
- Final document-inclusive unstaged/staged whitespace, exact five-file scope and
  post-commit worktree cleanliness are checked before delivery. Only package
  command, learned live harness, shared fixture, report and plan are committed;
  credentials/weights/user data/ignored temporary state and generated media excluded.


### 2026-10-08 / chrome / iteration 16/20

Related commit: this record is included in `test: qualify learned live GPU recovery`.
**B2 remains unchecked; no default is selected.** Extend only B2's existing learned
live harness with `test:framework:chrome:live:gpu-recovery`: retain six original
rounds, inject actual runtime GPUDevice destruction after the production handler
enters recognition, then require explicit same-host cached Prepare and fresh-epoch
three-period Japanese/English recognition. Require failure before capture EOF,
detached input, no stale text, positive discarded duration/zero pending, no
automatic worker/retry/fallback and no remote recovery fetch. Keep all existing
quality/meaning/PCM/isolation/mapping/playback/queue/latency gates. Fix only the
test's stale completion timestamp on failure; no engine/model/settings change.

Exact passing/failing/unverified evidence in stage report and ignored
`.ralph/media-framework/`:

- Diagnostic first `caffeinate -disu npm run test:framework:chrome:live:gpu-recovery`,
  **exit 0**, `chrome-20261008-16-live-gpu-first.log`: typecheck, **27 tests /
  253.235375 ms**, build, ten rounds, original checks and both cached recoveries
  pass. Its one-period loss jobs end at capture EOF **7,040 / 6,741.3125 ms**;
  do not count it as active-acquisition loss acceptance. Strengthen loss captures
  to three periods and assert nonfinal failed job and pre-EOF failure for the
  second invocation. All original cases/gates retained.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-16-stage-acceptance.log`, missing B5 full video → ASR → Korean
  translation → DOM script. No placeholder or substitute.
- PASS: harness syntax, targeted two-file Biome **7 / 33 ms / no findings**,
  and preliminary whitespace, **exit 0**.


Corrected final browser acceptance:

- PASS: second/final `caffeinate -disu npm run test:framework:chrome:live:gpu-recovery`,
  **exit 0**, `chrome-20261008-16-live-gpu-final.log`: typecheck, **27 tests /
  265.590417 ms**, build, **ten rounds / 4,074 VAD frames / 13 ASR invocations**,
  with two intentionally interrupted actual GPU jobs. No third invocation.
- Active Japanese/English loss: normalized **242,336 / 185,675 samples**,
  captured **15,146 / 11,604.6875 ms**, failed jobs **64–14,720 / 32–11,168 ms**,
  before their three-period capture endpoints. Acquisition advances during both
  interrupted host calls. `gpu-lost`, no text, explicitly discarded retained
  **15,039.375 / 11,530 ms**, zero pending, detached capture/preserved playback.
  Final capture includes a closing read after invalidation, not all retained
  queue audio. No automatic workers; unprepared retries reject `gpu-lost` with
  **6,400 bytes** still caller-owned.
- Explicit same-ASR/same-VAD Prepare alone creates two fresh workers and restores
  both cached models with **zero remote requests**. Recoveries keep session/target
  and use epoch 1: Japanese **3/120 = 2.5% CER**, English **3/66 = 4.545455% WER**,
  every meaning three times, exact PCM/full coverage, bounded contiguous jobs,
  zero normal loss/drained queues. Last-packet latency **1,033.400 / 850.800 ms**,
  pending peak **13,364.6875 / 12,511.375 ms**. Isolation/mapping/playback/detach
  and all original quality/Stop/restart checks pass. Report retains exact ranges,
  failure/recovery sample counts, clocks, model identities, RSS and limitations.
- Original scored rounds retain Japanese **1/40, 1/40, 3/120 CER**, English
  **1/22, 3/66 WER**, exact meaning counts and **822.600–1,046.400 ms**
  final-packet latency. Page errors/native visibility/failures `[]`.
- PASS: explicit Python recorded-result assertions, **exit 0**, ten-round and
  real-loss/retry/fresh-epoch cached recovery accounting; analysis only.

Same owned Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**/npm **11.12.1**/uv **0.12.23**, locked Transformers.js **4.3.0**/ORT
and pinned small FP16 **487,960,440 bytes** / Silero **2,243,022 bytes**.
One fresh inventory each per invocation, cached workers thereafter; two runs,
no new model. Final first preparation **52,836.562833 ms**, cached
**1,319.075125–1,426.429208 ms**, **16 pinned paths/requests** overall.
Owned-tree initial RSS **1,449,744 KiB**, maximum case peak **3,895,200 KiB**,
250 ms sampling with shared-page/browser/GPU/allocator/harness inclusion; not
isolated model memory, leak/pressure/storage/mobile evidence.

**Next B2:** historical Japanese louder-noise meaning and sustained repetition/
endpoint failures, natural/no-pause/quiet phoneme boundaries, sustained learned
live GPU recovery, ten-minute live input, memory/storage pressure, licensing and
default choice. This pass is short live recovery, not those qualifications.
Previous suites are not rerun/reclassified. Korean translation/revisions/DOM,
full offline interpretation, B3–B6, installation and Safari/iPhone remain unverified.
No checkbox changes. Required environment/device/permission is present; neither
terminal marker applies. No stage/framework/iPhone completion claim.

Instructions/plan/architecture/prior report reviewed; root/nested AGENTS.md and
requested independent runner evidence absent. Only this worktree changes;
companion/install/native messaging/server/settings and unrelated files/apps/
recordings/mounted images preserved. No agents, runner changes, stage advance,
push/publish/app installation or browser/profile/permission bypass. Only owned
test browsers/profiles cleaned up; credentials/weights/user audio/transcripts/
ignored temporary state excluded. Required final verify and commit checks follow.


Final required verification:

- PASS: `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-16-verify.log`: Biome **115 files / 53 ms**, Ruff/typecheck,
  unchanged companion **28 main / 10 content modules**, **113 JS passed /
  0 failed/skipped/cancelled / 21,566.812833 ms**, **222 Python passed / 66.95 s**,
  Python **3.12.15**. Runs after both browser invocations on final test sources;
  later changes complete Markdown evidence only. Full Chrome acceptance remains
  FAIL and historical Japanese quality failures remain unresolved. B2–B6 unchecked.
- PASS: final syntax, targeted two-file Biome **7 ms / no findings**,
  same-target/session/epoch cache/quality recorded-result assertions for both runs,
  capture advance during interrupted jobs in the corrected run only, **exit 0**.
  First diagnostic is still insufficient active-loss evidence; analysis is not
  another inference invocation.
- Document-inclusive unstaged/staged whitespace, exact five-file commit scope
  and post-commit worktree cleanliness are checked before delivery. Only package
  command, learned live harness, shared test fixture, report and plan committed;
  credentials/weights/user data/ignored temporary state excluded.


### 2026-10-08 / chrome / iteration 17/20

Related commit: this record is included in `test: exercise sustained live GPU recovery`.
**B2 remains unchecked; no default is selected.** Extend the existing live GPU
harness with `test:framework:chrome:live:sustained:gpu-recovery`: retain six original
rounds, destroy the actual GPUDevice inside the production recognition handler
only after a job reaches 60 seconds of selected-video PCM, preserve earlier
revisions while rejecting the interrupted job, and require detached input,
explicit loss/drained queue, rejected intact-buffer retry/no automatic workers.
Explicit same-host cached Prepare alone must create two workers and restore
same-session/target fresh-epoch Japanese/English recognition over at least two
minutes each. All original meaning/error/latency/PCM/coverage/isolation/mapping/
playback/queue gates remain. No production/model/dependency/settings changes.

Initial evidence:

- PASS: script syntax, repository-defined targeted Biome lint **two files / 10 ms /
  no findings**, and preliminary whitespace, exit 0.
- FAIL: exploratory full Biome check **13 ms / three pre-existing formatting/import
  errors**, exit 1; formatting-disabled check isolates existing import organization
  **8 ms / one error**, exit 1. No unrelated rewrite. Prescribed lint passes.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `.ralph/media-framework/chrome-20261008-17-stage-acceptance.log`: missing full B5
  video → ASR → Korean translation → DOM script. No placeholder or substitute.

Exact browser results and final verify/Git evidence follow after execution in
this log and `docs/verification/media-framework/chrome.md`. Existing failures and
all unfinished checkboxes remain preserved.


Actual browser acceptance:

- PASS: `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery`,
  exit 0, once, `chrome-20261008-17-sustained-gpu.log`: typecheck, **27 tests /
  0 failed/skipped/cancelled / 260.784250 ms**, build, **ten rounds / 13,888 recorded
  VAD frames / 39 real ASR calls**, with two intentionally destroyed GPU jobs.
  Qualification failures/page errors/native visibility events `[]`. No second run.
- Japanese/English loss: actual capture **67,754 / 61,823.375 ms**, document
  **67,743 / 61,810.300 ms**; six/four earlier revisions preserved, interrupted
  jobs **58,880–67,328 / 48,064–61,408 ms** publish none. Acquisition advances
  during both interrupted calls. Explicit retained loss **8,831.375 / 13,716.6875 ms**,
  pending zero, input detached and original advancing playback preserved. Closing
  capture reads are not all retained audio. Unprepared retries reject `gpu-lost`,
  **6,400 bytes** intact, zero workers/additional revisions/remote requests.
- Explicit cached same-host Prepare alone creates two fresh workers per recovery,
  **1,427.981375 / 1,532.394667 ms**, zero remote requests, same session/target,
  epoch 1 on every revision. Recovered raw/normalized samples
  **6,027,264/2,009,088 / 6,082,560/2,027,520**, capture
  **125,568 / 126,720 ms**. Japanese **18/720 = 2.5% CER**, every meaning 18;
  English **19/418 = 4.545455% WER**, every meaning 19. Ten jobs/nine capture
  overlaps each. Endpoints **1,351.600–1,742.500 / 1,137.400–1,562.300 ms**,
  final packets **1,353.100 / 1,139.700 ms**, pending peaks
  **16,436.6875 / 14,922 ms**, zero loss/drained queues. Exact PCM/full detector
  coverage/contiguous bounded jobs, 32 ms leading/zero trailing, <10% VAD cost,
  isolation/mapping/playback/detach all pass. Report retains boundaries, minute
  queues, loss/recovery RSS/clocks, sample/hash and model identities/limitations.
- Original rounds retain **1/40, 1/40, 3/120 CER / 1/22, 3/66 WER**, every
  meaning once/three times, **816.800–1,046.000 ms** final-packet latency,
  zero normal loss/drain. Actual Stop/discard **831.375 ms**, no text/pending,
  capture detach and restart pass.
- PASS: recorded-result Python assertions, exit 0: ten rounds, loss/retry/accounting,
  cached fresh-epoch sustained quality/latency, generated hashes/bytes. The browser
  script was parsed before the original strict **>1,600** loss-job comparison was
  restored from provisional >=1,600; analysis explicitly reruns the stricter gate
  on every actual loss job. No final gate relaxation/inference change or rerun.
- PASS: final syntax, targeted repository lint **two files / 37 ms / no findings**,
  preliminary document-inclusive whitespace, exit 0.

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**; same locked Transformers.js **4.3.0**/
ORT and pinned small FP16 **487,960,440 bytes** / Silero **2,243,022 bytes**.
One fresh inventory each, cached workers thereafter, no new candidate. Initial
Prepare **56,099.940417 ms**, cached **1,222.085417–1,532.394667 ms**,
**16 pinned paths/requests**. Initial owned-tree RSS **1,441,424 KiB**, maximum
case peak **3,814,208 KiB**. 250 ms process-tree RSS includes shared pages,
renderers/GPU/allocators/models/harness; case peaks start after Prepare. Not
isolated memory, leak/pressure/storage/mobile/thermal evidence. New generated
synthetic videos/source periods/hashes/bytes are detailed in the report and stay
ignored; no claim of byte-identical re-recording or causal resolution of earlier
Japanese failures.

**Next B2:** historical Japanese louder-noise meaning and sustained repetition/
endpoint failures, natural/no-pause/quiet phoneme boundaries, ten-minute live
input, memory/storage pressure, licensing and default selection. One controlled
sustained injected-loss/recovery pass does not establish repeatability/natural
pressure or erase historical failures. Earlier suites are not rerun/reclassified.
Offline full streaming/interpretation, Korean translation/revisions/DOM, B3–B6,
installation and Safari/iPhone remain unverified. Full Chrome acceptance still
FAILS (missing script). All unfinished checkboxes preserved; no absent required
environment/device/permission and neither terminal marker applies.

Supplied instructions/plan/architecture/prior report reviewed; root/nested AGENTS.md
and requested independent runner evidence absent. Only this worktree changes;
companion/install/native messaging/server/settings and unrelated files/apps/
recordings/mounted images preserved. No agents/runner changes/stage advance/
push/publish/app installation or browser/profile/permission bypass. Only owned
browser/profile/recorder resources cleaned up. Credentials/weights/user audio/
transcripts/ignored temporary state excluded. Final verify and Git checks follow.


Final required verification:

- PASS: `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-17-verify.log`: Biome **115 files / 52 ms / no findings**,
  Ruff/typecheck, unchanged companion **28 main / 10 content modules**,
  **113 JS passed / 0 failed/skipped/cancelled / 21,023.033625 ms**,
  **222 Python passed / 66.93 s**, Python **3.12.15**. Runs after the sole browser
  invocation on final test sources; later edits only finish Markdown evidence.
  Full Chrome acceptance remains FAIL, historical Japanese quality failures
  remain unresolved, B2–B6 remain unchecked.
- PASS: explicit exact four-file scope, every plan checkbox unchanged,
  document-inclusive unstaged whitespace assertions, final script syntax and
  prescribed targeted Biome lint, exit 0. Staged whitespace, four-file commit
  scope and post-commit clean worktree checked before delivery. Only package
  command/live harness/report/plan committed; credentials/weights/user data/
  generated media/profiles/ignored temporary state excluded.


### 2026-10-08 / chrome / iteration 18/20

관련 commit: 이 기록을 포함한 `feat: evaluate turbo browser ASR noise profile`.

수행한 변경: B2의 기존 small FP16 일본어 louder-noise 의미 실패에 대해,
segmentation을 추측으로 수정하기 전에 pinned Whisper large-v3-turbo FP16 후보를
기존 repository/worker에 명시적으로 등록하고 전체 learned-noise/offline harness로
비교한다. 새 `test:framework:chrome:noise:turbo`만 후보를 선택한다. 원래 명령,
열 가지 fixture와 hash, 정확도/의미/지연/큐/손실/노이즈 거부 기준은 유지한다.
후보 identity/byte 검증과 WASM 거부·후보 전달·다른 모델 readiness 거부 transport
검증을 추가했다. 기본 모델·production policy·dependency·기존 사용자 설정은 불변.

실행한 명령과 결과:

- PASS: focused model/ASR/VAD/speech ports, exit 0, **30 passed / 0 failed/skipped/
  cancelled / 267.951292 ms**, `chrome-20261008-18-ports.log`; fake evidence only.
- PASS: syntax, registered byte sum **1,621,338,971**, five-file Biome lint
  **23 ms / no findings**, preliminary whitespace, exit 0.
- FAIL: `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-18-stage-acceptance.log`, missing script. No replacement.
- Model discovery HTTP/accessibility outcomes, pinned identity, unchanged gates,
  actual browser results and final required verification are recorded in
  `docs/verification/media-framework/chrome.md` iteration 18.

실제 모델 실행 결과와 최종 verify/Git 증거는 실행 후 아래에 추가한다.
B2–B6 체크박스는 아직 유지하며 다른 stage로 진행하지 않는다.


실제 브라우저 결과:

- FAIL: `caffeinate -disu npm run test:framework:chrome:noise:turbo`, exit 1,
  **한 번만 실행**, `chrome-20261008-18-turbo-noise.log`: typecheck, **30 port
  passed / 259.001834 ms**, build, **10 online cases / 4,066 WASM VAD frames /
  12 online + 2 offline FP16 WebGPU ASR jobs**. 모든 의미/정확도 기준과 six
  noise-only 거부는 통과하지만 일본어 첫 endpoint **2,384.200 / 2,009.100 ms**가
  기존 <2,000 ms 기준 실패. 뒤 일본어 endpoints와 영어 endpoints는 기준 통과.
  queue loss zero/final pending zero, page errors/native visibility events `[]`.
- 일본어 quiet/louder 각각 **3/120 CER**, 모든 의미 3회. 영어 각각 **3/66 WER**,
  모든 의미 3회. 실제 job hashes/ranges/sample counts 열두 개와 입력 hash 열 개,
  detector active counts가 iteration 13 small FP16 결과와 일치함을 Python으로
  확인(PASS/exit 0). 기존 louder 일본어 **9/120, 회의 2/역 1 → turbo 3/120,
  모든 의미 3**. 과거 small 실패를 지우거나 동시 latency 비교로 주장하지 않는다.
- PASS: cached fresh-worker offline Japanese/English, remote requests **0**,
  **1/40 CER / 1/22 WER**, 모든 의미 1회, document host **1,501.400 /
  1,200.500 ms**, transferred PCM/identity/epoch/range/final 검증 통과. Actual
  detector Stop/VAD no-speech 통과; full offline streaming/translation 증거 아님.
- 새 pinned turbo **1,621,338,971 bytes / seven files**, Silero는 기존 **2,243,022
  bytes / one file**. ONNX hashes 검증, 한 inventory씩 다운로드 후 cached workers.
  First Prepare **163,271.711250 ms**, cached **2,133.598791–2,841.023500 ms**.
  Owned browser RSS initial **1,290,912 KiB**, 최대 **6,592,704 KiB**. 250 ms
  process-tree RSS는 shared pages/GPU/allocators/preparation/harness 포함이며
  isolated model/leak/pressure/mobile 증거가 아니다. 모델/환경/수치/hash/clock과
  conversion licensing 미검증은 report에 상세 기록.
- PASS: recorded-result assertions(Python), exit 0, 정확히 두 지연 실패를 유지하며
  나머지 의미/PCM/accounting/noise/offline 결과 확인; 추가 inference 실행 아님.

다음 미완료 **B2**: turbo의 두 일본어 endpoint 지연을 원래 기준 안으로 줄이면서
의미 보존, actual live/sustained/ASR Stop/GPU recovery/pressure/broader quality와
license 검증 후 default 선택. 기존 small louder-noise와 sustained 실패 유지.
B2–B6는 unchecked; full Chrome acceptance missing script로 FAIL. B3–B6와
Safari/iPhone/설치/full offline interpretation는 미검증. 필요한 환경/권한/실기 부재가
관측된 것은 아니므로 미완성 구현/qualification에 terminal marker를 사용하지 않는다.

Companion/install/server/native messaging/user settings/unrelated apps/recordings/
mounted images 보존. Agents/runner edit/stage advance/push/publish/app installation/
blocked-browser bypass 없음. Owned test browser/profile만 정리; weights/credentials/
user data/.ralph state 제외. 최종 verify와 Git 증거는 아래에 기록한다.


최종 required verification:

- PASS: `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-18-verify.log`: Biome **115 files / 52 ms / no findings**,
  Ruff/typecheck, companion **28 main / 10 content modules**,
  **113 JS passed / 0 failed/skipped/cancelled / 21,903.350209 ms**,
  **222 Python passed / 66.91 s**, Python **3.12.15**. Sole browser invocation
  후 final implementation/test sources에서 실행; 이후 Markdown evidence만 수정.
  두 turbo 지연 실패/과거 small 실패/missing Chrome acceptance는 그대로 유지.
- PASS: exact seven-file scope, append-only report/plan, 모든 original checkbox
  unchanged, document-inclusive unstaged whitespace, exit 0. Staged whitespace/
  scope와 post-commit clean worktree는 delivery 전에 확인. Candidate registry/
  worker whitelist, transport test, existing noise harness, package command,
  report/plan만 commit; generated assets/weights/profiles/credentials/user data/
  ignored temporary state 제외.


### 2026-10-08 / chrome / iteration 19/20

관련 commit: 이 기록을 포함한 `test: qualify turbo sustained live GPU recovery`.

수행한 변경: B2의 기존 turbo FP16 후보를 production selected-video input,
live Stop during VAD, sustained repetition 및 GPU-loss/recovery 경로에서 평가하도록
기존 live harness/fixture에 opt-in candidate를 전달한다. 새
`test:framework:chrome:live:sustained:gpu-recovery:turbo`만 turbo를 선택하며 기존
명령은 small FP16을 유지한다. 모든 original/sustained scenario와 정확도/의미/
지연/PCM/queue/accounting/playback/cache/Stop/GPU 기준은 보존한다. 각 round의
pinned model identity/bytes를 검사하고 해당 후보 artifact만 허용한다. Turbo의
첫 download/load는 기존 noise harness와 같은 240 s wait, small은 원래 120 s;
<2,000 ms inference gate는 불변이다. Production policy/default/dependency/
companion/settings 변경 없음.

실행한 명령과 결과:

- PASS: live harness syntax, fixture/harness Biome lint **two files / 7 ms /
  no findings**, preliminary whitespace, exit 0.
- FAIL: `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-19-stage-acceptance.log`: missing full acceptance script.
  Korean translation/DOM을 model smoke로 대체하지 않는다.

실제 browser/모델 결과와 final verify/Git 증거는 실행 후 아래와
`docs/verification/media-framework/chrome.md` iteration 19에 기록한다.
B2–B6는 unchecked이며 다른 stage로 진행하지 않는다.


실제 browser 결과:

- FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery:turbo`,
  exit 1, **한 번만 실행**, `chrome-20261008-19-turbo-live-gpu.log`: typecheck,
  **27 port passed / 0 failed/skipped/cancelled / 256.120291 ms**, build,
  **10 completed rounds / 13,665 WASM VAD frames / 46 FP16 WebGPU ASR calls**.
  Page errors/native visibility events `[]`. 정확히 Japanese recovered 의미 수와
  endpoint 두 failure categories만 유지한다; rerun/gate relaxation 없음.
- Japanese recovered **18 periods / 125,568 ms PCM / 126,999.200 ms document**,
  **20/720 CER**; 내일 anchor **17**, 다른 six **18**. Endpoints
  **2,095.600 / 2,035.500 ms**가 unchanged <2,000 ms 기준 실패. 해당 jobs
  **32–11,648 / 49,664–60,384 ms**, submission wait **344.600 / 429.700 ms**,
  host call **1,751 / 1,605.800 ms**. Final-packet **1,432.700 ms**로 실패를
  대체하지 않는다. English **19 periods / 126,720 ms PCM / 128,224 ms document**,
  **19/418 WER**, all meanings **19**, endpoints **1,506.800–1,864 ms**, PASS.
  Jobs/capture overlaps **13/12 / 10/9**, peak pending **13,748.6875 / 15,220.6875 ms**,
  zero normal loss/final pending zero. Exact PCM/coverage/contiguous ranges/
  playback/isolation/mapping/detach pass; detailed boundaries/minute queues in report.
- PASS within failed command: Japanese/English GPU loss after normalized capture
  **60,671.375 / 61,780.6875 ms**, ten/four earlier revisions 유지,
  **56,736–60,320 / 48,064–61,376 ms** interrupted jobs publish none. Capture
  advances during both calls; explicit retained loss **3,892.6875 / 13,674 ms**,
  zero pending/detached input/advancing playback. Retry `gpu-lost`, **6,400 bytes**
  intact, zero workers/new revisions/requests. Same host/session/target explicit
  cached recovery creates two fresh workers, epoch 1, **3,254.376167 / 3,144.683875 ms**,
  zero remote requests. Interrupted partial text is not quality scored. Japanese
  loss round includes an unreferenced phrase in **42,784–44,864 ms** before loss;
  quality concern remains recorded.
- Original scored rounds PASS: Japanese **1/40, 1/40, 3/120 CER**, English
  **1/22, 3/66 WER**, meanings once/three, final packet **1,379.700–1,459 ms**,
  zero normal loss/drain. Stop during actual VAD returns cancelled/no text,
  explicit **820.6875 ms** loss/detach/zero pending; restart passes. **ASR calls 0**
  for that Stop round, so turbo user Stop during ASR remains unverified.
- Same pinned turbo **1,621,338,971 bytes / seven files**, Silero **2,243,022 /
  one file**, locked Transformers.js/ORT unchanged. First prepare **160,128.519042 ms**,
  cached **2,342.474542–3,589.680041 ms**, **16 paths / 16 requests**. Owned Chromium
  **153.0.8010.12**, macOS **26.6.2/25G83 arm64**, Node **v24.15.0**, npm **11.12.1**,
  uv **0.12.23**. Initial RSS **1,445,184 KiB**, max post-prepare case peak
  **5,142,320 KiB**; owned-tree samples include shared pages/GPU/allocators/harness
  and are not pressure/storage/leak/mobile qualification. Detailed model/clock/
  memory/source-period/generated-file hashes/bytes in report.
- PASS: Python recorded-result assertions, exit 0, exactly two Japanese categories,
  ten pinned model/byte identities, all measured lifecycle/quality/accounting
  outcomes; generated hashes/bytes/source-period/count/duration match iteration 17.
  No byte-identical live-job or simultaneous timing comparison claim. Extracted
  fixture module syntax PASS. Analysis only, no extra inference invocation.

다음 미완료 **B2**: turbo noise 및 sustained Japanese future-time/endpoint failures와
pre-loss unreferenced phrase 개선, 실제 ASR 중 user Stop/overload/quiet/no-pause/
natural data/ten-minute live/pressure/licensing 검증 후 default 선택. 이전 small
및 turbo noise 실패는 유지하고 rerun하지 않았다. Full Chrome acceptance missing
script로 FAIL; B2–B6 unchecked. Full offline interpretation/Korean translation/
revision pairing/DOM/installation/Safari/iPhone unverified. 필요한 환경/권한/실기
부재는 관측되지 않아 terminal marker 없음. Stage/framework/iPhone 완료 주장 없음.

Only this worktree changes; companion/install/native messaging/server/settings/
unrelated files/apps/recordings/mounted images 보존. Agents/runner edit/stage advance/
push/publish/app install/blocked browser bypass 없음. Only owned test resources
정리; model weights/media/credentials/user data/.ralph state 제외. Final verify/Git
증거는 아래에 기록한다.


최종 required verification:

- PASS: `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-19-verify.log`: Biome **115 files / 51 ms / no findings**,
  Ruff/typecheck, unchanged companion **28 main / 10 content modules**,
  **113 JS passed / 0 failed/skipped/cancelled / 21,593.026375 ms**,
  **222 Python passed / 66.93 s**, Python **3.12.15**. Sole actual browser 실행
  후 final implementation/test sources에서 실행; 이후 Markdown evidence만 수정.
  Japanese 의미/endpoint 실패와 missing Chrome acceptance는 그대로 유지.
- PASS: final harness/embedded fixture syntax, targeted Biome **two files / 7 ms /
  no findings**, exact five-file scope, append-only report/plan, 모든 original
  checkbox unchanged, document-inclusive unstaged whitespace, exit 0. Staged
  whitespace/scope와 post-commit clean worktree는 delivery 전에 확인. Package
  command/live harness/fixture/report/plan만 commit; models/media/profiles/
  credentials/user data/ignored temporary state/runner changes 제외.


### 2026-10-08 / chrome / iteration 20/20

Related commit: `test: qualify turbo live ASR stop and restart`, containing this
entry. Next unfinished item is **B2**; B2–B6 remain unchecked.

Changes: add opt-in `test:framework:chrome:live:asr-stop:turbo` to the existing
learned live harness/fixture. Retain six original scenarios and every original
accuracy/meaning/latency/PCM/playback/cache/queue assertion, then add Japanese and
English keyboard Stop after the actual turbo worker pipeline is invoked, followed
by explicit cached same-host/session/target restart at a fresh epoch. Passive
Stop snapshots distinguish unresolved actual ASR from iteration 19's VAD-only
Stop. Require exact job PCM, cancellation accounting, bounded/cleared queues,
detach, two seconds without late revisions, advancing original playback,
unprepared retry without transfer/new workers, and two fresh cached workers.
This extends qualification only; no production model/default/policy/dependency,
companion or existing user settings change.

Executed:

- PASS: harness and extracted fixture module syntax, targeted Biome **two files /
  8 ms / no findings**, preliminary whitespace and explicit Python check that all
  **95** original assertion lines remain (only mutual-exclusion mode list extended).
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-20-stage-acceptance.log`, missing full acceptance script.
  ASR/Stop evidence cannot replace Korean translation or DOM acceptance.

Actual browser results, final verify and remaining qualification are recorded
below and in `docs/verification/media-framework/chrome.md` iteration 20. Requested
independent runner log and root/nested AGENTS.md are absent. Only this worktree
changes; no agents, runner edits, other stages, push/publish/app installation or
browser/profile bypass. Existing apps/recordings/mounted images preserved.


Actual browser evidence:

- PASS: `caffeinate -disu npm run test:framework:chrome:live:asr-stop:turbo`,
  **exit 0**, once, `chrome-20261008-20-turbo-asr-stop.log`: typecheck,
  **27 port passed / 0 failed/skipped/cancelled / 251.934250 ms**, build,
  **ten rounds / 4,065 actual WASM VAD frames / 13 FP16 WebGPU ASR calls**,
  including two interrupted calls. Failures/page errors/native visibility `[]`.
- Both active-ASR keyboard Stop rounds PASS: Japanese normalized **240,298 samples /
  15,018.625 ms**, job **32–14,720 ms / 235,008 exact samples**, English
  **182,954 / 11,434.625 ms**, job **0–11,136 / 178,176**. Worker invocation is
  independently observed; document snapshots show one unresolved ASR/no revision.
  Stop follows submission **29.600/30.600 ms**, host cancellation settles
  **1.000/0.700 ms** later, handler cleanup **1.100/0.800 ms**. Explicit discarded
  **14,986/11,434 ms**, final pending zero, detach and no late text over two seconds.
  Both videos retain playback settings and advance **2.053286–2.064992 s**;
  cancelled speech is unscored. No next normalized packet within the short active
  call windows; no claim of acquisition overlap for those interrupted calls.
- Retry remains not ready, **6,400 bytes** retained, zero workers/revisions/remote
  requests. Explicit cached Prepare alone creates two fresh workers on same
  ASR/VAD hosts/session/selected target; all restarted revisions use epoch **1**.
  Prepare **2,633.435375/2,549.133959 ms**, no remote requests. Three-period restarts
  PASS Japanese **335,189 samples / 20,949.3125 ms / 3/120 CER** and English
  **320,853 / 20,053.3125 / 3/66 WER**, every meaning **3**, final packet
  **1,460.300/1,349.500 ms**, peak pending **13,716.6875/13,023.375 ms**, zero normal
  loss/drain. Two contiguous exact-PCM jobs each, complete detector coverage,
  leading **64/32 ms**, trailing zero, original playback/isolation/mapping/detach
  pass. First-job live acquisition overlap **1,706.6875/1,578.6875 ms**. This is
  bounded three-period evidence, not sustained endpoint/ten-minute acceptance.
- Five original scored rounds PASS Japanese **1/40, 1/40, 3/120 CER**, English
  **2/22, 3/66 WER**, all meanings once/three times, final packet
  **1,341.700–1,475.100 ms**, zero normal loss/drain. Original VAD Stop retains
  zero ASR calls, **863.375 ms** explicit loss and successful restart separately.
- Owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**, Node
  **v24.15.0**, npm **11.12.1**, uv **0.12.23**. Same pinned turbo
  **1,621,338,971 bytes/seven files** and Silero **2,243,022/one**, existing registry
  hashes/locked dependencies unchanged; **16 paths/16 requests**. First Prepare
  **159,954.829417 ms**, cached **2,442.991459–3,611.297125 ms**. Initial owned-tree
  RSS **1,441,632 KiB**, max post-prepare case peak **5,320,560 KiB**; this is
  process footprint, not GPU allocation/pressure/storage/leak/mobile evidence.
  Exact identities, clocks, per-round samples/ranges/RSS and limits in stage report.
- PASS: explicit recorded-result Python assertions and same selected-target checks,
  exit 0; analysis only, no second browser inference run. Final targeted Biome
  **two files/8 ms/no findings**, harness syntax, exit 0.

Next unfinished **B2**: retained turbo noise/sustained Japanese meaning/endpoint
failures and pre-loss unreferenced phrase, overload, quiet/no-pause/natural speakers/
noise, ten-minute live, pressure/storage/licensing before a default. Earlier
failures remain; no repeatability claim. B2–B6 unchecked; full Chrome acceptance
still FAIL (missing script), Korean translation/revisions/DOM/full offline
interpretation/install/Safari/iPhone unverified. No required environment/device/
permission is absent, so no terminal marker or stage/framework/iPhone completion.
Models/media/profiles/credentials/user data/.ralph state excluded. Final verify
and Git evidence follows.


Final required verification and Git checks:

- PASS: `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-20-verify.log`: Biome **115 files/56 ms/no findings**, Ruff,
  typecheck, unchanged companion **28 main/10 content modules**, **113 JS passed /
  0 failed/skipped/cancelled / 21,917.328333 ms**, **222 Python passed/66.87 s**,
  Python **3.12.15**. Executed after the sole actual browser invocation on final
  test sources; later edits finish Markdown evidence only. Missing full acceptance
  and earlier Japanese/noise/sustained failures remain unchanged.
- PASS: explicit exact five-file scope, append-only report/plan, unchanged every
  checkbox/existing npm command/dependency, harness/fixture syntax and targeted
  Biome, document-inclusive unstaged whitespace, exit 0. Only package command,
  existing live harness/fixture and report/plan selected for commit; models/media/
  profiles/credentials/user data/ignored state/runner changes excluded. Staged
  scope/whitespace and post-commit cleanliness checked before delivery.


### 2026-10-08 / chrome / B2 first-result latency fix

Fixed production submission delay, without another evaluation variant. The
initial job can submit after 512 ms of VAD probability <0.05, retaining 256 ms
of exact context; uncertain frames/later jobs retain the original policy.
Final existing Turbo noise suite PASS (ten cases plus cached offline ASR):
Japanese first endpoints 2,384.2→1,765.3 ms / 2,009.1→1,672.0 ms; all Japanese
endpoints <=1,912.4 ms. Both Japanese input and all job PCM hashes/ranges match
the prior failure; all repeated meanings preserved. Existing quiet-input suite
PASS, six Japanese/English gain cases, no renewed negation/meaning loss.
Full verify PASS, 114 JS / 222 Python; final focused ports PASS, 28. Failed
regression and rejected broader EOF behavior are recorded in the Chrome report.
No acceptance criteria changed. Commit: `fix: release initial browser ASR after confident silence`.

Next B2 priority: diagnose/fix the retained sustained live Japanese missing
`明日` at the 23,296 ms split (iteration 19 recovered jobs), and rerun the existing
sustained suite. Do not spend the next iteration adding another GPU/Stop variant
while that meaning failure remains unresolved. Sustained quality/later latency
has not been requalified here; no stage checkbox/default selection changed.


### 2026-10-08 / video / repair speech-fixture packet clock

`all` stopped before Chrome: V5 English waveform correlation 0.7141754816633507
failed the unchanged >0.85 gate. The generator's 60 ms Opus packets had 57/60/63 ms
English and 58/60/62 ms Japanese timestamp intervals. Retimed only audio block
metadata, preserving all codec payload, video and first offset; generation now
uses the same correction. Actual browser decoding confirms every stereo sample
bit-identical before/after. Continuous-clock regression fails before and passes
after; final Video acceptance PASS, 15 unit checks and V1–V5, six correlations 1.0.
Exact failures, rejected alignment hypothesis and proof are in the Video report.
No gate/checkbox/model/default/audio content changed. Full verification follows.
Chrome B2's next priority remains the retained sustained Japanese meaning boundary;
do not interpret this completed-video recheck repair as whole-framework completion.
Full `caffeinate -disu npm run verify` PASS: 116 JS / 222 Python (66.91 s),
lint/typecheck/build. Evidence: `video-fixture-clock-verify.log`. Final whitespace
and intended scope checks PASS. Commit: `fix: align speech fixture audio packet timestamps`.


### 2026-10-08 / chrome / iteration 1/20 — B2 failed ASR input cleanup

Related commit: `fix: close selected-video input after ASR failure`, containing
this entry. Next unfinished item is B2; all original checkboxes remain unchanged.

Performed: targeted the retained sustained Japanese meaning boundary. A proposed
64 ms confident-silence guard passed its new segmentation regression but worsened
real sustained Japanese meaning counts/CER and latency, so the guard and its new
test are reverted; recognizer and speech tests exactly match HEAD. Two independent
existing sustained runs also exposed the same missing input cleanup after GPU
failure (raw chunks **1,448 != 1,447** English, **1,663 != 1,662** Japanese).
Inspection then identified the live fixture's owned handle not being explicitly
closed before publishing ASR failure. The only retained code change awaits that
real input close in its error catch. Every original gate/window/case is unchanged;
no new evaluation mode, candidate/default, API or production decoding change.

Executed and actual evidence (ignored `.ralph/media-framework/` logs; details in
`docs/verification/media-framework/chrome.md`):

- FAIL: proposed-policy regression before its experiment, exit 1,
  `chrome-20261008-restart-1-regression-before.log`; PASS with experimental source,
  **29 ports / 315.208916 ms**, `chrome-20261008-restart-1-ports.log`. Fake
  detector/executor segmentation evidence, not accuracy; that experiment is reverted.
- FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery:turbo`,
  exit 1, once each in `chrome-20261008-restart-1-baseline.log` and
  `chrome-20261008-restart-1-final-live.log`: two independent detach failures
  above. Fresh baseline Japanese recovery also misses meaning counts (meeting/
  negation **17**, tomorrow/afternoon **16**, others **18**) and one **2,085.800 ms**
  endpoint; **45/720 = 6.25% CER**. English recovery not reached. No identical
  third attempt is made without a concrete ownership correction.
- FAIL after that correction: same sustained turbo command, exit 1, once,
  `chrome-20261008-restart-1-closed-live.log`: **ten rounds / 13,727 actual WASM
  VAD frames / 34 actual FP16 WebGPU ASR calls**. Both loss/detach/cached recovery
  paths PASS, but experimental Japanese recovery produces every meaning **16/18**,
  **111/720 = 15.416667% CER**, endpoints **1,631.700–2,156.100 ms**; guard rejected.
  English **19/418 WER**, every meaning **19**, endpoints <=**1,888.500 ms** PASS.
  Errors/visibility `[]`; no failed fixture/text/gate is removed or softened.
- PASS on final restored source and retained cleanup: `caffeinate -disu npm run
  test:framework:chrome:live:gpu-recovery`, exit 0, once,
  `chrome-20261008-restart-1-restored-gpu.log`: typecheck, **28 original ports**,
  **ten rounds / 4,077 actual WASM VAD frames / 13 actual small-FP16 WebGPU ASR
  calls**. Both GPU-loss detach, original playback, exact selected PCM/accounting/
  bounded queues, no interrupted revision, unprepared retry and explicit cached
  same-host/target/session fresh-epoch recovery PASS. Recovered Japanese **3/120
  CER**, English **3/66 WER**, every meaning **3**, zero normal loss/final pending,
  final packet **1,036.000/840.800 ms**. Bounded candidate check, not sustained
  turbo qualification or a fallback/default.
- PASS: final `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-1-restored-verify.log`: Biome **117 files/93 ms/no
  findings**, Ruff/typecheck, unchanged **28 main/10 content modules**, **116 JS /
  0 failed/skipped/cancelled / 21,879.875167 ms**, **222 Python / 66.89 s**.
  Earlier two experimental verifies also PASS **117 JS/222 Python**, with their
  retired unit test; exact durations/logs in the stage report.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-1-stage-acceptance.log`, missing full script. No
  placeholder or model/lifecycle substitution for Korean translation/DOM.
- PASS: fixture module syntax, targeted Biome and preliminary whitespace. Initial
  bounded-log summary had a `KeyError` on a sustained-only field; corrected
  analysis passes without another inference invocation. Final preservation/Git
  checks below and in the report are performed before delivery.

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. Pinned turbo/small/
Silero hashes and locked dependencies unchanged; model sizes, decoded period
hashes, RSS/clock limits and lifecycle/ASR metrics are in the report. No new
weights/candidate. Requested independent runner evidence
`2026-10-08T07-45-37-544Z-chrome-verification.txt` and root/nested AGENTS.md are absent.

Next B2: resolve sustained Japanese meaning/endpoint failures and the unreferenced
phrase with an actually passing alternative; finish natural/quiet/no-pause/noise,
overload/ten-minute/pressure/storage/licensing qualification before default
selection. Earlier noise/quiet results remain historical; final recognizer is
unchanged. B2–B6, full translation/DOM/offline/install/Safari/iPhone remain
unfinished. No required environment/device/permission is absent, so neither
terminal marker applies. Companion/settings/unrelated user resources preserved;
no agents, runner/stage changes, push/publish/install/browser bypass. Only fixture
cleanup and append-only report/plan enter the commit; ignored models/media/
profiles/credentials/user data/temporary state are excluded.


Final preservation checks PASS, exit 0: exact three-file scope; report/plan
append-only; every prior checkbox unchanged; recognizer/speech tests fully
restored; original live harness, runner, package/lock and architecture bytes
unchanged. Explicit assertions on recorded final JSON verify ten rounds,
4,077 VAD frames/13 real ASR calls, both loss counts/accounting and scored
fresh-epoch cached recoveries without another inference run. Final fixture
Biome **one file / 27 ms / no findings**, extracted module `node --check` and
unstaged `git diff --check` PASS. Only fixture cleanup/report/plan are staged;
staged scope/whitespace and post-commit clean status are checked at delivery.


### 2026-10-08 / chrome / iteration 2/20 — B2 exact live jobs and endpoint phases

Related commit: `test: trace sustained browser ASR endpoints`, containing this
entry. B2 remains the next unfinished item; no checkbox/default/stage changes.

Performed: examined the retained sustained Japanese boundary and tested retaining
64 ms of confident pause through isolated detector hits. Proposed segmentation
regression fails before (**11,520 vs 11,232 ms**), passes with the experiment
(**29 ports / 278.567667 ms**), but actual sustained Japanese has five meaning
anchors **20 instead of 18** and three endpoints >=2,000 ms. Policy and proposed
test rejected/restored; original production/regression bytes match HEAD.

Retained implementation: the existing live fixture reports each exact pre-transfer
ASR job's SHA-256, including interrupted GPU work. Existing sustained harness
reports shared-document-clock submission wait, invocation, dispatch and full
endpoint latency, checks ordered finite phases/complete sums and keeps the
original strict <2,000 ms gate. All original cases/assertions/audio/model/defaults/
commands/dependencies are preserved; no new evaluation mode or stage advance.

Executed and actual evidence (ignored `.ralph/media-framework/`; complete metrics,
environment, hashes and limitations in the Chrome stage report):

- FAIL: proposed regression before code, `chrome-20261008-restart-2-regression-before.log`,
  one failing Node test; later shell log display exit 0 is not a test pass.
- PASS: experimental 29 focused ports, `chrome-20261008-restart-2-ports.log`;
  recorded probability replay **3,924/3,923 frames**, `chrome-20261008-restart-2-trace-replay.log`.
  Fake executor/PCM evidence only, not recognition.
- FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery:turbo`,
  once experimental, exit 1, `chrome-20261008-restart-2-live.log`: ten rounds,
  **13,672 VAD frames / 37 actual FP16 WebGPU ASR calls**. Japanese **79/720 CER**,
  five anchors **20/18**, three late endpoints, max **2,214.6 ms**; English every
  anchor **19**, max **1,922.8 ms**. Lifecycle/recovery paths pass, policy rejected.
- FAIL: same existing command, once final restored production plus diagnostics,
  exit 1, `chrome-20261008-restart-2-final-live.log`: **28 original ports /
  279.572625 ms**, ten rounds, **13,770 VAD frames / 37 real ASR calls**.
  New 37 digests/20 endpoint phase observations PASS; no weakened quality gate.
  Japanese three-period **26/120 = 21.666667% CER**, five anchors **4/3** FAIL;
  sustained **73/720 CER**, five anchors **20/18**, three endpoints
  **2,012.3/2,136.5/2,147.0 ms** FAIL. English **19/418 WER**, every anchor **19**,
  max **1,893.4 ms** PASS. Selected PCM/isolation/time/playback/detach/queue/loss/
  fresh-epoch cached GPU recovery gates PASS; normal loss/final pending zero,
  recovery remote requests zero, page/visibility errors `[]`. Restored production
  also repeats extra meaning; retention is not proven as the cause.
- PASS: final `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-2-final-verify.log`: Biome **117 files / 75 ms**, Ruff/
  typecheck/build, unchanged **28 main / 10 content modules**, **116 JS /
  22,831.038917 ms**, **222 Python / 66.87 s**. Experimental verify also PASS,
  **117 JS / 21,525.54425 ms; 222 Python / 66.87 s**, earlier log in report.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-2-stage-acceptance.log`: missing full script; no substitute.
- PASS: actual generated-media hashes/sizes, recorded final JSON phase/hash/
  latency/accounting checks, syntax/two-file Biome and preliminary preservation/
  whitespace, exit 0. Final Git checks are recorded in the report and below.

Environment remains headed owned Chromium **153.0.8010.12**, macOS **26.6.2/
25G83 arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**.
Pinned turbo/Silero and source period hashes unchanged; final readiness, RSS and
same-clock limits are in the report. Root/nested AGENTS.md and requested independent
runner evidence `2026-10-08T07-45-37-544Z-chrome-verification.txt` are absent.

Next B2: resolve Japanese extra/missing meanings and late endpoints with exact
job/phase evidence; finish remaining original qualification before selecting a
default. B2–B6/translation/DOM/offline full interpretation/install/Safari/iPhone
remain unfinished; older noise/quiet/offline/ASR-Stop successes are historical.
No environment/device/permission blocker, so neither terminal marker applies.
Only existing harness/fixture and append-only report/plan are committed; original
production/tests, companion/settings/user resources, runner and all checkboxes
remain unchanged. No agents, stage advance, push/publish/install/access bypass;
ignored model/media/profile/credential/user/temporary state is excluded.


Final preservation checks PASS, exit 0: exact four-file staged scope, staged
whitespace, append-only report/plan and every prior checkbox unchanged; original
production/regression/package/lock/runner/architecture bytes preserved. Final
harness and extracted fixture syntax, two-file Biome (**21 ms / no findings**)
and document-inclusive unstaged whitespace PASS. Only diagnostics/report/plan
are staged; model/media/profile/credential/user/ignored temporary state is
excluded. The final staged whitespace and post-commit clean status are checked
at delivery. No checklist is checked on these diagnostic passes.


### 2026-10-08 / chrome / iteration 3/20 — B2 rejected short-pause start boundary

Related commit: `docs: record rejected browser ASR pause boundary`, containing
this entry. B2 remains next unfinished; no default/checkbox/stage changes.

Implemented/tested: moved only qualifying <500 ms learned pauses after ten seconds
from midpoint to pause start to retain a detector-delayed word onset. A new
regression FAILS first (**11,200 vs 11,072 ms**, exit 1), then all **29 focused
ports PASS / 283.427375 ms**. Two existing expected cut positions followed the
experimental rule; all original exact PCM/EOF/coverage/loss assertions stayed.
Actual sustained qualification FAILS, so recognizer/tests and all changed
expectations are restored byte-for-byte. Only evidence documentation is retained.

Executed (ignored `.ralph/media-framework/`; exact details in Chrome report):

- FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery:turbo`,
  exit 1, once, `chrome-20261008-restart-3-live.log`: **ten rounds / 13,987 actual
  WASM VAD frames / 47 actual FP16 WebGPU ASR calls**, including two interrupted
  GPU jobs. Japanese **56/720 CER**, station **19 instead of 18** (other six 18),
  first full endpoint **2,241.8 ms** FAIL. English **19/418 WER**, every anchor
  **19**, endpoints **2,029.0/2,035.2/2,013.7 ms** FAIL. Three original aggregate
  failures; no text/gate/case removed. Five short scored rounds and GPU recovery/
  exact PCM/isolation/time/playback/queue/loss/drain/detach checks PASS; page and
  visibility errors `[]`. These passes do not override sustained quality/latency.
- PASS: final restored-source `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-3-final-verify.log`: Biome **117 files / 61 ms**, Ruff/
  typecheck/unchanged companion build, **116 JS / 22,047.025917 ms**,
  **222 Python / 66.92 s**. Experimental verify also PASS **117 JS /
  21,239.95575 ms; 222 Python / 66.83 s**, earlier log in report; policy reverted.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-3-stage-acceptance.log`: missing full-stage script.
- PASS: experimental targeted Biome/whitespace; Python analysis of all 47
  digests, scored exact PCM/accounting/visibility and 29 complete endpoint phases;
  actual generated synthetic media sizes/hashes. No new inference invocation.

Owned Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**, Node **v24.15.0**,
npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. Pinned turbo/Silero, locked
dependencies and source period hashes unchanged; readiness/RSS/timeline limits and
exact failing Japanese job identity are in the report. Requested independent
runner file and root/nested AGENTS.md are absent. Model/media/user data/credentials
and temporary `.ralph` state stay out of Git.

Next B2: resolve meaning and full endpoint failures with an actually passing
alternative; exact captured-job replay would distinguish segmentation from
regenerated-input variability. Finish original remaining qualification before
default selection. B2–B6/full translation/DOM/offline interpretation/install/
Safari/iPhone remain unverified/unfinished. No external device/environment/
permission blocker and no completion; neither terminal marker applies.
Only append-only report/plan retained; executable sources/tests, runner/gates,
companion/settings/checkboxes/unrelated user resources preserved. No agents,
stage advance, push/publish/install or browser/profile bypass. Final scope,
whitespace, staged exclusion and post-commit clean state checked at delivery.


Final preservation checks PASS, exit 0: exactly report/plan changed; both are
append-only; every existing checkbox unchanged; recognizer/regressions restored
byte-for-byte and runner/package/lock/architecture unchanged. Document-inclusive
`git diff --check` PASS. Only those two documentation files are staged, and staged
scope/whitespace plus post-commit cleanliness are verified before delivery.


### 2026-10-08 / chrome / iteration 4/20 — B2 exact captured-job replay

Related commit: `test: replay exact browser ASR jobs`, containing this entry.
B2 remains next unfinished; no default/checkbox/stage changes.

Implemented: extend the existing synthetic live fixture/harness to archive exact
scored job PCM only after capture/detach, verify pre-transfer digests, preserve
identity/range/text/original clock phases, then explicitly Prepare fresh cached
workers via the existing button and replay each Japanese multi-period job once.
Actual buffer transfer, exact archive read/hash and revision/timing checks apply.
Original cases/assertions/quality/strict full endpoint gates remain unchanged;
replay has no capture/segmentation wait and cannot substitute for live acceptance.

Executed (ignored `.ralph/media-framework/`; full metrics/environment/hashes and
limitations in `docs/verification/media-framework/chrome.md`):

- FAIL/INTERRUPTED: initial turbo sustained command, exit 1,
  `chrome-20261008-restart-4-live.log`: **28 ports / 254.05975 ms**, zero live
  rounds/ASR calls. Static review found completion stops the executor; the owned
  browser alone was intentionally stopped during Prepare, with harness cleanup.
  Recorded closed-target error is not an environmental blocker. Corrected
  explicit cached Prepare preserves production teardown.
- FAIL: corrected `caffeinate -disu npm run
  test:framework:chrome:live:sustained:gpu-recovery:turbo`, exit 1, once,
  `chrome-20261008-restart-4-final-live.log`: **28 ports / 270.89775 ms**,
  all ten rounds, **13,764 real WASM VAD frames / 36 real FP16 WebGPU ASR calls**,
  including two interrupted GPU jobs, plus **11 actual replay calls**.
  Japanese recovery **82/720 CER**, five anchors **20/18** and original endpoints
  **2,187.0 / 2,132.5 / 2,146.2 ms** FAIL. English **19/418 WER**, all anchors
  **19**, maximum **1,908.3 ms** PASS. Five short scored rounds PASS. No third run.
- PASS diagnostics: **26 exact archived jobs / 20,076,536 PCM bytes**, 19 complete
  endpoint phase associations, exact generated-media hash/size and all original/
  archive/replay identities, ranges, digests, transfers and outputs. Archive:
  `.ralph/media-framework/chrome-live-jobs-jHFVhY/`. All **11/11 replay texts
  match originals**; sustained Japanese repeats the exact failed meanings.
  Fresh cached Prepare **3,173.517417 ms**, no remote requests; every replay also
  has none. Two extra-meaning jobs/ranges/digests are identified in the report.
  This reproduces the failure; it does not isolate segmentation versus decoding.
- PASS: `python3 .ralph/media-framework/chrome-20261008-restart-4-analyze.py`,
  exit 0, `...-4-analysis.log`/`...-4-summary.json`; no additional inference.
- PASS: earlier `caffeinate -disu npm run verify`, exit 0, `...-4-verify.log`:
  Biome **117 files / 41 ms**, Ruff/typecheck/build, **116 JS / 21,553.665959 ms**,
  **222 Python / 66.89 s**. Corrected final-source result follows below.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `...-4-stage-acceptance.log`: missing full-stage script; no weaker substitute.
- PASS: syntax, targeted Biome (**10 ms**), whitespace and every original
  harness/fixture line/assertion retained in order (observation fields extended).

GPU-loss detach/discard/unprepared rejection and same-host/session/target cached
fresh-epoch recovery PASS; discarded **14,303.375 / 13,706 ms**, pending zero,
recovery requests zero. Normal capture/isolation/time/playback/PCM/coverage/queue/
loss/drain/detach PASS; no accuracy claim follows those lifecycle/input checks.
All visibility arrays/page errors `[]`. Pinned models/dependencies/source periods
unchanged; owned browser environment/readiness/RSS limitations in the report.
Repository AGENTS.md and requested independent runner file are absent.

Next B2: improve the exactly reproducible Japanese job-2/job-6 meanings and full
endpoint latency, then remaining original qualification before default selection.
B2–B6/full Korean translation/DOM/offline interpretation/install/Safari/iPhone
remain unfinished/unverified. No absent environment/device/permission, so no
blocked or complete marker. Only harness/fixture and append-only report/plan;
production/tests/runner/companion/settings/checkboxes/user resources preserved.
No agents, stage advance, push/publish/install/browser/profile bypass. All model,
media, credential, user and temporary state excluded. Final checks follow below.


Final-source `caffeinate -disu npm run verify` PASS, exit 0,
`chrome-20261008-restart-4-final-verify.log`: Biome **117 files / 56 ms**, Ruff/
typecheck/unchanged **28 main / 10 content modules**, **116 JS / 22,150.513125 ms /
0 failed/skipped/cancelled**, **222 Python / 66.95 s**. Japanese meaning/full
endpoint and required full-stage command failures remain failures; no checkbox
changes. Final append-only/four-file scope/checkbox/original-source preservation,
syntax/targeted lint/whitespace, staged whitelist/whitespace and post-commit
clean state are verified at delivery. Ignored artifacts are excluded.


### 2026-10-08 / chrome / iteration 5/20 (identical-input candidate comparison)

관련 commit: 이 기록을 포함한 `test: compare browser ASR on identical captured jobs`.
B2 remains next unfinished; B2–B6 remain unchecked and no default is selected.

수행한 변경: `test:framework:chrome:replay` and its real-browser harness compare
all 26 iteration-4 captured synthetic jobs on existing pinned small/turbo FP16,
two fresh production-worker trials each. Archive format/model/fixtures/references,
all byte counts/digests, finite PCM/identity/ranges and <=20-second contiguous jobs
are validated before browser launch. Original bytes transfer unchanged; no remote
requests during inference/cached second Prepare. Existing <=20% CER/WER and exact
meaning-count gates apply to every candidate/round; failures remain aggregate
failures. No original gate, production decoder/segmentation, fixture, default or
user setting changes. Replay is distinct from live endpoint/translation/DOM.

실행한 명령과 결과:

- FAIL: `caffeinate -disu npm run test:framework:chrome:replay --
  .ralph/media-framework/chrome-live-jobs-jHFVhY`, exit 1, once,
  `chrome-20261008-restart-5-replay.log`: four fresh workers / **104 actual
  WebGPU ASR calls**, all seven archived rounds each. Exactly two failures:
  turbo Japanese sustained meaning count, once per trial. Small passes every
  archived accuracy/meaning gate twice. No third invocation.
- PASS: inline Python JSON/input comparisons, exit 0,
  `chrome-20261008-restart-5-analysis.log` and `...-summary.json`: all 104 hashes/
  transfers/identity/ranges and original endpoint records; 26/26 texts identical
  between fresh-worker trials per candidate. This is analysis, not new inference.
- PASS: separate one-byte corruption guard, parent exit 0; child exit 1 with
  actual hash mismatch before build/browser/inference, `...-integrity-guard.log`.
  Original archive preserved; only owned temporary synthetic copy removed.
- FAIL: required `npm run test:framework:chrome`, exit 1, missing full-stage
  script, `chrome-20261008-restart-5-stage-acceptance.log`. No weaker substitute.
- PASS: harness syntax, one-file Biome (5 ms/no findings), existing package
  command/dependency/field preservation. Final `npm run verify` evidence follows.

실제 PCM/모델/화면/실기 중 검증한 범위: real model execution on hash-identical
previously captured synthetic selected-video PCM; **no new live acquisition/VAD**,
Korean translation or caption DOM. Japanese 18-period small **21/720 CER /
all seven anchors 18** in each trial; turbo **82/720 CER / five anchors 20**
in each trial (reservation/cancellation 18). Exact job-2/job-6 small meeting/
tomorrow/station counts two versus turbo three. English 19-period both **19/418
WER / all anchors 19**. Both short original languages and three-period rounds
pass. Turbo 26/26 outputs equal original archived texts in each trial.
Japanese sustained replay worker time small **1,262.7–1,385.7 ms**, turbo
**1,549.2–1,812.7 ms**; these cannot qualify full endpoint latency. Original
**2,187 / 2,132.5 / 2,146.2 ms** Japanese endpoints remain FAIL. Actual model
inventory, preparation/cache/RSS limitations/environment and per-trial clocks
are in `docs/verification/media-framework/chrome.md`.

다음 미완료 항목: B2 small FP16 live sustained/louder-noise/full-endpoint
requalification, remaining original/natural/quiet/no-pause/overload/ten-minute/
pressure/storage/licensing qualification before default selection. Historical
semantic failures remain preserved; prior live/lifecycle/quiet/offline suites
not rerun. Full Chrome/B3–B6/Safari/iPhone unverified. No environment/device/
permission absent; no blocked or complete marker. All prior checkboxes unchanged.
Only new harness/command and append-only report/plan retained. Existing product,
runner/dependencies/fixtures/acceptance/settings/user resources preserved. No
agents/stage advance/push/publish/install/access bypass; models/user/temporary
state excluded. Final verification and preservation checks follow below.


Final-source `caffeinate -disu npm run verify` PASS, exit 0,
`chrome-20261008-restart-5-verify.log`: Biome **118 files / 55 ms**, Ruff/typecheck,
unchanged companion **28 main / 10 content modules**, **116 JS / 21,573.570208 ms /
0 failed/skipped/cancelled**, **222 Python / 66.93 s**. Replay turbo meanings and
missing full Chrome command remain FAIL; no completed checkbox is added.
Final four-file scope, append-only history/unchanged checkboxes, old commands/
dependencies/product/tests/runner preservation, syntax/lint/whitespace and staged
exclusion are checked before commit; commit/post-commit cleanliness at delivery.


### 2026-10-08 / chrome / iteration 6/20 (small FP16 live/noise requalification)

관련 commit: 이 기록을 포함한 `docs: record live browser ASR candidate rejection`.
B2 remains next unfinished; B2–B6 remain unchecked and no default is selected.

수행한 변경: evidence-only continuation of B2 candidate evaluation. Tested whether
iteration 5's small FP16 exact-job replay pass extends to original sustained live
and louder-noise acceptance on current production code. Both actual suites reject
that qualification; changing a default/decoder without evidence is not justified.
Append this report/plan evidence only. Existing harnesses, every original gate,
production/model/segmentation/fixture/dependency/default/user settings unchanged.
Repository AGENTS.md and the requested independent runner verification file are
absent. Supplied instructions, plan, architecture and prior report reviewed.

실행한 명령과 결과 (all evidence under ignored `.ralph/media-framework/`):

- FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:learned`,
  exit 1, once, `chrome-20261008-restart-6-small-live.log`: typecheck, **28 ports /
  266.118 ms**, eight rounds / **9,846 actual WASM VAD frames / 33 actual WebGPU
  ASR calls**, then **18 real exact-job replays**. Japanese sustained live and
  identical replay meaning counts fail; all other original assertions pass.
- FAIL: `caffeinate -disu npm run test:framework:chrome:noise:learned`, exit 1,
  once, `chrome-20261008-restart-6-small-noise.log`: **23 ports / 257.162042 ms**,
  ten cases / **4,066 actual WASM VAD frames / 12 actual WebGPU ASR calls** plus
  two cached offline ASR calls. Sole failure: Japanese louder-noise meanings.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-6-stage-acceptance.log`: missing full-stage script.
  No placeholder, weaker gate or ASR-only substitute is added.
- PASS: `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-6-verify.log`: Biome **118 files / 54 ms**, Ruff/
  typecheck, unchanged **28 main / 10 content modules**, **116 JS /
  21,024.014292 ms / 0 failed/skipped/cancelled**, **222 Python / 66.93 s**.
- PASS: live/noise result/byte analysis, exit 0, `...-6-live-analysis.log`,
  `...-6-noise-analysis.log` and corresponding summary JSON. **33 actual archived
  jobs / 20,082,004 bytes** verified, **18/18 replay texts identical**, exact
  endpoint phase sums, normal zero loss/drain and offline controls. Four earlier
  analysis scripts failed on Python version, wrong hash key and two false
  historical English equality assumptions; corrected analysis retains observed
  differences. These are analysis, not extra model runs or new accuracy passes.

실제 PCM/모델/화면/실기 중 검증한 범위: real synthetic selected-video PCM →
learned VAD → small FP16 ASR. Japanese 18 periods **31/720 = 4.305556% CER**,
negation **19/18**, reservation **16/18** (FAIL), other five anchors 18; all full
endpoints **909–1,731.2 ms** PASS. English 19 periods **19/418 = 4.545455% WER**,
all four meanings 19, endpoints **1,093–1,460.3 ms** PASS. Inputs **125,568 /
126,720 ms**, peak pending **13,290 / 14,836.6875 ms**, zero normal loss/drain.
Exact failed Japanese jobs and digests are in the stage report and ignored archive
`chrome-live-jobs-fsSZ3n/`; replay reproduces them without reacquisition.

Japanese louder-noise **9/120 CER**, meeting **2/3**, station **1/3** FAIL;
quiet noise **3/120 CER**, all meanings three PASS. English both noise cases
**3/66 WER**, all meanings three PASS. All noise endpoints <2,000 ms; six noise-
only cases have zero active VAD/ASR. Ten full input hashes match iteration 13;
Japanese failed jobs/ranges/scores match, but English louder-noise segmentation/
score differs (4/66 → 3/66), so no all-job identity claim. Two cached offline
ASR jobs pass **1/40 CER / 1/22 WER**, zero remote requests. Short offline model
inference is distinct from complete offline interpretation. Model/environment/
preparation/RSS/generated-video hashes and limits are recorded in the report.

다음 미완료 항목: B2 correction of reproduced Japanese reservation/negation
errors on retained exact jobs, original louder-noise meanings and endpoint gates;
then remaining natural/quiet/no-pause/overload/ten-minute/storage/pressure/license
qualification before default selection. No identical failed suite retry after
this evidence. Full Chrome Korean translation/DOM/pairing/offline interpretation/
installation, B3–B6 and Safari/iPhone UNVERIFIED. No required environment/device/
permission is absent; qualification failures and incomplete implementation do
not warrant blocked or complete markers. All checkboxes unchanged.

Only append-only report/plan retained. Companion v0.1.0/install/native messaging/
server/user settings, production/harnesses/fixtures/dependencies/runner and user
resources preserved. No agents/stage advance/push/publish/install/access bypass.
Owned browsers/profiles/recorders cleaned up; credentials/weights/user data and
`.ralph` state excluded. Final scope, append-only/checkbox/preservation/whitespace,
staged exclusion, commit and post-commit clean status checked at delivery.

Final preservation checks PASS, exit 0: project-Python assertions confirm exactly
two append-only documents, unchanged checkboxes, consistent executed counts and
hash comparisons, no tracked `.ralph` state; `git diff --check` passes. Executable
sources remain those actually verified above. Staged whitelist/whitespace and
post-commit clean status are checked at delivery.

### 2026-10-08 / chrome / iteration 7/20 (monotonic ASR timestamps)

관련 commit: 이 기록을 포함한 `fix: constrain browser ASR timestamps`.
B2 remains next unfinished; B2–B6 remain unchecked and no default is selected.

수행한 변경: repair the locked SDK's omitted monotonic timestamp constraint with
a private worker-local logits processor before its existing FP16 timestamp rules.
Allow a new segment start at the previous end, require segment ends to advance,
leave text repetitions/EOS, q8, 256-token bound, PCM/segmentation, every original
acceptance gate/fixture and user settings intact. No public API/dependency change.
New regression runs the actual unexported worker with fake preparation/inference
and real SDK tensors/processors; it verifies decoding rules, not ASR accuracy.
Repository AGENTS.md and requested independent runner verification file are absent.

실행한 명령과 결과 (ignored `.ralph/media-framework/`; full metrics in Chrome report):

- FAIL before fix: `node --import tsx --test tests/framework-browser-timestamps.test.ts`,
  **2 failed / 1 passed / 1,744.558708 ms**, `...-7-timestamps-before.log`.
  Enclosing log-display shell exits 0; Node child exit not separately captured.
  Initial typecheck also reports three TS7053 errors; trailing lint masked that
  compound exit, not the errors. Flat Tensor data/dimensions resolves them.
- PASS final: same Node regression command, exit 0, **3 passed / 333.125416 ms**,
  `chrome-20261008-restart-7-timestamps-final.log`. Corrected combined typecheck/
  regressions/targeted lint also exits 0, 3 passed / **321.535584 ms**, Biome
  **2 files / 2 ms / no findings**; final targeted lint/whitespace checked below.
- FAIL: `caffeinate -disu npm run test:framework:chrome:replay --
  .ralph/media-framework/chrome-live-jobs-fsSZ3n`, exit 1, once,
  `chrome-20261008-restart-7-replay.log`: **132 real WebGPU ASR calls**, two
  fresh-worker trials per candidate. Exactly two small Japanese meaning failures;
  turbo passes every archived gate here. All other original assertions pass.
- FAIL: same replay command with `.ralph/media-framework/chrome-live-jobs-jHFVhY`,
  exit 1, once, `chrome-20261008-restart-7-turbo-original-replay.log`: **104 real
  WebGPU ASR calls**, two fresh trials per candidate. Exactly two turbo Japanese
  meaning failures; small passes every archived gate here. No third invocation.
- PASS: locked-project-Python archive/result and historical comparison, exit 0,
  `...-7-analysis.log`, `...-7-summary.json`, `...-7-history-comparison.log`:
  **236/236** original hash/byte/metadata/revision/transfer/timing associations;
  all texts identical between fresh trials. **104/104** earlier-archive outputs
  and scores equal iteration 5's pre-change comparison. Analysis, not inference.
- FAIL: required `npm run test:framework:chrome`, exit 1, missing full-stage
  script, `chrome-20261008-restart-7-stage-acceptance.log`; no weaker substitute.
- PASS: final-source `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-7-verify.log`: Biome **119 files / 54 ms / no findings**,
  Ruff/typecheck, unchanged companion **28 main / 10 content modules**, **119 JS /
  21,365.304958 ms / 0 failed/skipped/cancelled**, **222 Python / 66.89 s**.

실제 PCM/모델/화면/실기 중 검증한 범위: actual recognition on unchanged previously
captured synthetic selected-video jobs, **no new live capture/VAD**, translation
or caption DOM. `fsSZ3n` Japanese small **31/720 CER**, negation **19/18**,
reservation **16/18** FAIL; turbo **24/720 CER**, all meanings **18** PASS.
`jHFVhY` small **21/720 CER**, all meanings **18** PASS; turbo **82/720 CER**,
five meanings **20/18** FAIL. English sustained all **19/418 WER / anchors 19**;
all short/three-period meaning gates pass. Results identical across trials.
Small's own **33/33** and turbo's own **26/26** original outputs remain identical,
including failed meanings. Thus this demonstrated rule repair does **not**
produce measured transcription improvement or solve those failures.

Archives remain **33 / 20,082,004 bytes** and **26 / 20,076,536 bytes**, unchanged
manifest digests recorded in report. Same pinned small/turbo and owned headed
Chromium **153.0.8010.12**, macOS **26.6.2/25G83 arm64**, Node **v24.15.0**,
npm **11.12.1**, uv **0.12.23**, locked Transformers.js **4.3.0**. Each command
28 pinned/redirect remote requests; second Prepare/inference zero remote requests.
This is not disconnected-browser offline interpretation. Preparation, RSS and
worker/document timing limitations are in report. Original failed live full
endpoints remain failures; replay omits boundary/submission/acquisition waits.

다음 미완료 항목: B2 resolve Japanese meanings with a candidate/profile passing
both retained layouts and original louder-noise/full endpoint gates; then natural/
quiet/no-pause/lifecycle/overload/ten-minute/storage/pressure/licensing qualification
before default selection. No original live/noise/lifecycle suite rerun here.
Full Chrome Korean translation/DOM/pairing/offline interpretation/installation,
B3–B6 and Safari/iPhone UNVERIFIED. No required environment/device/permission
absent; no blocked or complete marker. All prior checkboxes unchanged.

Only private worker fix, focused regression and append-only report/plan retained.
Existing acceptance/harnesses/fixtures/runner/architecture/dependencies, companion
v0.1.0/install/native messaging/server/settings and unrelated user resources
preserved. No agents, stage advance, push/publish/install or access/profile bypass.
Only owned browser/profile cleanup; models, credentials, user data and temporary
`.ralph` state excluded. Final scope/append-only/checkbox/whitespace/staged
exclusion, commit and post-commit clean status checked at delivery.

Final preservation assertions PASS, exit 0, `...-7-preservation.log`: exactly
four intended files, report/plan append-only, all previous checkboxes unchanged,
236 replay associations/two failures per archive retained, no tracked `.ralph`
and clean whitespace. Final targeted Biome PASS **2 files / 2 ms / no findings**.
No executable edit after successful verify/model runs. Staged exclusion/whitespace,
commit and clean post-commit status checked at delivery.

### 2026-10-08 / chrome / iteration 8/20 (decoder provenance)

관련 commit: 이 기록을 포함한 `test: trace browser ASR decoder outputs`.
B2 remains next unfinished; B2–B6 stay unchecked and no default is selected.
Repository AGENTS.md and the requested independent runner evidence file
`.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt` are absent.

수행한 변경: assumption that retained failures might be introduced during timestamp
text decoding motivated the smaller exact-input diagnosis before another model
or segmentation policy. Extended the existing replay harness with a test-only
worker that imports the unchanged production worker, snapshots generated token
IDs/stride/raw text, observes the SDK's unchanged `_decode_asr` text/chunks and
attaches that trace only to the test result. The original decoder receives its
exact arguments once and returns its exact value. Trace association/shape/token/
stride checks are added; every original candidate/job/trial/accuracy/meaning gate
is preserved. A focused fake-tokenizer regression checks non-mutation, argument/
output identity and trace cleanup after success/error; it is not ASR evidence.
No production contract/host/decoder/settings/PCM/fixture/dependency changes.

실행한 명령과 결과 (evidence under ignored `.ralph/media-framework/`):

- FAIL first: `npm run typecheck`, exit 1, two TS2769 outgoing-transfer overload
  errors in the new fixture (direct tool output). Matching the production
  worker's actual one-argument response call resolves them.
- PASS: typecheck, `node --import tsx --test tests/framework-browser-asr-trace.test.ts`
  and targeted three-file Biome, exit 0; **1 test / 245.931583 ms / no failures**,
  lint **4 ms / no findings** (direct tool output).
- FAIL: `caffeinate -disu npm run test:framework:chrome:replay --
  .ralph/media-framework/chrome-live-jobs-fsSZ3n`, exit 1,
  `chrome-20261008-restart-8-trace-small-archive.log`: **132 real WebGPU ASR calls**,
  every original round, two retained small Japanese meaning failures. All other
  original and new assertions pass.
- FAIL: same command with `.ralph/media-framework/chrome-live-jobs-jHFVhY`, exit 1,
  `chrome-20261008-restart-8-trace-turbo-archive.log`: **104 real WebGPU calls**,
  every original round, two retained turbo Japanese meaning failures. Every other
  original/new assertion passes. Once per distinct archive, two existing fresh
  trials per candidate; no third unchanged failed attempt.
- PASS: `uv run --locked python .ralph/media-framework/chrome-20261008-restart-8-analyze.py`,
  exit 0, `...-analysis.log` and `...-summary.json`: **236/236** original bytes/
  digests/ranges/model/revision/text associations, every score/count/failure equal
  iteration 7; every raw decoder text and concatenated returned segment text
  equals final text. All token/chunk traces exactly equal between fresh trials.
  Analysis performs no inference and cannot repair failed recognition.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-8-stage-acceptance.log`: missing full-stage script.
  No placeholder, weakened gate or B2 replay substitution.
- PASS: final-source `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-8-verify.log`: Biome **121 files / 56 ms**, Ruff/typecheck,
  companion **28 main / 10 content modules**, **120 JS / 22,246.048 ms / zero
  failed/skipped/cancelled**, **222 Python / 66.97 s**. No later executable edit.
- FAIL then corrected: intermediate `git diff --check`, exit 2, draft report blank
  EOF while appending. Completed-report check passes, exit 0. Final preservation/
  staged whitespace/exclusion/commit/cleanliness checks are recorded at delivery.

실제 검증 범위: exact archived synthetic 16 kHz mono PCM replay, not live capture,
VAD, translation or DOM. Small/turbo `fsSZ3n` Japanese **31/720 / 24/720 CER**,
small negation **19/18**, reservation **16/18** FAIL; turbo all meanings **18/18**.
`jHFVhY` small/turbo Japanese **21/720 / 82/720 CER**, small all **18/18**, turbo
five meanings **20/18** FAIL. English sustained **19/418 WER**, all **19/19**;
all short gates pass. <=20% CER/WER and exact meaning gates unchanged.
No accuracy improvement or default qualification. The generated tokens already
contain the errors; timestamp merging/caption handling did not introduce them
in these jobs. Acoustic/segmentation/model/numerical/generation causes remain
unresolved. All four failed-job traces are monotonic, within PCM duration and
below the token bound. Turbo's duplicate meanings occur in the predicted final
**13.12–13.92 s** segment of two **13.92 s** jobs. Other jobs predict ends beyond
available PCM: per trial small **14/33 / 13/26**, turbo **4/33 / 5/26** by archive;
zero backwards/incomplete segments. Predictions are not verified speech alignment
or evidence that duration caps/token-limit changes solve the failed meanings.

Same owned Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, Transformers.js **4.3.0**; same pinned
small/turbo **487,960,440 / 1,621,338,971 bytes**. Each profile **28 remote paths /
requests**, all cached second preparations/inferences **zero remote requests**,
page errors/visibility `[]`. No new candidate/revision. Japanese sustained worker
ranges combined **444.3–1,210.4 / 985.5–1,563.5 ms** on `fsSZ3n` small/turbo,
**1,255.3–1,376.0 / 1,543.9–1,810.7 ms** on `jHFVhY`. These include observation
and omit acquisition/boundary waits; previous live endpoint failures stay FAIL.
Peak owned-tree RSS **4,272,384–5,819,408 / 4,901,136–5,675,824 KiB** by archive;
shared pages/allocator/browser/GPU/observer included, not isolated memory/pressure.
Full preparation/memory/digest/timing details are in the appended Chrome report.

다음 미완료 **B2**: resolve generated Japanese substitutions/extra meanings with
an actually passing candidate/profile across both original layouts and retained
louder-noise/live endpoint gates. No speculative transcript filtering/correction.
Natural/quiet/no-pause/overload/ten-minute acquisition/pressure/storage/licensing
qualification and default selection remain unfinished; original live/noise/VAD/
Stop/GPU suites were not rerun. Full Korean translation/DOM/pairing/offline
interpretation/installation/B3–B6/Safari/iPhone remain UNVERIFIED. No required
environment/device/permission is absent; no blocked/completion marker warranted.

Only the observer fixture, replay harness, focused regression and append-only
report/plan enter Git. All prior checkboxes, production ASR/core/companion v0.1.0/
install/native messaging/server/user settings, dependencies, fixtures, runner,
architecture and unrelated files/apps/recordings/mounts remain unchanged. No
agents, stage advance, push/publish/install or browser access/profile/permission
bypass. Owned browser/profile resources cleaned by the existing harness; no
credentials, weights, user audio/transcripts or temporary `.ralph` state committed.

Final preservation assertions PASS, exit 0,
`chrome-20261008-restart-8-preservation.log`: exactly five intended files,
append-only plan/report, all prior checkboxes unchanged, **236** trace associations
and both original failure pairs preserved, no tracked `.ralph` state and clean
whitespace. No executable edit after verify/replay. Staged whitelist/exclusion/
whitespace, commit and clean post-commit status are verified at delivery.


### 2026-10-08 / chrome / iteration 9/20 (audio-duration timestamp bounds)

관련 commit: 이 기록을 포함한 `fix: bound browser ASR timestamps to supplied audio`.
B2 remains next unfinished; all prior checkboxes, including B2–B6, stay unchanged.
No default is selected. Root/nested AGENTS.md and requested independent runner
file `.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt`
are absent. Reviewed supplied instructions, plan, architecture and Chrome report.

수행한 변경: assumption that iteration 8's timestamps beyond actual PCM need a
separate decoding-domain constraint led to the smaller private-worker change
before another candidate, segmentation rule or transcript repair. FP16 timestamp
logits above the last 20 ms tick covering the actual 16 kHz job are masked before
SDK pairing/probability rules. Existing monotonic lower bound remains. No text/
EOS suppression, PCM transformation, reference injection, transcript trimming,
q8 change, new setting/default, model/dependency/host/protocol change or extra ASR
pass. Timestamp predictions are not verified acoustic alignment, and bounding
them is not assumed to repair the previous within-audio Japanese meaning errors.

Focused fake-inference/real-tensor regression covers both FP16 candidates,
100 ms / 1 s / 1.001 s / 30 s jobs, prefix/post-text rows, inclusive final tick,
all later ticks masked, available text/EOS, existing monotonic/repeated-speech
rules and q8. Observable success is an actual generated-token bound with unchanged
PCM/model/revision associations and all existing quality/meaning gates preserved.

실행한 명령과 결과 (ignored `.ralph/media-framework/` evidence):

- FAIL before implementation: `node --import tsx --test
  tests/framework-browser-timestamps.test.ts`, exit 1,
  `chrome-20261008-restart-9-duration-before.log`, **3 passed / 2 failed /
  342.822125 ms**; both FP16 padding logits still finite.
- FAIL first post-change: typecheck passes, regression exit 1,
  **3 passed / 2 failed / 315.456458 ms** (direct tool output). The synthetic
  vocabulary omitted the score after the 30-second tick; extended it by one.
  No production limit or original acceptance was relaxed.
- PASS focused typecheck/regression/two-file Biome, exit 0 (direct tool output),
  **5 tests / 0 failed/skipped/cancelled / 333.199542 ms**, lint **2 ms / no
  findings**. Later strengthened the new test to assert every excluded score;
  final required verify below covers that final assertion and all executable edits.

- FAIL: `caffeinate -disu npm run test:framework:chrome:replay --
  .ralph/media-framework/chrome-live-jobs-fsSZ3n`, exit 1,
  `chrome-20261008-restart-9-bounded-small-archive.log`: **132 actual WebGPU ASR
  calls**, all archived rounds/candidates/two fresh-worker trials. Exactly two
  retained small Japanese meaning failures; every other original assertion passes.
- FAIL: same command with `.ralph/media-framework/chrome-live-jobs-jHFVhY`, exit 1,
  `chrome-20261008-restart-9-bounded-turbo-archive.log`: **104 actual WebGPU calls**,
  all original jobs/trials, exactly two turbo Japanese meaning failures. Other
  original assertions pass. Once per distinct archive, no third unchanged attempt.
- PASS: `uv run --locked python .ralph/media-framework/chrome-20261008-restart-9-analyze.py`,
  exit 0, `...-analysis.log` / `...-summary.json`: **236/236** original byte/hash/
  range/model/revision/transfer associations, generated timestamps all within the
  covering tick, zero backwards/incomplete segments, all raw/chunk text equal
  final text. Every trace exactly matches its candidate's second fresh trial.
  Analysis performs no inference and does not override retained semantic failures.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-9-stage-acceptance.log`: missing full-stage script.
  No placeholder/reduced gate or ASR replay substitute added.

실제 검증 범위: archived synthetic 16 kHz selected-video jobs only; **no new live
capture/VAD**, translation or DOM. All old error/meaning gates retained. `fsSZ3n`
small/turbo Japanese **31/720 / 24/720 CER**: small negation **19/18**, reservation
**16/18** FAIL; turbo all **18/18** PASS, unchanged. `jHFVhY` small **21/720 CER**,
all **18/18** PASS, unchanged; turbo improves **82/720 → 59/720 CER**, five
meaning counts **20 → 19**, still FAIL against **18**. Reservation/cancellation
remain **18**. Sustained English all **19/418 WER**, each meaning **19/19**;
all short/three-period original scores/counts unchanged and passing. **230/236**
texts unchanged; two small `fsSZ3n` punctuation changes and one turbo `jHFVhY`
semantic change per trial. No general quality/default or live latency claim.

Turbo `jHFVhY` job 6, **70,496–84,416 ms**, original digest preserved, now generates
**71 tokens / one 0–13.92 s segment / two of every meaning**; previously **94
tokens / three segments / three of five meanings**. Job 2 still has the unchanged
94-token duplicate; small reservation/negation errors remain. Changes arise in
raw generation, before decoding. Report records exact hashes and trace evidence.
Predictions strictly beyond exact PCM duration fall **72/236 → 20/236**; all
remaining overshoot is within the fractional final tick, maximum **16 ms**.
Zero predictions exceed that tick, without claiming acoustic timing accuracy.

Archives/manifests/PCM/ranges/fixture hashes/references remain unchanged:
`fsSZ3n` **33 jobs / 20,082,004 bytes**, `jHFVhY` **26 / 20,076,536 bytes**.
Same owned Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, Transformers.js **4.3.0**, pinned
small/turbo **487,960,440 / 1,621,338,971 bytes**. Each profile **28 remote paths /
requests**, cached second Prepare and every inference **zero remote requests**;
page errors/visibility `[]`. No new candidate/revision/dependency. Initial RSS
**1,296,064 / 1,296,400 KiB**; trial peaks **4,381,696–6,673,664 / 5,020,896–6,135,728
KiB** by archive. Process RSS includes shared pages/allocator/GPU/browser/observer;
not isolated allocation/pressure/leak/storage/mobile/thermal qualification. Full
preparation/timing/digest details and clock caveats are in the Chrome report.
Replays omit acquisition/VAD/boundary waits; previous failed live turbo endpoints
**2,187 / 2,132.5 / 2,146.2 ms** remain FAIL. Online cache is not offline interpretation.

다음 미완료 **B2**: resolve remaining Japanese generated substitutions/repetitions
and qualify a candidate/profile across both retained layouts plus original louder
noise/live full endpoints. Original live/noise/quiet/no-pause/Stop/GPU/overload/
sustained suites were not rerun on this bound. Natural speech, ten-minute live
acquisition, pressure/storage/licensing and default selection remain unfinished.
Full Korean translation/DOM/pairing/offline interpretation/standalone installation,
B3–B6 and Safari/iPhone remain UNVERIFIED. No required environment/device/permission
is absent; failed qualification and missing implementation warrant neither terminal
marker. All prior checkboxes unchanged; no stage/framework/iPhone completion claim.

Only private worker/regression and append-only report/plan retained. Existing
acceptance harnesses/fixtures/gates, runner/dependencies/architecture/core/companion
v0.1.0/install/native messaging/server/user settings and unrelated files/apps/
recordings/mounts preserved. No agents, stage advance, push/publish/install or
browser access/profile/permission bypass. Owned browser/profile cleanup only;
credentials, model weights, user audio/transcripts and temporary `.ralph` state
excluded. Final required verify/preservation/commit checks follow below.

Final-source `caffeinate -disu npm run verify` **PASS**, exit 0,
`chrome-20261008-restart-9-verify.log`: Biome **121 files / 55 ms / no findings**,
Ruff/typecheck, companion **28 main / 10 content modules**, **122 JS tests /
21,678.527167 ms / 0 failed/skipped/cancelled**, **222 Python / 66.94 s**,
Python **3.12.15**. Covers the final all-padding-scores assertion. No later
executable edit; missing full-stage command and both semantic failure pairs remain
FAIL, all previous checkboxes unchanged.

Final preservation assertions **PASS**, exit 0,
`chrome-20261008-restart-9-preservation.log`: exactly four intended files,
append-only report/plan, all prior checkboxes unchanged, **236** trace associations,
**230** unchanged texts / **6** changes, every timestamp within covering tick,
both retained failure pairs, no tracked `.ralph` state and whitespace clean.
Staged whitelist/exclusions/whitespace, intended commit and post-commit cleanliness
are checked at delivery.

### 2026-10-08 / chrome / iteration 10/20 (timestamped q8 comparison)

관련 commit: 이 기록을 포함한 `test: compare timestamped q8 browser ASR`.
B2 remains next unfinished; every prior checkbox, including B2–B6, stays unchanged.
No default is selected. Repository AGENTS.md and requested independent runner
file `.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt`
are absent. Reviewed supplied instructions, plan, architecture and Chrome report.

수행한 변경: test the assumption that already pinned small q8 weights with the
FP16 timestamp decoding rules may improve retained Japanese failures. This smaller
comparison precedes a new model/boundary/text-repair approach and assumes no quality
improvement. Added explicit `smallTimestamped` experiment sharing the existing
immutable small q8 inventory/cache; original q8 baselines and both FP16 profiles
retain their decoding. Same actual-PCM upper/monotonic lower bounds, task/language,
256-token single-pass limit, PCM and model revisions. No default/fallback/UI setting,
prompt/reference injection/text filtering, new dependency or artifact inventory.
Replay retains both original candidates and adds two fresh-worker q8 trials on
every original job per archive, recording dtype alongside identity/byte count.
All original <=20% error/exact meaning-count gates remain unchanged.

Focused fake-inference/real-tensor regression covers all three timestamp profiles,
100 ms / 1 s / 1.001 s / 30 s jobs, monotonic/zero-length rules, covering tick/all
excluded padding and repeated-text/EOS availability. All three original q8 keys
keep non-timestamp decoding. These checks do not establish ASR quality/loading.
Inspection of all 236 iteration-9 traces found initial timestamps zero, rejecting
the SDK's skipped initial-timestamp limit as a remedy for those jobs. Two optional
web-tool lookups for additional-precision metadata were unavailable; abandoned
without another tool/profile/access route. Existing registered local tests continue.

실행한 명령과 결과 (ignored `.ralph/media-framework/` evidence):

- FAIL before implementation: `node --import tsx --test
  tests/framework-browser-timestamps.test.ts`, exit 1,
  `chrome-20261008-restart-10-q8-before.log`: **5 passed / 2 failed**, new candidate
  rejected; original checks pass.
- PASS: `npm run typecheck`, exit 0, `...-typecheck.log`; same focused test,
  `...-q8-final.log`, exit 0, **7 passed / 0 failed/skipped/cancelled /
  348.317667 ms**; final four-file Biome **17 ms / no findings**, exit 0.
- FAIL required `npm run test:framework:chrome`, exit 1, once,
  `...-stage-acceptance.log`: missing full-stage script. No placeholder, replay
  substitute or reduced gate; full Korean translation/DOM acceptance unfinished.

실제 모델 comparison and final repository verification evidence follows below;
full details are in `docs/verification/media-framework/chrome.md`.


Iteration-10 result/checkpoint: both captured archives compared, 354 total jobs.
Timestamped small q8 is rejected as a default: one Japanese layout has 36.806% CER
and missing/repeated meanings; replay calls take 6.447–18.661 s. Existing small
FP16 misses reservation counts on fsSZ3n; Turbo repeats phrases on jHFVhY. Both
trials reproduce each result. No candidate passes both layouts. Exact result
matrix and logs are in the Chrome report; live endpoint acceptance is still pending.

Cleanup inspection found no running loop, an empty iteration-10 final message and
six uncommitted files; the old verify log ends mid-Python, without a final result.
Checkpoint verification rerun PASS: 124 JS / 222 Python (66.86 s), lint/typecheck/build;
focused timestamp regressions 7 PASS. Preserve all captured jobs/failed evidence,
original inventory/defaults/checklists and current sequencing. Commit:
`test: compare timestamped q8 browser ASR`.

B2 status: comparison/decoder investigations are recorded, but default selection
and common semantic/live-latency acceptance remain unresolved. The missing full
Chrome acceptance script is B5 work. Current next-unfinished-item sequencing keeps
B2 active; detailed B6 quality and B5 ten-minute integration have expanded this
work's practical scope. Before another long run, clarify B2's finite completion
boundary and which remaining issues belong to B5/B6. This checkpoint does not
silently check B2 or authorize skipping it. B3–B6/Safari/iPhone remain unfinished.


### 2026-10-08 / chrome / B2 종료와 B6 품질·성능 작업 분리

관련 commit: 이 기록을 포함한 `docs: separate ASR integration from final quality tuning`.
사용자가 B2의 종료 조건과 세부 성능 개선을 분리하고 개선은 마지막에 수행하도록
요청했다. 실행 중인 Ralph/Codex-exec/browser ASR 검증 프로세스는 없다.

변경: 위 Stage chrome에 유한한 B2 종료 조건과 우선하는 현재 작업 순서를
명시하고 B2만 체크했다. 기존 실제 인식·후보 비교·큐/GPU/cancel 검증을 근거로
small FP16/WebGPU를 구현용 기본 모델로 선택했다. 실제 앱 구성은 B4에서 연결한다.
B5는 전체 경로·수명주기·10분 입력/큐/손실과 성능 수치를 검증하고, B6는 최종
품질·지연 목표 달성을 맡는다. 다음 미완료 항목은 **B3 Translator adapter**다.
B3–B6/Safari/iPhone과 Chrome stage 전체는 미완료다.

근거: 2026-10-07 active GPU loss/recovery 실측에서 동일 small FP16의 명시적
GPU loss/폐기, 수동 cached Prepare와 fresh-epoch 인식 성공을 확인했다.
같은 날 continuous-input 시험에서 과부하/Stop/cancel 계약과 정상 손실 0,
큐 배출을 검증했다. 2026-10-08 restart iteration 6 live 시험은 실제 일본어/영어
PCM·시간 매핑·입력 보존·bounded queue/배출을 통과했으나 일본어 의미 검사는
실패했다. 최신 iteration 10 비교는 Small/Turbo/q8의 속도·오류·실패를 보존했다.
이 실패들은 해결했다고 표시하지 않고 B6로 이관한다.

검증: 문서 범위·체크리스트와 Chrome dry-run, 기존 runner 및 ASR/queue 회귀
검증을 실행하고 아래에 결과를 기록한다. 모델 실측은 이번 문서 변경으로
재실행하지 않는다. 기존 harness/fixture/assertion/threshold, production 코드,
runner, dependency, companion과 사용자 설정은 변경하지 않는다.


실행 결과:

- PASS: `node --test tests/ralph-loop.test.mjs`, **20 passed / 0 failed**.
- PASS: `node --import tsx --test tests/framework-browser-asr.test.ts
  tests/framework-browser-speech.test.ts`, **24 passed / 0 failed**.
- PASS: `node scripts/ralph-loop.mjs chrome 5 --dry-run`, exit 0; 실제 loop 실행 없음.
- PASS: 현재 checklist의 다음 미완료 항목 **B3**, B2만 미완료→완료 변경,
  나머지 stage 내용과 production/harness/기준 파일 보존 확인; `git diff --check`.
- 미실행: 새 실제 모델/실시간/10분/전체 Chrome acceptance. 이번에는 계획·보고서만
  변경했고, 위 과거 실측을 근거로 작업 경계를 확정했다. B6의 실패는 미해결이다.


### 2026-10-08 / video / repair V2 output observation readiness

관련 commit: 이 기록을 포함한 `fix: wait for video output samples before measuring volume`.
최신 all run이 core 검증을 통과한 뒤 V2 음량 baseline에서 실패했다. 당시 RMS는
로그에 없으며, 동일 코드의 instrumented 재실행은 통과했다. 700 ms tab-loopback
연결 지연을 주면 기존 검사가 RMS 0으로 실패하고 이후 정상 출력으로 돌아오는
회귀를 확인했다. 과거 중단의 정확한 native 원인으로 단정하지 않는다.

fixture의 outputReady를 실제 loopback 데이터 도착 후 설정하도록 변경하고
5초 내 미도착은 명시적으로 실패한다. 기존 250 ms 측정과 12% 음량/PCM/overflow
검사를 유지하고, 지연 관측 시작을 영구 V2 회귀 사례로 추가했다. 실제 반쪽 음량과
loopback 미연결은 각각 기존 amplitude gate와 새 bounded readiness에서 실패했다.
초기 전체 Video V1–V5와 15 unit checks 통과; 최종 lint 조건 수정 후 검증은 아래에
기록한다. 상세 수치·로그는 Video 보고서. B2 완료와 B3 다음 순서, 모든 checkbox,
companion/production input/모델/음성 payload/사용자 설정은 그대로다.


최종 결과: `caffeinate -disu npm run test:framework:video` **PASS**, 15 unit tests와
V1–V5 실제 브라우저 검증 전부 통과, 지연 baseline RMS 0.042437016039684125.
`caffeinate -disu npm run verify` **PASS**, lint/typecheck/build, **127 JS /
222 Python (66.90 s)**. 이 JS 결과에는 별도로 요청받은 runner 자동 복구 회귀도
포함된다. 로그: `video-baseline-final-fixed.log`, `loop-recovery-final-verify.log`.
Targeted Biome/whitespace 통과. 모델·번역·후속 stage 완료를 의미하지 않는다.


### 2026-10-08 / runner / repair failed completed-stage acceptance automatically

관련 commit: 이 기록을 포함한 `fix: repair failed Ralph stage verification automatically`.
사용자가 문제 발생 시 루프가 셀프 해결하고 계속 진행하도록 요청했다.
기존 runner는 완료 checkbox 단계의 최초 재검증 실패에서 Codex를 호출하지
않고 즉시 종료했다. 미완료 단계의 완료 검증 실패도 다음 항목 구현 지시만
계속 전달했다. 실제 Video baseline 실패가 이 경로로 Chrome B3 진입을 막았다.

변경: 완료 단계의 재검증 실패와 iteration 완료 검증 실패에 전용 repair prompt를
전달한다. 실패 로그를 읽고 해당 단계의 원인·수정·검증·커밋만 수행하게 하며,
완료 기능 재구현이나 다른 품질 목표 조정을 하지 않는다. 복구 중에는 marker가
없어도 독립 acceptance를 다시 실행한다. 최초 실패와 이후 검증 로그를 append해
보존한다. 수정 후 두 번 연속 검증 실패/커밋 무진척/iteration 한도에서는 종료한다.
기기·권한 부재, CLI 실패, dirty worktree, unselected stage/branch/runner 변경과
최종 전체 재검증·정리 보호는 유지한다. 실패 검증을 생략하거나 기준을 낮추지 않는다.

회귀 먼저 FAIL: `node --test --test-name-pattern='completed-stage|repair targets|
already-completed|missing report' tests/ralph-loop.test.mjs`, **5 failed**, 기존 runner가
repair를 호출하지 않는 것을 확인했다. 구현 후 전체 runner 검사 **23 PASS**:
완료 Video 실패→repair→Chrome 이후 stage 진행, marker 없는 repair 재검증,
실패 로그 보존, 두 번 미해결 시 종료와 모든 기존 보호를 검증했다.
이는 fake Codex/npm을 쓰는 runner 제어 흐름 검사이며 실제 모델/기기 성공은 아니다.
로그: `.ralph/media-framework/runner-repair-before.log`, `runner-repair-after.log`.

최종 `caffeinate -disu npm run verify` **PASS**, lint/typecheck/build,
**127 JS / 222 Python (66.90 s)**; 로그 `loop-recovery-final-verify.log`.
실제 Video acceptance도 V1–V5와 15 unit checks PASS (`video-baseline-final-fixed.log`).
문서/README는 재검증 실패의 자동 복구 경로와 유한한 종료 조건에 맞춰 수정했다.
체크리스트는 B2 완료, B3 다음인 기존 상태를 유지한다. Commit과 clean worktree
확인 후 `all 20`으로 재개한다. 외부 push/publish/install/에이전트 위임은 없다.


### 2026-10-08 / video / repair iteration 1/20 — blocked real speech/output verification

Commit: `docs: record blocked video speech acceptance repair` containing this log
and the [Video report](docs/verification/media-framework/video.md). Repair remains
incomplete; V5 is unchecked again. V1–V4 and all other stage checkboxes are preserved.

The requested runner log fails site-owned Japanese repeat speech correlation
**0.5008284170603916** (required **>0.85**, assertion false), despite passing tags/ordering/map.
One full local acceptance (15 unit checks, V1–V5) and two focused diagnostics
pass with unchanged matching/gates; none establishes a repair. A one-second
repeat-Start delay reproduces **0.7188289784528917**. Offline exhaustive alignment
gets the identical failure. Three 100 ms segments match exactly; after a transition
the reference offset shifts **128 samples / 2.6667 ms**. Native playback/capture/
context origin is unverified. No matcher defect or safe sample/timestamp repair
is proven. Logs and synthetic diagnostic data remain ignored under `.ralph`.

A local bundled-context buffering experiment never reaches capture: after one
reporter error, two independent V5 original-output baselines fail, including an
extra 500 ms observation wait (**0.021364/0.012020**, then **0.011634/0.003425**,
expected **0.024/0.015 ±12%**). The experimental context had not been constructed
when either baseline failed. Stop repeating this real-output blocker. Discarded
all temporary fixture/harness/bundle experiments; production, acceptance criteria,
runner, companion, settings and unrelated files are preserved.

Final repair Video acceptance is **UNVERIFIED/BLOCKED**, not satisfied by the
intermittent passing run. General final-source verification is recorded below.
Resume with new permitted real-audio stability evidence or a proven repository
fix, then pass the delayed site-owned regression and the full original Video
acceptance plus ordinary verification before rechecking V5. No ASR/translation,
Safari/iPhone, whole-framework completion or next-stage work is claimed.

Final `npm run verify`: **PASS**, exit 0, Biome 121 files/56 ms, Ruff,
typecheck/build, **127 JS / 0 failed / 0 skipped** (25401.068584 ms),
**222 Python** (66.97 s); `video-repair-1-verify.log`. Unstaged/staged whitespace
checks PASS. Only plan/report progress is committed; clean worktree checked after
commit. Required real-audio acceptance remains blocked and V5 unchecked.


### 2026-10-08 / video / headed native-audio acceptance and V5 readiness repair

관련 commit: 이 기록을 포함한 `fix: run video audio acceptance in headed Chromium`.
목표: 루프가 성공적으로 완료될 때까지 감독한다는 사용자 요청에 따라 자동 복구
중단 이후 V5를 직접 조사했다. 브라우저 설정/사용자 오디오 장치/앱을 변경하지 않았다.

기존 headless 재검증은 waveform 0.5008/0.7188 및 출력 baseline 실패로 중단됐다.
새 비교에서도 headless PCM 0.519658과 매우 낮은 출력값을 확인했다. playback
latencyHint bundle 실험은 한 번 통과했으나 다른 시작 phase에서 capture 이전
baseline이 실패했고, 변경 없는 동일 입력도 통과하여 production buffering fix로
채택할 근거가 부족했다. 모든 production/model/worklet/PCM/fixture byte는 유지한다.

V5 outputReady도 고정 500 ms 기다림이 실제 loopback 도착을 보장하지 못했다.
실제 연결 1초 지연 회귀에서 기존 baseline은 [0,0]으로 실패했다. 이제 실제
samples 도착을 최대 5초 기다린 후 8192-frame 관측창 하나를 채우고 기존 측정을
한다. 기대 음량에 맞을 때까지 재시도하지 않는다. 지연 관측 사례를 추가하고,
site-owned 일본어 repeat Start에 앞서 실패한 1초 간격을 영구 회귀로 남겼다.

작은 harness 변경으로 오디오 V2–V5만 headed Chromium으로 실행한다. catalog
검사는 headless 유지. 같은 fixture/production 코드의 headed 비교에서 9회 원래
검사와 별도 1초 간격 6회 검사가 모두 correlation 1.0과 출력/손실/시간/원문 상태
조건을 통과했다. Headless의 128-sample native shift 원인 자체는 확정하지 않았으며
이 환경의 headless 오디오 성공을 주장하지 않는다. 실제 사용자 브라우저 실행을
검증하는 profile 변경이다. 실제 스피커 청취·ASR/번역 품질을 이 검증으로 대체하지 않는다.

최종 `caffeinate -disu npm run test:framework:video` **PASS**, 15 unit checks와
V1–V5 실제 브라우저 검증 전부 통과. V5 9회 selected correlation 모두 **1.0**,
최대 mapping error **5.204 ms**, 기존 >0.85/<0.35/12%/tag/PCM gates 유지.
`caffeinate -disu npm run verify` **PASS**, lint/typecheck/build, **127 JS /
222 Python (66.94 s)**. 로그 `video-followup-final-acceptance.log`,
`video-followup-final-verify.log`; 비교 및 실패 로그도 `.ralph/media-framework/`에 보존.
V5를 재체크했다. B2 완료/B3 다음과 다른 모든 stage checkbox를 유지하고,
commit/clean 확인 뒤 `all 20` 재개한다. No push/publish/install/delegation.


### 2026-10-08 / video / repair iteration 1/20 — serialize V5 Start controls

Commit: `fix: serialize speech fixture capture controls` containing this entry
and the Video report. The requested independent runner passes V1–V4, then fails
ordinary V5 with active-session rejection/two chunks. The V5 fixture allowed a
second Start to reset shared observations and open an already-active input.
A native double-click reproduces the exact assertion before the fix (two trusted
Start events, 1.2 ms apart); the runner's exact activation trigger is unverified.

Disable fixture Start from synchronous preparation through awaited cleanup,
then re-enable it and publish captureClosed. Preserve production duplicate-open
rejection and every existing gate. First captures now exercise native double-click
in all three graph/output cases, with disabled/enabled lifecycle assertions;
repeat Start and target switch continue to require the original identity and PCM.
No production/model/fixture-audio/runner/companion/settings change or later-stage
work. Diagnostic .ralph files are excluded from the commit.

Initial unchanged full acceptance FAILS separately at site-owned English waveform
correlation **0.33918473529748516**, after 15 unit checks/V1–V4 pass. Its origin
remains unverified; control serialization is not claimed to repair native audio.
Native duplicate-click regression FAILS at the exact active-session assertion.
Logs: `video-active-session-before.log`, `video-active-session-native-before.log`.
Final-source results follow below and in the Video report; do not substitute mock
controls/PCM acquisition for ASR/translation or Safari/iPhone evidence.

Final-source `npm run test:framework:video`: **PASS**, exit 0, adapter typecheck,
15 unit checks and V1–V5 real browser checks. V5: 9 captures/528 real chunks,
3 native double-click Starts, exact identity/cleanup/Start lifecycle checks pass;
selected correlation **0.9998061254182445–1.0**, wrong maximum **0.2838158650033617**,
mapping maximum **3.480999999999767 ms**, all unchanged output/isolation gates.
Evidence: `video-active-session-fixed-acceptance.log`. Targeted two-file Biome
PASS. No further audio acceptance attempt after this pass. V1–V5 remain checked;
all other stage checkboxes and plan remain unchanged.

Final-source `npm run verify`: **PASS**, exit 0; Biome 121 files/45 ms,
Ruff/typecheck/build, **127 JS / 0 failed / 0 skipped** (26517.291416 ms),
**222 Python** (66.91 s); `video-active-session-fixed-verify.log`.
Whitespace PASS. Video has no unfinished item after both required commands pass;
physical speaker/ASR/translation/Safari/iPhone remain unverified. Commit only the
fixture control repair, native regression, report and plan entry; check staged
scope/whitespace and clean worktree after commit. Do not advance another stage.

### 2026-10-08 / chrome / iteration 1/20 — B3 document translation readiness blocker

Commit: `feat: add document translation adapter and revision queue`, containing
this entry. B3 is next under the revised scope; B2 stays complete. All selected
and other stage checkboxes remain unchanged. Repository AGENTS.md and requested
`2026-10-08T13-08-27-886Z-chrome-verification.txt` runner log are absent.

Implemented a document-owned `TextTranslator` adapter: exact pair capability,
synchronous native create from activation, progress distinct from ready, bounded
text, identity/revision snapshots, matching-epoch cancellation, Stop/hidden/
pagehide cleanup and late completion rejection. Added bounded translation queue
using the existing revision store: original-first/pending output, newest pending
source per utterance, final priority, stale revision rejection and visible
overload. Native creation uses a separate gesture per selected language. No
fallback/model tuning, companion/settings/runner change or later-stage work.

Regression first FAILS **5 pass / 1 fail** at a one-utterance final replacement;
fixed capacity to count distinct utterance IDs. Final focused typecheck/lint and
**6 unit contract tests PASS**, with fake translation explicitly distinguished
from native accuracy. Initial typecheck test-only union errors were corrected.
Final-source `npm run verify` **PASS**, exit 0: **133 JS / 222 Python (66.84 s)**,
lint/typecheck/unchanged companion build. Evidence:
`chrome-b3-unit-final.log`, `chrome-b3-queue-bound-before.log`,
`chrome-b3-verify-final.log` under ignored `.ralph/media-framework/`.

Real headed owned Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**: native API exists and both pairs report
downloadable, but **no translator instance or Korean output is obtained**.
First independent Japanese create stays pending for **120,000 ms**; simultaneous
English create consumes unavailable activation and rejects at **7 ms**, not a
pair-support result. Permanent acceptance corrects that activation flow.
Second independent Japanese create times out at **120,041.933583 ms**; English's
first properly activated create times out at **120,042.775625 ms** even after
progress **0→1**. Stop reports stopped/cancelled; page errors **[]**. No third
unchanged Japanese attempt. `npm run test:framework:chrome:translation` **FAIL**,
exit 1; native scheduling, translation quality/offline and full path remain
**UNVERIFIED**. Its native build preceded the queue limit fix; the unchanged
adapter never reached inference, and final unit/verify cover the corrected queue.
Logs: `chrome-b3-capability-attempt-1.log`, `chrome-b3-creation-attempt-1.log`,
`chrome-b3-translation-attempt-2.log`. Exact evidence is in the Chrome report.

Required `npm run test:framework:chrome` **FAIL**, exit 1, missing B5 full-stage
script (`chrome-b3-stage-acceptance.log`). Do not substitute the focused script,
weaken acceptance or confuse capability/download progress/mock translation with
native translation, actual PCM/ASR or Chrome-stage completion.

**BLOCKED B3:** native browser-owned Translator creation does not resolve in the
permitted environment within two minutes; Japanese confirms two independent
attempts. Runtime/download/component root cause is unverified. Resume only with
new permitted native readiness evidence for both pairs or a proven repository
fix, then pass focused native acceptance and final verification before checking
B3. Preserve all previous failures, gates, checkboxes, settings and companion;
no alternative tool/profile/pack injection, app installation, agents, push or
publication. Commit progress only; B4–B6/Safari/iPhone remain unfinished.

Preservation assertions and staged whitespace **PASS**: exactly seven intended
files, append-only report/plan, every checkbox unchanged, both native failures
retained and no tracked `.ralph`. Commit and clean-worktree checks at delivery.


### 2026-10-08 supervised B3 recovery — native component preparation

B3 readiness blocker resolved in the existing owned Chromium, without changing
production translation code. Chrome for Testing background updates are disabled
by default; the focused harness now registers and explicitly requires the native
TranslateKit library, en-ja and en-ko components in its new test-owned profile.
Chrome performs the genuine downloads/verification into an ignored persistent
component cache. It waits for the first document after bounded startup; both
languages still require separate real clicks and actual native Korean output.
No assertion, per-language creation/translation deadline or revision/Stop gate
is weakened. User profiles/permissions, prior failures and companion are preserved.

`npm run test:framework:chrome:translation` **PASS / exit 0**:
6 contract regressions and real Japanese/English fixture translations,
latest-final revision 2 pairing, pending original before translation, exact
identity/languages and Stop suppression; page errors/queue failures **[]**.
Native creation after component startup: **654.767 ms ja / 138.018 ms en**,
Chromium **153.0.8010.12 / darwin arm64**. `npm run verify` **PASS / exit 0**:
lint/typecheck/build, **133 JS**, **222 Python / 66.98 s**. Evidence:
`chrome-b3-cft-native-acceptance.log`, `chrome-b3-cft-verify.log`, and independent
`supervisor-cft-translation-2.log` in ignored `.ralph/media-framework/`.

Only B3 checked; **next B4**. Full Chrome acceptance remains unfinished, with its
missing complete script assigned to B5 and final quality/performance to B6.
No completed-stage marker or Safari/iPhone acceptance is claimed.

External readiness noted for later stages: user reports **Apple Developer Program
not enrolled**. This Mac currently has Command Line Tools only (`xcode-select -p`
returns `/Library/Developer/CommandLineTools`), with no `/Applications/Xcode.app`.
Do not assume paid enrollment, Xcode installation, iPhone connection or device
signing is authorized/prepared. These do not block the current Chrome work;
record actual remaining Safari/iPhone build/signing/device constraints when reached.

### 2026-10-08 / chrome / iteration 1/20 — B4 document composition, first slice

Commit: `feat: compose Chrome document interpretation and comparison`, containing
this entry. **B4 stays unchecked and next**; large items may span iterations.
Repository AGENTS.md and requested
`2026-10-08T13-28-06-822Z-chrome-verification.txt` runner evidence are absent.

Built the document-owned implementation profile (existing pinned smallFp16 /
WebGPU plus learned detector/native Translator), `InterpretationEngine` stream
and original/time/Korean comparison renderer. Prepare preserves the gesture and
requires actual readiness of all hosts. Core sessions/timeline/revisions/policy
govern caption acceptance/display. Original pending source comes first; exact
translations pair later, measured long finals replay from their beginning, fade
is 250 ms and history retains 300 rows. Stop/seek cancel old output; interruption
requires explicit Stop → Prepare → Start. Added bounded caption events, coalesced
status, visible GPU-loss/gap/overload and translation idle waiting for accepted
work at engine input EOF. Added exported composition/worker build and focused
contract/DOM command. No model/VAD/decoder tuning or fallback.

`npm run test:framework:chrome:composition` **PASS / exit 0**: typecheck,
**11 contract checks / 58.905292 ms**, **23-module** Chrome build, actual headless
Chromium **153.0.8010.12** DOM/layout/clicks with **explicit mocked workers,
native Translator and PCM input**. Checks: activation/default/source-first/exact
pairing/mapping/safe text, duplicate Start, Stop/seek/late output/preparation,
replay/final restart/fade/stale epoch/history. **220 px** layout: **33 + 33**
sequential characters from **480**; **300** rows after **305** inserts; errors
**[]**. These are not real ASR/translation/acquisition/extension-install evidence.
Log: `chrome-b4-composition-delivery.log` under ignored `.ralph/media-framework/`.
Initial unit fixture exceeded the unchanged 8,192-byte limit; corrected fixture.
First browser fixture collided with Window.closed; corrected counter. Exact
failures/next passes are retained in the report, without weaker gates.

`npm run test:framework:chrome:translation` **PASS / exit 0**:
**7 contract checks / 47.175583 ms**, headed real native Japanese/English labeled
text → Korean, original first/final revision 2 pairing/Stop; failures/errors
**[]**. Creation after existing CfT native component startup **340.975083 ms ja /
144.572 ms en**; no ASR model download. `chrome-b4-native-translation.log`. This is text
translation regression, not complete audio/ASR/DOM or quality/latency acceptance.

Intermediate `npm run verify` **PASS / exit 0**, **136 JS / 222 Python / 66.95 s**,
`chrome-b4-verify.log`. Subsequent verify **FAIL / exit 1**, throwing test generator
with no yield (`chrome-b4-verify-final.log`); changed only that test to yield a
rejected promise, retaining GPU-loss assertions. Required
`npm run test:framework:chrome` **FAIL / exit 1**, missing B5 full-stage command
(`chrome-b4-stage-acceptance.log`); no focused mock/native substitute.

**Next B4:** persistent extension host/manifest/permissions, current-page selection
UI, validated bounded PCM/control channel with acknowledgement/identity checks,
page overlay and real selected-video PCM → default ASR → native translation →
application DOM verification. These remain **UNVERIFIED**. No external environment
blocker established. Build is a composition library plus preparation document,
not yet an installable standalone product. B4–B6 and all later-stage work remain
unfinished. Every checkbox/prior failure/gate is unchanged. Companion v0.1.0,
settings/install/native messaging/server/runner and unrelated apps/files preserved.
No stage advance, agents, push/publish/install, user audio/transcript/weights/keys
or temporary `.ralph` state in Git. Final verify/preservation evidence follows;
no terminal completion or blocker marker is claimed.

Final-source `npm run verify` **PASS / exit 0**,
`chrome-b4-verify-delivery.log`: Biome **131 files / 42 ms / no findings**,
Ruff/typecheck, unchanged companion build **28 main / 10 content modules**,
**138 JS / 0 failed, skipped or cancelled / 25,434.994375 ms**, **222 Python /
67.00 s**. No executable edit follows this run. Documentation-inclusive
whitespace, exact **13-file** scope, append-only report/plan, unchanged checkboxes
and excluded tracked `.ralph` **PASS** (direct preservation assertions). Companion/
settings/runner are untouched. Staged checks and clean status after commit follow
at delivery. B4 remains unfinished; subsequent work stays in B4.


### 2026-10-08 supervised B4 original-reading regression repair

Composition commit `5cde206` passed its scoped mocks, but an independent real-DOM
regression exposed a pending provisional blocking the following translated final.
Original-only progress is now acknowledged without a translation revision;
paired/source acknowledgements cannot spend each other's reading time. Both
core and renderer reset reading parts when switching between pending source and
paired translation, so long original paging cannot blank a short first
translation or skip a corrected source. Existing cadence/read durations/fade,
revision/session checks and truthful pending comparison history are preserved.

Before-fix policy and DOM regressions **FAIL** with the older pending source
remaining visible, and the later first-translation part staying **1** rather
than **0**. Permanent tests cover yielding, stale acknowledgement isolation and
both source/translation offset directions. Final checks **PASS / exit 0**:
10 presentation tests; full focused Chrome composition (explicit mock engines,
actual DOM/layout/clicks); DOM-free framework typecheck; `npm run verify`
**141 JS / 222 Python / 66.88 s**; existing caption correction and transcript
browser/runtime checks. Exact logs and scope are in the appended Chrome report.

All checkboxes and strict numerical gates are unchanged. **Next remains B4**:
persistent extension host, validated selected-video transport/permissions,
overlay and real PCM → smallFp16/WebGPU ASR → native Korean translation →
application DOM verification. B5 full acceptance/ten-minute measurements and
B6 quality tuning remain separate, followed by Safari/iPhone. No stage completion
marker, device verification, app install, push or publication is claimed.

### 2026-10-08 / chrome / iteration 2/20 — B4 persistent host and selected-page channel

**B4 remains unchecked and next.** Repository AGENTS.md and requested independent
runner `2026-10-08T13-28-06-822Z-chrome-verification.txt` were absent; worktree clean
at entry. Read supplied instructions, plan, architecture and retained Chrome
records. Assumption: finish the document/selected-page transport slice using
existing composition/input before overlay and real extension engine validation.
No B2/B6 tuning, settings migration or later-stage work.

Added distinct MV3 development manifest (**activeTab + scripting**, no shipping
host permissions or companion key), control-only action worker and persistent
host window. Host confirms one top-frame video/language and composes the existing
smallFp16/WebGPU/shared policy. Selected audio uses direct `tabs.connect` to one
isolated-world page owner, with a separate page consent click that preserves
actual page activation. Added protocol/identity/sequence/size/timing validation,
base64 JSON PCM (8,192 bytes maximum; 14,000 wire characters), **4-event** consumed
acknowledgement window, existing 1,000 ms page queue and 1,000 ms stalled-window
failure. Stop cancels pending consent synchronously; disconnect/navigation retire
streams. Catalog replies capped at 16. Build packages host/classic content/
worklet separately; companion/settings/runner/model inventories unchanged.

**PASS `npm run test:framework:chrome:channel`, exit 0**,
`chrome-b4-channel-acceptance-delivery.log` under ignored `.ralph/media-framework/`:
typecheck, **5 contract tests / 0 failed, skipped or cancelled / 1,190.275083 ms**,
owned headed Chromium **153.0.8010.12 / darwin arm64**, real encoded Japanese/
English video/worklet/extension runtime PCM. Each selection **24 × 8,192-byte**
contiguous packets, **48 kHz / 1,024 ms**, selected tag **0.058042465 / 0.058924621**
(expected .06 within 12%), wrong-source tag **0.000722405 / 0.000333001** (<.001),
video mapping error **1.782 / 5.226333 ms** (<150 ms). Native loopback output stays
within 12% during/after capture; videos keep playing at volumes .4/.25. Host-only
arrival intervals **41.600–43.300 / 41.500–43.700 ms**, not inference/cross-clock
latency. Stop pending page consent captures **0** chunks; navigation rejects the
remote connection; page errors **[]**. This test never loads ASR/Translator and
adds localhost-only permission to its ignored fixture copy; shipping toolbar
activeTab grant remains **unverified**. No user permission/profile bypass.

Retained failures: initial local session `never` and nullable-closure typecheck
errors; focused attempt 1 fails before browser. Attempt 2 (5 unit pass) times out
at read-only fixture `window.closed`; rename counter. Attempts 3 and later timing
fixture fail startup baseline/output comparison while stable output is correct;
require actual full-level observer readiness (now stricter **3% / 5 seconds**),
retain **12%** playback assertion. Attempt 4 and intermediate final/delivery runs
pass. Video-time observation now precedes test-runner sample copying, retaining
150 ms gate and same-clock semantics. All exact failure/pass logs and measurements
are retained in Chrome report; none is hidden or relabeled real ASR acceptance.

**PASS final `npm run test:framework:chrome:composition`, exit 0**,
`chrome-b4-host-composition-delivery.log`: **11 contract tests / 68.490958 ms**,
actual DOM/layout/clicks with explicit mock workers/Translator/PCM, pending-source
progress and prior replay/revisions/Stop/history cases; page errors **[]**.
**PASS `npm run typecheck:framework`, exit 0**, DOM-free contracts/core.
**PASS `npm run verify`, exit 0**, `chrome-b4-host-verify-delivery.log`: lint
**139 files / 71 ms**, Ruff/typecheck/unchanged companion build, **146 JS /
0 failed, skipped or cancelled / 25,101.385625 ms**, **222 Python / 66.94 s**.
Earlier verify also passes (**146 JS / 222 Python / 67.00 s**). No production edit
follows final verify. Focused browser fixture timing/readiness refinements follow
it; final focused acceptance and final lint **PASS / exit 0 / 139 files / no
findings** cover those exact refinements (`chrome-b4-host-lint-final.log`).
**FAIL required `npm run test:framework:chrome`, exit 1**, still-missing B5 script
(`chrome-b4-host-stage-acceptance.log`); no placeholder or narrower substitute.

**Next B4:** verify shipping toolbar activeTab flow, actual model/native preparation
in the extension, real selected-video → default ASR → Korean application DOM,
selected-page overlay/fullscreen. These are **UNVERIFIED**. No missing-environment
blocker established; preserve every checkbox. B5 full/offline/ten-minute and B6
quality/latency remain separate; no Chrome/Safari/iPhone/framework completion.
Intended **13-file** scope only; append-only report/plan, companion v0.1.0/settings/
installation/server/native messaging/runner and prior gates unchanged. No agents,
push/publish/app install, user audio/transcripts/weights/keys or temporary `.ralph`
state in Git. Only owned tests cleaned up. Whitespace, scope, commit and clean
post-commit worktree are checked at delivery.

Final preservation assertions **PASS** (direct tool output): exact **13-file**
scope, append-only plan/report, all checkboxes unchanged, companion/settings/
server/runner untouched, no tracked `.ralph`, documentation-inclusive whitespace
clean. No executable edit follows final checks; staged checks and post-commit
clean status are verified with this iteration's commit.

### 2026-10-08 / chrome / iteration 3/20 — B4 selected-video overlay

관련 commit: this record's `feat: render selected-video Chrome captions` commit.
**B4 remains unchecked and next.** Clean worktree at entry; repository AGENTS.md
and requested independent runner `2026-10-08T13-28-06-822Z-chrome-verification.txt`
absent. Read plan/architecture/Chrome records. Assumption: complete the page
output slice of B4 using existing accepted-caption composition, shared core
policy and measured renderer; no B2/B6 model/VAD/decoder tuning or later stage.

Added direct persistent-host/content overlay output, with protocol/ordered
sequence/top-frame target/document/session/epoch checks, finite ranges and exact
source/translation pairing. Limit **32,768 JSON characters / 12,000 per text /
4 outstanding messages / 1,000 ms acknowledgement timeout**; processing precedes
acknowledgement. Failure removes owned rendering, stops selection and disables
host selection/language/confirmation until reopening. Host retains comparison
history; page policy independently measures lines on its own clock, reusing
existing original-first/correction/final replay/reading/fade/revision rules.
Owned shadow overlay follows selected-video geometry/resize/scroll, supports
fullscreen player containers and explicitly hides for video-only fullscreen.
Persistent host text reports that limitation and its available comparison window.
Stop/disconnect/pagehide/selected-element invalidation clear owned resources;
no automatic replacement video, playback/settings change or transcript storage.
Shipping manifest stays **activeTab + scripting**; service worker receives no
samples or output. Companion/native messaging/install/server/runner preserved.

Final focused **PASS `npm run test:framework:chrome:overlay`, exit 0**,
`chrome-b4-overlay-final.log`: typecheck, **4 contracts / 0 failed, skipped or
cancelled / 1,148.255459 ms**, real extension/content messaging/DOM with explicitly
**synthetic caption revisions**, no PCM/model/ASR/native translation. Owned headed
Chromium **153.0.8010.12 / darwin arm64**, macOS **26.6.2 / 25G83**, Node
**v24.15.0**, npm **11.12.1**. Overlay/video rectangles exactly **8,8,320,180 px**;
resize **280 px**/scroll, safe original-first pairing, sequential final parts
**51 + 51 chars**, container fullscreen, hidden video-only fullscreen, Stop/late
suppression, restart and selected-element removal pass. Page errors **[]**.
Ignored test copy alone has localhost permission; shipping toolbar activeTab
path remains unverified. No user profile/settings/blocked-access workaround.

**PASS `npm run test:framework:chrome:composition`, exit 0**,
`chrome-b4-overlay-composition-final.log`: typecheck, **11 contracts /
53.661834 ms**, **29-module** separate build, actual DOM/layout/controls with
explicit mock engines/Translator/PCM; new activation/pending/pair/clear forwarding
checks and existing revision/cancellation/pending-reading cases pass. Long replay
**33 + 33 / 480 chars**, **300** rows, page errors **[]**. Not real ASR acceptance.
**PASS `npm run test:framework:chrome:channel`, exit 0**,
`chrome-b4-overlay-channel-final.log`: **5 contracts / 1,191.512833 ms**, unchanged
real Japanese/English selected PCM/worklet/runtime/native-output loopback tests.
Both runs **24 × 8,192-byte** packets, **48 kHz / 1,024 ms**, sequences **0–23**;
selected tags **0.058752639 / 0.058930854**, wrong-source tags
**0.000561453 / 0.000333606**, mapping errors **6.151333 / 3.863333 ms**.
Existing .06±12%, <.001, <150 ms and native-output preservation assertions pass;
both videos remain playing/unmuted at .4/.25. Pending-consent Stop yields zero
chunks; navigation retires the channel; page errors **[]**. This is acquisition/
playback evidence, not accuracy, endpoint latency or complete PCM-to-overlay ASR.

**PASS `npm run typecheck:framework`, exit 0**, DOM-free contracts/core,
`chrome-b4-overlay-framework-types.log`. **PASS final `npm run verify`, exit 0**,
`chrome-b4-overlay-verify-final.log`: **143 files / 81 ms**, Ruff/typecheck/unchanged
companion build **28 main / 10 content modules**, **150 JS / 0 failed, skipped or
cancelled / 25,711.456875 ms**, **222 Python / 66.93 s**. No executable edit follows
this run. Intermediate lint and verify also pass; intermediate verify predates
host failure-control fix (**150 JS / 222 Python / 66.95 s**).
**FAIL required `npm run test:framework:chrome`, exit 1**,
`chrome-b4-overlay-stage-acceptance.log`: full B5 script still missing. No narrower
substitute, placeholder or relaxed gate is presented as stage acceptance.

Retained failures, with exact evidence in appended Chrome report: two initial
local acknowledgement/nullable-window typecheck errors, fixed before browser;
attempt 1 **FAIL** after inline checks because fixture's video tab was not
foremost (`not granted`, fullscreen wait **30,000 ms**); attempt 2 acquires native
fullscreen but **FAILS** immediate pre-handler `flex` vs `none` assertion. Normal
owned-page focus and waiting for observable fullscreenchange result resolve
these fixture conditions without permission/profile changes; attempt 3 **PASS**.
Permanent regression `chrome-b4-overlay-disconnect-before.log` then **FAILS** on
still-enabled host selector after lost output; fix disables controls until reopen,
and final acceptance passes including resize/scroll. No repeated absent device/
environment/permission blocker was established. All prior strict gates/failures
and every checklist line stay unchanged.

**Next unfinished B4:** shipping toolbar activeTab/install flow and actual
extension-document smallFp16/WebGPU/native Translator preparation, followed by
real selected-video PCM → ASR → Korean comparison/live/overlay DOM and integrated
interruptions. Those remain **UNVERIFIED**. B5 offline/download/restart/ten-minute
full acceptance and B6 quality/latency remain later Chrome work; no stage,
Safari/iPhone or whole-framework completion marker. Scope **12 files**, append-only
plan/report, no credentials/weights/user recordings/transcripts/temporary `.ralph`
state in Git, no agents/push/publish/app install. Unrelated files/apps/recordings/
mounted images are preserved. Staged scope/whitespace/preservation and commit/
clean post-commit state are verified at delivery.
