# 일본어 대화 인식·번역 검증

2026-10-09, macOS arm64, Chrome for Testing 153.0.8010.12. 실제 production 확장의 popup → offscreen 탭 캡처 → 로컬 ASR → TranslateKit → 페이지 자막 경로로 검사했다. 서버 인식이나 대체 번역을 주입하지 않았다.

현재 수동 일본어는 사용자의 실시간 받아쓰기 요청에 따라 영어와 같은 Chrome SODA 중간 결과 경로를 우선한다. 아래 Whisper 선택·리베이스 측정은 이 선택 변경 전의 기록이다. 자동 감지와 Chrome 로컬 인식을 지원하지 않는 환경의 fallback은 Whisper를 유지하며, 2026-10-10부터 Whisper도 임시 원문을 표시하고 같은 자막을 교정한다. 날짜별 선택과 결과는 아래에 기록한다.

## 오디오와 재현

`tests/fixtures/conversation/ja/conversation.wav`는 Kyoko / Reed 일본어 음성을 사용하는 75.980초, 24 kHz mono PCM16 합성 대화다. 서로 다른 8개 발화가 주말 약속, 시간 변경, 채식, 예약 취소 금지, 비가 올 때의 대안, 빌린 책을 이어간다. 자동 반복이나 사용자 녹음이 없다.

WAV SHA-256: `994b71fce873d0f2706b6359bc275a42d8622c82b9eaa3a5dfce310cd8d90958`. `python3 tests/fixtures/conversation/generate.py --japanese`로 다시 생성해 같은 해시를 확인했다. Reed는 OS 표시 언어에 의존하지 않는 `com.apple.eloquence.ja-JP.Reed` 식별자를 사용한다.

- 수동: `npm run test:conversation` 후 <http://127.0.0.1:8790/?language=ja>. 확장에서도 일본어를 선택한다.
- 실제 경로: `npm run test:conversation:ja:live`. Chrome 로컬 음성 API·일본어/영어/한국어 SODA 팩과 공식 번역 구성 요소가 필요하다. Whisper fallback 비교는 `node tests/framework-chrome-tab-engine.mjs --japanese-conversation --whisper`로 실행하고 [Testing](../../testing.md)의 WebGPU·로컬 모델 재사용 설정을 따른다.
- 회귀: `node --import tsx --test tests/framework-browser-streaming.test.ts tests/framework-browser-translation.test.ts`.
- 팝업 선택·준비: `node tests/framework-chrome-popup.mjs` (브라우저 API mock; 실제 인식 정확도 검사가 아님).

## Whisper 개선 당시의 발견과 수정

Chrome SODA의 일본어 결과는 질문 문장부호를 생략하고 여러 절을 누적했다. `まだ行ってないよ`를 `まだ大人ってないよ`로, 서점에서 책을 보고 싶다는 문장을 `日本屋` / `本みたいな`로 인식했다. 한국어 번역에서는 서점과 잊었을 때 알려달라는 뒷부분이 사라졌다.

Whisper 비교에서는 단어 인식이 좋아졌지만 시간 구간을 각각 확정하면서 `1時半なら` / `大丈夫`와 같은 조각을 별도 번역했다. 12초 경계에서는 다음 문장의 앞부분을 확정하고 오디오를 버렸으며, 보관한 시간 구간의 문장부호가 바뀌면 확정된 앞부분을 다시 내보내기도 했다.

- 당시에는 WebGPU가 있는 기기의 일본어에 기존 Whisper large-v3-turbo FP16 + Silero VAD를 우선했다. 영어는 Chrome 로컬 인식을 유지했고, WebGPU가 없는 일본어 기기도 Chrome 로컬 인식을 사용할 수 있었다. 이 선택은 아래 실시간 받아쓰기 변경에서 교체했다.
- 시간 구간 사이의 미완성 텍스트를 이어 문장으로 확정한다. 12초 경계에서 앞의 완성된 구간을 제거할 수 있으면 뒤의 미완성 PCM을 다음 창에 남긴다. 경계가 없는 긴 발화의 제한과 EOF 처리도 유지한다.
- 보관한 구간에서 문장부호가 바뀌어도 이미 확정한 접두사를 반복하지 않는다.
- 일본어 ASCII `?` / `!`도 번역 문장 경계로 처리한다. 문장부호가 없는 회화체 끝 표현 뒤의 새 단어나 연결 표현도 나눠 번역한다. `よく`, `きつね鍋`, `行った駅` 같은 단어·관계절을 임의로 자르지 않는 회귀 검사를 추가했다.

## 리베이스 전 실제 결과와 범위

같은 WAV의 SODA 기준 결과와 최종 production 일본어 경로를 비교했다. CER는 NFKC 정규화 후 문장부호·기호·공백을 제외한 357자를 기준으로 측정하며, 숫자 표기와 가나 표기 차이도 오류에 포함한다.

| 항목 | 기존 SODA 경로 | 최종 Whisper 경로 |
| --- | --- | --- |
| 문자 오류 | 13 / 357 (3.64%) | 9 / 357 (2.52%) |
| `行ってない` 원문 보존 | 실패 | 통과 |
| 서점 / 잊었을 때 알려달라는 한국어 내용 | 누락 | 보존 |
| 생성 자막 | 17개 | 20개, 전부 확정·번역 paired |

최종 실행은 8개 발화의 주요 원문·한국어 표현, 두 목소리에 대한 복수 화자 클러스터, 모든 20개 자막 ID의 실제 순서 표시, 읽은 ID의 재시작 방지, 마지막 자막의 페이드 완료, running 유지, Stop·페이지 이동 정리를 통과했다. 각 발화가 자막 하나와 일치하거나 일본어의 8개 화자 번호가 교대로 안정적이라는 검사는 아니다. 로컬 상세 보고서는 `.ralph/caption-conversation/live-ja.json`이다.

TranslateKit은 정확한 원문 `妹`도 “언니”로 옮겼고, 문장부호를 잃은 `日曜日にしない？`의 제안을 부정문으로 옮기는 경우가 남았다. 이 검사는 주요 내용·화면 흐름의 누락을 막는 검사이며 모든 관계·주체·제안 의도의 정확도를 보장하지 않는다. 여동생 관계 표현은 `koreanDetailAnchors` / `missingKoreanDetails`에 별도로 기록하며 통과한 주요 내용 검사에 섞어 숨기지 않는다. 깨끗한 합성 음성 결과이므로 실제 대화, 잡음, 동시 발화, 매우 비슷한 목소리의 일반 정확도나 1초 지연을 보장하지 않는다.

`npm run verify`: lint, 두 종류 타입 검사, 빌드, JS 160개, 제어된 시계의 자막 안정성 검사를 통과했다. 팝업 mock 검사와 영어/일본어 플레이어의 8개 기준 발화·길이·언어 트랙·비반복도 확인했다. README, AGENTS, 아키텍처와 검사 문서를 동기화했다. 코딩 규약과 기존 영어 화자 검증 문서는 검토했으며, 각각 공통 경계·큐·회귀 원칙과 날짜가 명시된 영어 검증 기록이 그대로 유효해 수정하지 않았다.

`npm run test:conversation:live`도 실제 영어 재생에서 9개 확정 자막의 번역 pairing, 8개 주요 발화의 화자 일관성, 순서·페이드·Stop을 통과했다. 최초 실행은 검사 코드가 영어 선택 전에 일본어 모델을 먼저 준비해 다운로드 50%에서 120초 timeout으로 실패했다. 검사에서 먼저 언어를 선택하도록 수정한 뒤, 영어가 Whisper를 다운로드하지 않고 SODA로 통과함을 확인했다. 큰 모델이 필요한 일본어 준비 대기는 기존 모델 준비 제한에 맞춰 10분을 허용한다.

`npm run test:framework:chrome:translation`은 실제 TranslateKit으로 영어·일본어 원문, 반복, 공백 있는 시간 표현, 반대 부정 극성, 기존 잘린 누적 원문 사례를 모두 통과했다. focused 회귀 검사는 수정 전에 시간 조각 분리·접두사 재출력·ASCII 질문·회화체 절 분리에서 실패했고 수정 후 통과했다. 최초 broad lint는 동적 생성 `<track>`을 찾지 못해 실패했으며, 플레이어에 기본 언어 트랙을 두고 선택 언어에 맞춰 갱신한 뒤 통과했다.

## origin/main 리베이스 검증

같은 날 `origin/main`의 `ec1b685` 위로 리베이스했다. 메인의 토스트형 자막 스택, 선택 가능한 영어·일본어·한국어 자동 감지, 모델 정보·준비 진행률을 유지했다. 준비된 자막은 앞 자막의 4초 표시가 끝날 때까지 기다리지 않고 아래에 나타나며, 화면에 완전히 보이는 여러 행의 읽기 시간이 동시에 흐른다. 좁은 화면의 공간을 초과한 행은 읽기 시간을 소비하지 않고 기다린다.

일본어 미완성 꼬리 보관 규칙이 자동 감지의 완료된 발화 경계에도 적용되면 같은 꼬리를 다시 감지·추론하는 통합 회귀를 발견했다. 완료된 발화 경계에서는 꼬리를 비우고 12초 창 경계에서만 다음 창으로 보관하도록 구분했다. 실패를 먼저 확인한 회귀 입력에서 ASR 호출이 4회에서 2회로 줄었다. 이는 해당 입력의 중복 작업 제거이며 일반 지연 시간을 절반으로 줄였다는 측정이 아니다. 자동 감지된 일본어에도 실제 원문의 언어를 기준으로 회화체 번역 분리를 적용한다.

최종 `npm run verify`는 lint, 두 종류 타입 검사, Chrome 빌드, JS 173개 및 자막 스택 검사를 통과했다. 스택 검사는 준비된 다음 행의 즉시 표시, 여러 행의 읽기 시간 중첩, 좁은 화면의 12개 자막 표시·순차 소멸, 4초 보존·250 ms 페이드를 확인했다. 팝업 mock 검사도 통과했다. README의 지원 범위·스택·모델 설명과 코딩 규약은 리베이스된 구현에 부합해 추가 변경하지 않았고, AGENTS·아키텍처·검사 문서의 발화 경계와 진단 지침을 동기화했다.

실제 `INTERPRETER_TEST_MODEL_DIRECTORY=/tmp npm run test:auto-language:live`는 6개 교대 발화의 시작 단어·내용, 언어별 번역 pairing, 한국어 번역 생략, 실제 화면 표시, Stop·이동 정리를 통과했다. 9개 자막, 15개 추론 호출, 6개 native 번역 호출을 기록했다. 첫 시도는 검사 코드가 준비 클릭 직후 `preparing`을 단정해 아직 `idle`인 순간 실패했다. 상태 변경을 기다리도록 검사 코드를 고친 뒤 통과했다.

리베이스 후 일본어 실제 검사 첫 시도는 재생 종료 뒤 앞부분이 다시 인식되어 CER 60/357 (16.81%)로 실패했다. 오디오 입력 RMS/peak와 미디어 상태를 기록한 재시도는 21개 자막, CER 13/357 (3.64%), 8개 발화 주요 원문·한국어 및 표시·소멸·Stop을 통과했다. WAV는 75.979625초에서 종료했고 반복 설정이 없었으며, 종료 뒤 새로운 오디오 구간의 추론이 없었다. 이 재시도는 앞서 관찰한 종료 후 재인식의 원인을 확정하거나 해결한 증거가 아니다. 검사에 미디어 재생 이벤트와 PCM 진단을 남겨 재발 시 재생 재시작과 모델 오인식을 구분할 수 있게 했다. `妹`의 한국어 관계 오류도 여전히 상세 검사에 기록된다. 리베이스 전 2.52%를 매 실행의 정확도로 주장하지 않는다.

추가 일본어 재검사는 재시작 없는 단일 재생, CER 17/357 (4.76%)였으나 `借りていた本`을 `書いていた本`으로 인식해 빌린 책의 원문·번역 내용 검사가 실패했다. 앞 화자의 문장과 다음 화자의 시작이 하나의 12초 창에 섞인 것도 보고서에서 확인했다. 이 현상을 줄이려고 수동 일본어에도 자동 모드의 240 ms VAD 경계를 적용해 봤지만, 실제 실행에서 문장 안의 쉼까지 잘라 `土曜日は` / `妹の引っ越しを手伝うから` 등의 조각을 별도 번역했다. CER 20/357 (5.60%), ASR 73회였고 “이사”의 한국어 내용 검사가 실패했다. borrowed-book 오류가 있었던 기존 실행은 ASR 54회였다. 이 변경과 전용 mock 검사는 **제외했다**. mock 174개 통과만으로 실제 품질 개선을 주장하지 않으며, 최종 수동 일본어는 기존 문장 확인·미완성 보관 정책을 유지한다.

따라서 리베이스된 일본어가 매 실행의 내용 검사를 안정적으로 통과한다고 주장할 수 없다. 통과한 실행과 누락·오인식 실행을 모두 기록했으며, 종료 뒤 재인식과 책의 관계 표현·일부 번역 오류는 미해결 제한이다. 자막 스택의 검증과 자동 감지의 중복 작업 제거는 이 일본어 정확도 제한과 별도로 확인했다. 로컬 보고서는 `.ralph/caption-conversation/rebase-audio-trace-passed-ja.json`, `rebase-replay-failed-ja.json`, `rebase-mixed-turn-failed-ja.json`, `rebase-short-pause-rejected-ja.json`에 각각 보관한다.

## 영어와 같은 실시간 받아쓰기 경로

사용자 요청에 따라 수동 일본어도 영어와 동일하게 Chrome 로컬 인식을 우선하도록 바꿨다. WebGPU 유무와 관계없이 지원되는 SpeechRecognition API·언어 팩을 사용한다. 기존 native 경로의 중간 결과를 180 ms 간격으로 모아 전송하고 native final은 즉시 전송한다. 같은 utterance ID의 revision으로 교정하므로 문장 확정을 기다리는 Whisper snapshot 경로를 거치지 않는다. 팝업의 캐시 확인·설치·모델 정보도 이 선택을 따른다. 자동 감지·한국어와 unsupported-native fallback의 Whisper 정책 및 앞선 일본어 번역·오디오 보관 수정은 유지했다.

WebGPU가 있는 팝업의 일본어 캐시 검사에서 이전 구현은 Start 활성화를 기다리다 3초 timeout으로 실패했다. 수정 후 캐시 준비, 일본어/영어/한국어 native 팩 설치, 영어와 같은 모델 선택, 미지원 API의 Whisper fallback, 자동·한국어 선택 검사를 통과했다. `node --import tsx --test tests/framework-browser-local-speech.test.ts tests/framework-browser-translation.test.ts` 33개와 `npm run verify`의 173개·자막 스택 검사도 통과했다. README·AGENTS·아키텍처·검사 문서를 갱신했고, 코딩 규약과 기존 날짜별 영어·자동 감지 검증 문서는 각각 revision 원칙과 과거 실행 기록이 유효해 수정하지 않았다.

실제 `npm run test:conversation:ja:live`에서는 native 로컬 탭 오디오와 중간 결과를 확인했고 Whisper 추론 호출은 0회였다. 재생 `playing` 이벤트부터 첫 visible 원문까지 **1,056 ms**, 첫 한국어까지 **1,105.4 ms**였다. 비교용 리베이스 Whisper 실행의 같은 화면 측정은 원문 6,007.5 ms, 한국어 6,153.2 ms였다. native 값은 짧은 중간 텍스트의 첫 표시이고 Whisper 값은 문장 확인 뒤 첫 표시이므로 전체 문장의 확정 시간을 6초에서 1초로 줄였다는 뜻은 아니다. 이 장치·합성 WAV 한 번의 초기 표시 측정이며 일반적인 1초 보장은 아니다.

17개 최종 자막의 CER는 **9/357 (2.52%)**였다. 원문 내용 anchor는 8개 발화 모두 남았지만 `カフェの向かいに本屋`를 `カフェの向かい日本屋`로 인식해 한국어가 “카페 맞은편에 일본 가게”가 됐다. “서점” anchor 실패로 전체 내용 정확도 검사는 **실패**했다. 질문 문장부호·제안의 극성 오류도 남는다. 정확도 gate를 완화하거나 특정 테스트 문장으로 원문을 교정하지 않았다.

이 실패 전에 검사된 native 시작·interim·Whisper 호출 없음과 보고서의 first-display 측정은 유효하다. 저장된 실제 프레임을 별도로 검사해 17개 최종 revision의 번역 pairing, 모든 ID 표시, 읽은 ID 재등장 없음, 마지막 자막의 페이드 완료를 확인했다. 전체 live 명령은 내용 검사 실패에서 중단되어 뒤의 Stop·이동 검사를 통과했다고 주장하지 않는다. 로컬 상세 보고서는 `.ralph/caption-conversation/native-streaming-ja.json`이다.

## Whisper 임시 받아쓰기와 교정

2026-10-10. 기존 Whisper의 누적 PCM 재분석 주기와 문장 확인 정책을 유지하면서, 미확정 텍스트를 `final: false`로 먼저 보낸다. 다음 snapshot은 같은 utterance ID의 source revision을 증가시켜 교정하며, 연속 결과에서 일치한 완성 문장은 같은 ID로 확정한다. 남은 문장은 다음 임시 자막으로 이어진다. PCM을 잘라도 남은 자막 ID를 보존하고, 바뀌지 않은 임시 결과는 재전송하지 않는다. 확정된 접두사 중복 방지와 미완성 음성 보관, 자동 언어 교정, 기존 번역 pairing·한국어 번역 생략을 유지한다. 새로운 모델이나 재학습, 추론 간격 단축은 없다.

변경 전에는 문장 끝·쉼·EOF 이전에 임시 받아쓰기가 나와야 하는 회귀 검사에서 출력이 0개여서 실패했다. 변경 후 `node --import tsx --test tests/framework-browser-streaming.test.ts tests/framework-browser-translation.test.ts` 43개가 통과했다. 같은 ID의 교정·확정, 대기 중 임시 결과 병합, 오래된 번역 응답 거부, 12초 창을 넘긴 임시 자막 ID 유지와 확정 접두사 재출력 방지를 검사했다. 이 검사의 모델 출력은 mock이며 실제 정확도·지연 측정이 아니다. `npm run verify`도 lint, 두 타입 검사, Chrome 빌드, 단위·fixture 189개와 제어된 시계의 자막 스택 검사를 통과했다.

실제 `INTERPRETER_TEST_MODEL_DIRECTORY=/tmp node tests/framework-chrome-tab-engine.mjs --japanese-conversation --whisper`로 동일한 두 목소리 WAV, pinned Turbo FP16/WebGPU와 native TranslateKit을 사용했다. 첫 실행에서는 첫 원문 2,877.6 ms와 첫 한국어 2,921.5 ms, 확정 전 실제 화면 표시를 확인했지만 재생 종료 뒤 `seeking`·`playing`이 다시 발생했다. 추가 재생 중 미확정 자막이 남아 전체 명령이 실패했다. 모델이 조용한 입력에서 앞 내용을 생성했다는 증거로 해석하지 않는다. 실패 보고서는 `.ralph/caption-conversation/whisper-streaming-replay-failed-ja.json`에 보관했다. 검사에는 단일 재생·비반복·재생 종료 상태를 명시적으로 확인하는 조건을 추가했다.

두 번째 실행은 단일 재생으로 21개 원문·번역 최종 pairing, 8개 발화의 주요 일본어·한국어 내용, 모든 ID의 표시·재등장 방지와 마지막 자막 페이드를 통과했다. 16개 자막은 같은 ID의 최초 final보다 먼저 화면에 나타났다. 첫 원문은 2,240.3 ms, 첫 한국어는 2,423.7 ms였고 CER는 12/357 (3.36%)였다. 이는 초기 임시 표시의 측정이며 문장 전체 확정 지연이나 일반 장치 성능을 보장하지 않는다. `妹`의 “여동생/동생” 번역 오류는 상세 검사에 남았다. 다만 Stop 후 상태가 정상적인 `idle`인데 검사에서 `ready`만 기다려 120초 timeout이 났다. 이 실행의 전체 명령을 통과로 기록하지 않는다. Stop 검사를 `idle` 또는 캐시 자동 준비 후의 `ready`를 수용하도록 수정하고 overlay·캡처 해제 및 늦은 revision 거부도 확인하도록 했다. 이 보고서는 `.ralph/caption-conversation/whisper-streaming-content-passed-stop-timeout-ja.json`이다.

검사 수정 후 세 번째 Whisper 실행은 전체 명령을 통과했다. 단일 75.979625초 재생에서 18개 자막이 모두 확정·번역 paired 상태였고, 17개는 확정 전에 표시됐다. 첫 원문 2,431.4 ms, 첫 한국어 2,458.6 ms, CER 8/357 (2.24%), 실제 ASR 59회였다. 주요 원문·한국어 내용, 두 화자의 구분, 모든 ID 표시, 읽은 ID 재등장 없음, 마지막 자막 페이드, Stop 후 overlay·캡처 해제·늦은 revision 거부, 페이지 이동과 탭 종료에 따른 준비 정리를 통과했다. `妹`의 여동생 관계 번역 오류는 남았다. `.ralph/caption-conversation/whisper-streaming-ja.json`에 보관했다. 앞 실행들과 snapshot 결과·자막 수가 다르므로 매 실행의 같은 정확도를 보장하지 않는다.

필수 비교 명령 `npm run test:conversation:ja:live`도 실행했다. SODA의 17개 확정 자막, CER 11/357 (3.08%), 첫 원문 1,079.4 ms와 한국어 1,128.2 ms를 기록했고 Whisper 호출은 0회였다. 기존 측정과 같은 카페 맞은편 “서점”의 한국어 의미 누락으로 전체 명령은 실패했다. 이 실패는 수정하지 않은 native 경로의 품질 제한으로 남기며, 실패 뒤 Stop·이동 검사를 통과했다고 주장하지 않는다. 보고서는 `.ralph/caption-conversation/whisper-streaming-native-ja.json`이다.

`INTERPRETER_TEST_MODEL_DIRECTORY=/tmp npm run test:auto-language:live`도 통과했다. 검사에서 임시 자막만으로 내용 조건을 만족하고 끝내지 않도록 원문과 번역의 final을 모두 기다린다. 6개 영어/일본어/한국어 교대 발화에서 12개 최종 paired 자막, 첫 단어·주요 내용 보존, 한국어 native 번역 생략, 실제 overlay 표시, Stop·페이지 이동 정리를 확인했다. 실제 ASR 25회와 native 번역 19회였다. 한국어 “역에서”를 “여기서”로 인식하는 기존 오류는 남았다. `.ralph/auto-language/live.json`과 `whisper-streaming-live.log`에 보관했다. 최종 `npm run verify`도 189개와 자막 스택 검사를 다시 통과했다.

README·AGENTS·아키텍처·검사 지침을 동기화했다. 코딩 규약은 기존 revision·큐·취소 원칙이 적용되어 수정하지 않았다. PRIVACY는 같은 로컬 음성·문장 처리와 메모리 기록 정책을 유지해 수정하지 않았다. 날짜가 명시된 화자·자동 언어 검증 기록도 기존 측정과 모델을 설명하므로 그대로 보존했다.

## 교정에서 없어진 임시 자막의 철회

2026-10-10. Whisper Turbo FP16 + Chrome 번역에서 영상 자막이 남는 보고를 조사했다. 인식 snapshot이 미완성 꼬리를 제거하거나 완료된 발화의 결과가 빈 텍스트가 되면 기존 draft에 확정·삭제 revision이 오지 않았다. 최종 결과가 필러만 남아 번역 큐에서 걸러지는 경우에도 이전 임시 행이 남았다. 이 행은 최신 원문·번역의 final을 영원히 기다리며 뒤의 완료된 행까지 순차 퇴장을 막는다. 세 가지 mock 회귀 검사가 수정 전 실패했다. 첨부된 실제 영상의 입력이나 내부 revision 기록은 확보하지 않았으므로 이 세 가지가 그 영상의 정확한 원인이었다고 단정하지 않는다.

없어진 임시 인식은 같은 ID, 증가한 source revision, 빈 텍스트와 final `retracted` 상태로 명시적으로 철회한다. 번역 없이 영상 자막과 기록 행에서 제거하고 대기 번역을 취소한다. bounded revision store는 철회 기록을 보관해 늦은 원문·번역·화자 응답을 거부하며, 정상 확정 문장은 철회하지 않는다. 다음 발화는 철회한 draft의 ID를 이어받지 않는다. 교정 중인 다른 자막의 유지와 최종 4초 읽기 시간은 그대로다.

`node --import tsx --test tests/framework-browser-streaming.test.ts tests/framework-browser-translation.test.ts` 47개가 통과했다. 실제 pipeline 안에서 번역 중인 draft의 철회도 검사했다. `npm run verify`는 lint, 두 타입 검사, Chrome 빌드, 단위·fixture 198개와 제어된 브라우저 시계의 자막 스택 검사를 통과했다. `npm run test:framework:chrome:overlay`는 실제 확장 포트를 통한 fullscreen 행 제거와 production 기록 창에서의 철회/확정 기록 보존을 통과했다. 마지막 검사에는 caption 입력과 기록 창의 background 응답 mock이 사용되며 실제 모델 정확도 검사는 아니다. 첫 기록 창 검사 실행은 테스트가 잘못된 event channel을 사용해 30초 timeout으로 실패했고, 실제 `interpreter-event-v1`로 고친 뒤 통과했다. 첫 broad verify도 새 테스트의 unsafe optional chaining lint로 실패했으며 이를 수정한 후 통과했다.

수정 전 동일한 75.979625초 두 목소리 fixture의 실제 Whisper 실행은 19개 확정 자막, CER 11/357 (3.08%)로 통과했다. 잔류 현상이 매번 재현되는 fixture는 아니다. 수정 후 `INTERPRETER_TEST_MODEL_DIRECTORY=/tmp node tests/framework-chrome-tab-engine.mjs --japanese-conversation --whisper`는 전체 명령을 통과했다. 18개 자막의 최신 원문과 정확히 대응하는 번역이 모두 확정됐고, 15개는 확정 전에 화면에 나타났다. 첫 원문 2,661.8 ms, 첫 한국어 2,706.3 ms, CER 8/357 (2.24%), 실제 ASR 62회였으며 재생 후 남은 overlay 행은 0개였다. 주요 원문·한국어 의미, 비반복, 읽은 ID 재등장 없음, 모든 행의 완료, Stop·캡처 해제·늦은 revision 거부, 이동·탭 종료 정리를 확인했다. 실제 철회가 발생한 draft는 0개라 철회 경로의 증거는 위 mock 회귀와 브라우저 DOM/포트 검사에 있다. `妹`를 “여동생/동생”으로 옮기지 못하는 오류는 남았다. 보고서는 `.ralph/caption-conversation/withdrawal-before-ja.json`과 `withdrawal-whisper-ja.json`에 보관했다.

필수 비교 명령 `npm run test:conversation:ja:live`도 실행했다. SODA 경로의 18개 최신 원문·번역 확정과 모든 overlay 행의 퇴장은 통과했으며 Whisper 호출은 0회였다. CER 11/357 (3.08%)였으나, 기존 인식 오류인 `行ってない` 의미 누락 검사에서 전체 명령은 실패했다. 보고서에는 “서점”의 한국어 의미 누락도 남았다. 그 뒤의 Stop·이동 검사를 통과했다고 주장하지 않는다. 상세 오류는 `.ralph/caption-conversation/withdrawal-native-ja.json`에 보관했다.

README·AGENTS·아키텍처·코딩 규약·검사 지침을 동기화했다. 문서 색인은 기존 일본어·자막 검증 링크가 유효해 변경하지 않았다. PRIVACY는 로컬 처리와 최대 300개 메모리 기록, Stop 후 기록이 남을 수 있다는 설명이 여전히 맞아 변경하지 않았다. 날짜가 명시된 화자·자동 언어 측정 기록은 당시 결과로 그대로 보존했다.
